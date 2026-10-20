using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Microsoft.Win32;

namespace Mdlight
{
    /// <summary>Outcome of one opening attempt: exactly one of Via / Error is set.</summary>
    internal sealed class EditorLaunch
    {
        public readonly string Via;    // short label shown in the page toast
        public readonly string Error;  // readable, actionable message for the page

        public EditorLaunch(string via, string error)
        {
            Via = via;
            Error = error;
        }
    }

    /// <summary>
    /// Finds and launches the user's external editor for the current document.
    ///
    /// Probe order (first one that actually starts wins):
    ///   1. %MD_EDITOR%  — either a full command template with {file}/{line}
    ///                     placeholders, or just an exe name/path
    ///   2. App Paths    — HKCU then HKLM (both registry views), for the usual
    ///                     suspects: Code.exe, Code - Insiders.exe,
    ///                     sublime_text.exe, notepad++.exe, notepad.exe
    ///   3. PATH         — code / code.cmd / code-insiders / subl / notepad++ /
    ///                     editor / notepad
    ///   4. %WINDIR%\notepad.exe (Windows always ships one)
    ///
    /// Argument rules: any executable whose file name contains "code" gets
    /// --goto "file:line"; Sublime gets "file:line"; everything else gets
    /// "file". The line suffix is omitted when the caller does not know it.
    ///
    /// Launches go straight through Process.Start with UseShellExecute=false so
    /// cmd.exe never expands %VAR% inside a document path (a file literally
    /// named "100%TEMP%.md" used to open the wrong place). Only .cmd/.bat
    /// wrappers have to go through cmd.exe, which is unavoidable.
    /// </summary>
    internal static class Editor
    {
        /// <summary>App Paths entries to probe, in priority order.</summary>
        private static readonly string[] AppPathExes = new string[]
        {
            "Code.exe",
            "Code - Insiders.exe",
            "sublime_text.exe",
            "notepad++.exe",
            "notepad.exe",
        };

        /// <summary>Bare names to look up on PATH, in priority order.</summary>
        private static readonly string[] PathNames = new string[]
        {
            "code", "code.cmd", "code-insiders", "subl", "notepad++", "editor", "notepad",
        };

        /// <summary>Extensions tried for a bare PATH name; .exe first so a
        /// bash-style extensionless script never shadows a real executable.</summary>
        private static readonly string[] PathExts = new string[]
        {
            ".exe", ".cmd", ".bat", ".com", "",
        };

        /// <summary>Backward-compatible entry point: the label, or null.</summary>
        public static string Open(string file, int line)
        {
            return OpenEx(file, line).Via;
        }

        /// <summary>Full result, including a message the page can show the user.</summary>
        public static EditorLaunch OpenEx(string file, int line)
        {
            if (line < 0) line = 0;
            if (file == null) file = "";

            string env = Environment.GetEnvironmentVariable("MD_EDITOR");
            if (env != null && env.Trim().Length > 0)
                return OpenViaEnv(env.Trim(), file, line);

            List<Candidate> candidates = new List<Candidate>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> failures = new List<string>();

            AddAppPathCandidates(candidates, seen, file, line);
            AddPathCandidates(candidates, seen, file, line);

            string via = TryCandidates(candidates, failures);
            if (via != null) return new EditorLaunch(via, null);

            // Windows always ships notepad; probe the real file before relying
            // on PATH so a policy-locked PATH cannot leave us with nothing.
            string windir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string[] fallbacks = new string[]
            {
                Path.Combine(windir, "System32", "notepad.exe"),
                Path.Combine(windir, "notepad.exe"),
                "notepad.exe",
            };
            for (int i = 0; i < fallbacks.Length; i++)
            {
                string p = fallbacks[i];
                if (!seen.Add(p)) continue;
                if (!File.Exists(p) && p.IndexOf('\\') >= 0) continue;
                Candidate c = MakeCandidate(p, "notepad", file, line);
                string err;
                if (TryLaunch(c, out err))
                {
                    Util.Log("Editor: launched fallback " + c.Exe + " " + c.Args);
                    return new EditorLaunch("notepad", null);
                }
                Util.Log("Editor: fallback launch failed " + c.Exe + ": " + err);
                failures.Add("notepad: " + err);
            }

            return new EditorLaunch(null, NotFoundMessage(failures));
        }

