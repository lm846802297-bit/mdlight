using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Mdlight
{
    /// <summary>
    /// User preferences, persisted as %APPDATA%\mdlight\config.json so both the
    /// native host and the page can read/write the same file. Mirrors the shape
    /// of the commonly-used settings shape but keeps only the options mdlight actually uses.
    ///
    /// The file is read lazily and cached; writes are atomic (tmp + replace) so
    /// a crash mid-write never corrupts the config.
    /// </summary>
    internal static class Config
    {
        private static Dictionary<string, object> _cache;
        private static string _filePath;

        /// <summary>Location of the shared preferences file.</summary>
        public static string FilePath
        {
            get
            {
                if (_filePath == null)
                {
                    // MDLIGHT_CONFIG_DIR overrides so tests / portable use can
                    // isolate config without touching the real %APPDATA%. It is
                    // the *final* directory (already carries the "mdlight" part),
                    // unlike APPDATA which needs the subfolder appended.
                    string dir = Environment.GetEnvironmentVariable("MDLIGHT_CONFIG_DIR");
                    if (!string.IsNullOrEmpty(dir))
                    {
                        dir = System.IO.Path.GetFullPath(dir);
                    }
                    else
                    {
                        dir = System.IO.Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                            "mdlight");
                    }
                    Directory.CreateDirectory(dir);
                    _filePath = System.IO.Path.Combine(dir, "config.json");
                }
                return _filePath;
            }
        }

        private static Dictionary<string, object> Raw()
        {
            if (_cache != null) return _cache;
            _cache = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (File.Exists(FilePath))
                {
                    // Config.cs lives beside the rest of the native host, which has
                    // no System.Text.Json; a tiny hand-rolled flat JSON parse keeps
                    // it dependency-free (values are scalars / arrays / objects).
                    string text = File.ReadAllText(FilePath, Encoding.UTF8);
                    _cache = ParseFlatJson(text) ?? _cache;
                }
            }
            catch (Exception e) { Util.Log("Config read failed: " + e.Message); }
            return _cache;
        }

        /// <summary>Get a string option with a default.</summary>
        public static string Get(string key, string def)
        {
            object o;
            object v = Raw().TryGetValue(key, out o) ? o : null;
            return v == null ? def : Convert.ToString(v);
        }

        /// <summary>Get a bool option with a default.</summary>
        public static bool GetBool(string key, bool def)
        {
            object o;
            object v = Raw().TryGetValue(key, out o) ? o : null;
            if (v == null) return def;
            if (v is bool) return (bool)v;
            string s = Convert.ToString(v).Trim().ToLowerInvariant();
            if (s == "true" || s == "1" || s == "yes") return true;
            if (s == "false" || s == "0" || s == "no") return false;
            return def;
        }

        /// <summary>Get a numeric option with a default.</summary>
        public static double GetNum(string key, double def)
        {
            object o;
            object v = Raw().TryGetValue(key, out o) ? o : null;
            if (v == null) return def;
            try { return Convert.ToDouble(v); }
            catch (Exception) { return def; }
        }

        /// <summary>Get a whole JSON object value (for nested settings blocks).</summary>
        public static string GetJson(string key)
        {
            object o;
            object v = Raw().TryGetValue(key, out o) ? o : null;
            return v == null ? null : Convert.ToString(v);
        }

        /// <summary>Persist one or more options as a flat key/value map.</summary>
        public static void Set(Dictionary<string, object> patch)
        {
            lock (gate)
            {
                // Work on a copy: Write() serialises the dictionary, and mutating
                // the live cache in place could make that enumeration throw
                // ("Collection was modified") and leave the cache dirty.
                Dictionary<string, object> data =
                    new Dictionary<string, object>(Raw(), StringComparer.OrdinalIgnoreCase);
                foreach (KeyValuePair<string, object> kv in patch) data[kv.Key] = kv.Value;
                Write(data);
            }
        }

        private static readonly object gate = new object();

        private static void Write(Dictionary<string, object> data)
        {
            // Unique temp name: two concurrent saves used to share one, and the
            // loser's File.Replace threw and was silently swallowed, so the user
            // saw "saved" while the setting never landed.
            string tmp = FilePath + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                string json = "{\n" + Serialize(data, 0) + "\n}\n";
                File.WriteAllText(tmp, json, Encoding.UTF8);
                if (File.Exists(FilePath)) File.Replace(tmp, FilePath, null);
                else File.Move(tmp, FilePath);
                _cache = data;
            }
            // Do NOT swallow write exceptions here: HandleConfigSave wraps
            // Config.Set in a try/catch, but only sees the exception if it
            // propagates. Swallowing silently returned {"ok":true} even when
            // the file was never written (disk full, permissions, locked).
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception) { }
            }
        }

        private static string Serialize(Dictionary<string, object> data, int indent)
        {
            var sb = new StringBuilder();
            string pad = new string(' ', (indent + 1) * 2);
            string padEnd = new string(' ', indent * 2);
            bool first = true;
            foreach (KeyValuePair<string, object> kv in data)
            {
                if (!first) sb.Append(",\n");
                first = false;
                sb.Append(pad).Append(Util.JsonStr(kv.Key)).Append(": ").Append(ValueToJson(kv.Value, indent + 1));
            }
            return sb.ToString();
        }

        private static string ValueToJson(object v, int indent)
        {
            // csc.exe is .NET Framework, so C# 5: no `is X y` pattern matching.
            if (v is Dictionary<string, object>)
                return "{\n" + Serialize((Dictionary<string, object>)v, indent) + "\n" + new string(' ', indent * 2) + "}";
            if (v is bool) return ((bool)v) ? "true" : "false";
            if (v is int || v is long || v is double || v is float) return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
            return Util.JsonStr(Convert.ToString(v));
        }

        /// <summary>
        /// Minimal flat JSON object parser (no nested arrays; nested objects are
        /// re-serialised verbatim so we never lose them on a read-modify-write).
        /// </summary>
        private static Dictionary<string, object> ParseFlatJson(string s)
        {
            int i = 0;
            int n = s.Length;
            var map = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            SkipWs(s, ref i, n);
            if (i >= n || s[i] != '{') return map;
            i++;
            SkipWs(s, ref i, n);
            while (i < n && s[i] != '}')
            {
                SkipWs(s, ref i, n);
                string key = ReadString(s, ref i, n);
                SkipWs(s, ref i, n);
                if (i < n && s[i] == ':') i++;
                SkipWs(s, ref i, n);
                object val = ReadValue(s, ref i, n);
                map[key] = val;
                SkipWs(s, ref i, n);
                if (i < n && s[i] == ',') { i++; SkipWs(s, ref i, n); }
                else break;
            }
            return map;
        }

        private static void SkipWs(string s, ref int i, int n)
        {
            while (i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) i++;
        }

        private static string ReadString(string s, ref int i, int n)
        {
            if (i < n && s[i] == '"') { i++; var sb = new StringBuilder(); while (i < n && s[i] != '"') { if (s[i] == '\\' && i + 1 < n) { i++; sb.Append(Unescape(s[i])); } else sb.Append(s[i]); i++; } if (i < n) i++; return sb.ToString(); }
            int st = i; while (i < n && s[i] != ',' && s[i] != '}' && s[i] != ':') i++;
            return s.Substring(st, i - st).Trim();
        }

        private static char Unescape(char c)
        {
            switch (c)
            {
                case 'n': return '\n';
                case 't': return '\t';
                case 'r': return '\r';
                default: return c;
            }
        }

        private static object ReadValue(string s, ref int i, int n)
        {
            SkipWs(s, ref i, n);
            if (i >= n) return null;
            if (s[i] == '"') return ReadString(s, ref i, n);
            if (s[i] == '{')
            {
                // nested object: keep the raw JSON so a later rewrite preserves it
                int st = i, depth = 0;
                bool inStr = false;
                while (i < n)
                {
                    char c = s[i];
                    if (inStr) { if (c == '"' && s[i - 1] != '\\') inStr = false; }
                    else if (c == '"') inStr = true;
                    else if (c == '{') depth++;
                    else if (c == '}') { depth--; if (depth == 0) { i++; break; } }
                    i++;
                }
                return s.Substring(st, i - st);
            }
            int st2 = i;
            while (i < n && s[i] != ',' && s[i] != '}' && s[i] != '\r' && s[i] != '\n') i++;
            string tok = s.Substring(st2, i - st2).Trim();
            if (tok == "true") return true;
            if (tok == "false") return false;
            if (tok == "null") return null;
            double num;
            if (double.TryParse(tok, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out num)) return num;
            return tok;
        }
    }
}