        // ------------------------------------------------------------------
        // 1. MD_EDITOR

        /// <summary>
        /// MD_EDITOR can be a command template ("code --goto {file}:{line}") or
        /// a bare executable ("code", "C:\Program Files\...\notepad++.exe").
        /// A broken MD_EDITOR is reported instead of silently falling through:
        /// the user set it on purpose, so opening Notepad would hide the typo.
        /// </summary>
        private static EditorLaunch OpenViaEnv(string tpl, string file, int line)
        {
            try
            {
                bool hasPlaceholder =
                    tpl.IndexOf("{file}", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    tpl.IndexOf("{line}", StringComparison.OrdinalIgnoreCase) >= 0;

                Candidate c = null;
                if (hasPlaceholder)
                {
                    string cmdline = ExpandTemplate(tpl, file, line);
                    List<string> argv = SplitArgs(cmdline);
                    if (argv.Count == 0) return EnvError("MD_EDITOR 为空 / MD_EDITOR is empty");
                    string exe = ResolveProgram(argv[0]);
                    if (exe == null) return EnvError("MD_EDITOR 指定的程序未找到 / not found: " + argv[0]);
                    c = new Candidate();
                    c.Exe = exe;
                    c.Label = "MD_EDITOR";
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i < argv.Count; i++)
                    {
                        if (sb.Length > 0) sb.Append(' ');
                        sb.Append(QuoteArg(argv[i]));
                    }
                    c.Args = sb.ToString();
                    ApplyCmdWrapper(c);
                }
                else
                {
                    string exe = ResolveProgram(tpl);
                    if (exe != null)
                    {
                        c = MakeCandidate(exe, "MD_EDITOR", file, line);
                    }
                    else
                    {
                        // Tolerate "code --new-window" style values even though
                        // the documented form is a bare executable.
                        List<string> argv = SplitArgs(tpl);
                        if (argv.Count > 1)
                        {
                            string head = ResolveProgram(argv[0]);
                            if (head != null)
                            {
                                c = new Candidate();
                                c.Exe = head;
                                c.Label = "MD_EDITOR";
                                StringBuilder sb = new StringBuilder();
                                for (int i = 1; i < argv.Count; i++)
                                {
                                    if (sb.Length > 0) sb.Append(' ');
                                    sb.Append(QuoteArg(argv[i]));
                                }
                                c.Args = sb.ToString();
                                string extra = BuildArgs(head, file, line);
                                if (c.Args.Length > 0) c.Args += " ";
                                c.Args += extra;
                                ApplyCmdWrapper(c);
                            }
                        }
                    }
                    if (c == null)
                        return EnvError("MD_EDITOR 指定的程序未找到 / not found: " + tpl);
                }

                string err;
                if (TryLaunch(c, out err))
                {
                    Util.Log("Editor: launched via MD_EDITOR: " + c.Exe + " " + c.Args);
                    return new EditorLaunch("MD_EDITOR (" + Path.GetFileName(c.Exe) + ")", null);
                }
                return EnvError("MD_EDITOR 启动失败 / launch failed: " + c.Exe + "\n" + err);
            }
            catch (Exception e)
            {
                return EnvError("MD_EDITOR 处理失败 / failed: " + e.Message);
            }
        }

        private static EditorLaunch EnvError(string detail)
        {
            Util.Log("Editor: " + detail.Replace("\n", " | "));
            string msg = detail + "\n" +
                "可修改或删除环境变量 MD_EDITOR；不设置时会自动探测 code / Code.exe / sublime_text / notepad++ / notepad。\n" +
                "示例: MD_EDITOR=\"code --goto {file}:{line}\"\n" +
                "Fix or unset MD_EDITOR; when it is unset mdlight auto-detects code / Code.exe / sublime_text / notepad++ / notepad.\n" +
                "Example: MD_EDITOR=\"code --goto {file}:{line}\"";
            return new EditorLaunch(null, msg);
        }

        // ------------------------------------------------------------------
        // 2. registry App Paths

        private static void AddAppPathCandidates(List<Candidate> cs, HashSet<string> seen,
                                                 string file, int line)
        {
            RegistryHive[] hives = new RegistryHive[]
            {
                RegistryHive.CurrentUser,
                RegistryHive.LocalMachine,
                RegistryHive.LocalMachine,   // 32-bit view, for x86 installers
            };
            RegistryView[] views = new RegistryView[]
            {
                RegistryView.Default,
                RegistryView.Registry64,
                RegistryView.Registry32,
            };

            for (int e = 0; e < AppPathExes.Length; e++)
            {
                string exeName = AppPathExes[e];
                for (int h = 0; h < hives.Length; h++)
                {
                    string p = ReadAppPath(hives[h], views[h], exeName);
                    if (p == null) continue;
                    if (!seen.Add(p)) continue;
                    cs.Add(MakeCandidate(p, exeName, file, line));
                }
            }
        }

        private static string ReadAppPath(RegistryHive hive, RegistryView view, string exeName)
        {
            try
            {
                using (RegistryKey b = RegistryKey.OpenBaseKey(hive, view))
                {
                    if (b == null) return null;
                    using (RegistryKey k = b.OpenSubKey(
                        @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName, false))
                    {
                        if (k == null) return null;
                        string v = k.GetValue(null) as string;
                        if (string.IsNullOrEmpty(v)) v = k.GetValue(string.Empty) as string;
                        v = Unquote((v ?? "").Trim());
                        if (v.Length == 0) return null;
                        try { v = Environment.ExpandEnvironmentVariables(v); } catch (Exception) { }
                        if (!File.Exists(v)) return null;
                        return Path.GetFullPath(v);
                    }
                }
            }
            catch (Exception)
            {
                // missing hive / view, access denied: just not a candidate
                return null;
            }
        }

        // ------------------------------------------------------------------
        // 3. PATH

        private static void AddPathCandidates(List<Candidate> cs, HashSet<string> seen,
                                              string file, int line)
        {
            for (int i = 0; i < PathNames.Length; i++)
            {
                string p = FindOnPath(PathNames[i]);
                if (p == null) continue;
                if (!seen.Add(p)) continue;
                cs.Add(MakeCandidate(p, PathNames[i], file, line));
            }
        }

        /// <summary>Resolve a bare name against PATH, .exe before shell
        /// wrappers so an extensionless bash script cannot win by accident.</summary>
        private static string FindOnPath(string name)
        {
            name = Unquote((name ?? "").Trim());
            if (name.Length == 0) return null;
            string ext = Path.GetExtension(name);
            bool hasExt = ext != null && ext.Length > 0;
            string[] exts = hasExt ? new string[] { "" } : PathExts;
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] dirs = path.Split(';');

            for (int e = 0; e < exts.Length; e++)
            {
                for (int d = 0; d < dirs.Length; d++)
                {
                    string dir = dirs[d].Trim().Trim('"');
                    if (dir.Length == 0) continue;
                    try
                    {
                        string full = Path.Combine(dir, name + exts[e]);
                        if (File.Exists(full)) return Path.GetFullPath(full);
                    }
                    catch (Exception)
                    {
                        // malformed PATH entry: ignore it
                    }
                }
            }
            return null;
        }

        // ------------------------------------------------------------------
        // 4. launching

        private sealed class Candidate
        {
            public string Exe;
            public string Args;
            public string Label;
            public bool ViaCmd;
        }

        private static Candidate MakeCandidate(string exe, string label, string file, int line)
        {
            Candidate c = new Candidate();
            c.Exe = exe;
            c.Label = label;
            ApplyCmdWrapper(c);
            c.Args = BuildArgs(c.Exe, file, line);
            return c;
        }

        /// <summary>.cmd/.bat wrappers cannot be CreateProcess'd directly. For
        /// VS Code's bin\code.cmd we can usually find the real Code.exe one
        /// level up, which also avoids cmd.exe expanding % in the path.</summary>
        private static void ApplyCmdWrapper(Candidate c)
        {
            if (!IsCmdScript(c.Exe)) return;
            string upgraded = TryUpgradeCmd(c.Exe);
            if (upgraded != null) c.Exe = upgraded;
            else c.ViaCmd = true;
        }

        private static bool IsCmdScript(string p)
        {
            try
            {
                string e = Path.GetExtension(p);
                if (e == null) return false;
                e = e.ToLowerInvariant();
                return e == ".cmd" || e == ".bat";
            }
            catch (Exception) { return false; }
        }

        private static string TryUpgradeCmd(string cmdPath)
        {
            try
            {
                string dir = Path.GetDirectoryName(cmdPath);
                if (dir == null) return null;
                string name = Path.GetFileNameWithoutExtension(cmdPath).ToLowerInvariant();
                string[] rels;
                if (name == "code")
                    rels = new string[] { @"..\Code.exe", @"Code.exe", @"..\..\Code.exe" };
                else if (name == "code-insiders")
                    rels = new string[] { @"..\Code - Insiders.exe", @"Code - Insiders.exe", @"..\..\Code - Insiders.exe" };
                else
                    return null;
                for (int i = 0; i < rels.Length; i++)
                {
                    string p = Path.GetFullPath(Path.Combine(dir, rels[i]));
                    if (File.Exists(p)) return p;
                }
            }
            catch (Exception) { }
            return null;
        }

        private static string TryCandidates(List<Candidate> cs, List<string> failures)
        {
            for (int i = 0; i < cs.Count; i++)
            {
                Candidate c = cs[i];
                string err;
                if (TryLaunch(c, out err))
                {
                    Util.Log("Editor: launched " + c.Exe + " " + c.Args + "  [" + c.Label + "]");
                    return c.Label;
                }
                Util.Log("Editor: launch failed " + c.Exe + ": " + err);
                failures.Add(c.Label + " (" + c.Exe + "): " + err);
            }
            return null;
        }

        private static bool TryLaunch(Candidate c, out string error)
        {
            error = null;
            try
            {
                ProcessStartInfo psi;
                if (c.ViaCmd)
                {
                    string comspec = Environment.GetEnvironmentVariable("ComSpec");
                    if (string.IsNullOrEmpty(comspec))
                        comspec = Path.Combine(Environment.SystemDirectory, "cmd.exe");
                    // cmd's documented form for a quoted program:
                    //   /c ""C:\path with spaces\x.cmd" args"
                    psi = new ProcessStartInfo(comspec,
                        "/c \"\"" + c.Exe + "\" " + c.Args + "\"");
                }
                else
                {
                    psi = new ProcessStartInfo(c.Exe, c.Args);
                }
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process p = Process.Start(psi);
                return p != null;
            }
            catch (Exception e)
            {
                error = e.Message;
                return false;
            }
        }

        private static string BuildArgs(string exe, string file, int line)
        {
            string name = exe ?? "";
            try { name = Path.GetFileNameWithoutExtension(exe); } catch (Exception) { }
            bool code = name.IndexOf("code", StringComparison.OrdinalIgnoreCase) >= 0;
            bool sublime = name.IndexOf("subl", StringComparison.OrdinalIgnoreCase) >= 0;
            string target = line > 0
                ? file + ":" + line.ToString(System.Globalization.CultureInfo.InvariantCulture)
                : file;
            if (code)
                return line > 0 ? "--goto " + QuoteArg(target) : QuoteArg(file);
            if (sublime) return QuoteArg(target);
            return QuoteArg(file);
        }

        // ------------------------------------------------------------------
        // command-line helpers

        /// <summary>Resolve an exe name / path / App Paths entry to a real file.</summary>
        private static string ResolveProgram(string spec)
        {
            spec = Unquote((spec ?? "").Trim());
            if (spec.Length == 0) return null;
            try { spec = Environment.ExpandEnvironmentVariables(spec); } catch (Exception) { }

            try
            {
                if (File.Exists(spec)) return Path.GetFullPath(spec);

                bool hasDir = spec.IndexOf('\\') >= 0 || spec.IndexOf('/') >= 0 || Path.IsPathRooted(spec);
                string ext = Path.GetExtension(spec);
                bool hasExt = ext != null && ext.Length > 0;

                if (hasDir)
                {
                    if (!hasExt)
                    {
                        string[] tryExts = new string[] { ".exe", ".cmd", ".bat", ".com" };
                        for (int i = 0; i < tryExts.Length; i++)
                        {
                            string p = spec + tryExts[i];
                            if (File.Exists(p)) return Path.GetFullPath(p);
                        }
                    }
                    return null;
                }

                string found = FindOnPath(spec);
                if (found != null) return found;

                // "Code.exe" may be registered in App Paths and absent from PATH.
                return FindInAppPaths(spec);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string FindInAppPaths(string exeName)
        {
            RegistryHive[] hives = new RegistryHive[]
            {
                RegistryHive.CurrentUser, RegistryHive.LocalMachine, RegistryHive.LocalMachine,
            };
            RegistryView[] views = new RegistryView[]
            {
                RegistryView.Default, RegistryView.Registry64, RegistryView.Registry32,
            };
            for (int i = 0; i < hives.Length; i++)
            {
                string p = ReadAppPath(hives[i], views[i], exeName);
                if (p != null) return p;
            }
            return null;
        }

        private static string ExpandTemplate(string tpl, string file, int line)
        {
            string s = tpl;
            bool fileQuoted = false;
            int fi = s.IndexOf("{file}", StringComparison.OrdinalIgnoreCase);
            if (fi >= 0)
            {
                int after = fi + 6;
                fileQuoted = fi > 0 && s[fi - 1] == '"' && after < s.Length && s[after] == '"';
            }
            string fileArg = fileQuoted ? file : QuoteIfNeeded(file);
            s = ReplaceNoCase(s, "{file}", fileArg);
            if (line > 0)
            {
                s = ReplaceNoCase(s, "{line}",
                    line.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
            else
            {
                // No line known: drop the placeholder and the ":" that usually
                // precedes it, so we never leave a dangling "file:" argument.
                s = ReplaceNoCase(s, ":{line}", "");
                s = ReplaceNoCase(s, "{line}", "");
            }
            return s;
        }

        private static string ReplaceNoCase(string s, string find, string repl)
        {
            StringBuilder sb = new StringBuilder(s.Length + 16);
            int i = 0;
            while (true)
            {
                int j = s.IndexOf(find, i, StringComparison.OrdinalIgnoreCase);
                if (j < 0) { sb.Append(s, i, s.Length - i); break; }
                sb.Append(s, i, j - i);
                sb.Append(repl);
                i = j + find.Length;
            }
            return sb.ToString();
        }

        /// <summary>Split a Windows command line into argv (quotes removed).</summary>
        private static List<string> SplitArgs(string s)
        {
            List<string> parts = new List<string>();
            StringBuilder cur = new StringBuilder();
            bool inQuotes = false;
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                if (ch == '"') { inQuotes = !inQuotes; continue; }
                if (!inQuotes && (ch == ' ' || ch == '\t'))
                {
                    if (cur.Length > 0) { parts.Add(cur.ToString()); cur.Length = 0; }
                    continue;
                }
                cur.Append(ch);
            }
            if (cur.Length > 0) parts.Add(cur.ToString());
            return parts;
        }

        private static string Unquote(string s)
        {
            if (s == null) return "";
            s = s.Trim();
            if (s.Length >= 2 && s[0] == '"' && s[s.Length - 1] == '"')
                return s.Substring(1, s.Length - 2);
            return s;
        }

        private static string QuoteIfNeeded(string s)
        {
            if (s == null || s.Length == 0) return "\"\"";
            if (s.IndexOf(' ') >= 0 || s.IndexOf('\t') >= 0) return QuoteArg(s);
            return s;
        }

        /// <summary>Quote for CreateProcess / CommandLineToArgvW semantics:
        /// backslashes are only special immediately before a quote.</summary>
        private static string QuoteArg(string s)
        {
            if (s == null) return "\"\"";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            sb.Append('"');
            int backslashes = 0;
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                if (ch == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (ch == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                    backslashes = 0;
                    continue;
                }
                if (backslashes > 0) { sb.Append('\\', backslashes); backslashes = 0; }
                sb.Append(ch);
            }
            if (backslashes > 0) sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        private static string NotFoundMessage(List<string> failures)
        {
            string msg =
                "未找到可用的外部编辑器（已尝试 code / Code.exe / sublime_text / notepad++ / notepad）。\n" +
                "可设置环境变量 MD_EDITOR，例如：\n" +
                "  MD_EDITOR=\"code --goto {file}:{line}\"\n" +
                "No usable external editor found (tried code / Code.exe / sublime_text / notepad++ / notepad).\n" +
                "Set the environment variable MD_EDITOR, e.g. code --goto {file}:{line}";
            if (failures != null && failures.Count > 0)
            {
                msg += "\n启动失败记录 / launch failures:\n  " +
                       string.Join("\n  ", failures.ToArray());
            }
            return msg;
        }
    }
}
