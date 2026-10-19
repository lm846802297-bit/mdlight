using System;
using System.IO;
using System.Text;

namespace Mdlight
{
    /// <summary>Small helpers shared by the host. No external dependencies.</summary>
    internal static class Util
    {
        public static byte[] ReadAll(Stream s)
        {
            return ReadAll(s, 64L * 1024 * 1024);
        }

        /// <summary>Capped read. ContentLength64 is unknown(-1) for a chunked
        /// request, so the per-route length guards can be bypassed; enforcing the
        /// ceiling here is what actually stops a huge body being buffered.</summary>
        public static byte[] ReadAll(Stream s, long max)
        {
            using (MemoryStream ms = new MemoryStream())
            {
                byte[] buf = new byte[81920];
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0)
                {
                    ms.Write(buf, 0, n);
                    if (ms.Length > max)
                        throw new InvalidOperationException("request body too large");
                }
                return ms.ToArray();
            }
        }

        /// <summary>Lowercase hex sha256 — same value the Node side produces
        /// (`createHash('sha256').update(s,'utf8').digest('hex')`), so the
        /// source editor's conflict check behaves identically in both hosts.</summary>
        public static string Sha256Hex(string text)
        {
            using (System.Security.Cryptography.SHA256 sha =
                   System.Security.Cryptography.SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                StringBuilder sb = new StringBuilder(h.Length * 2);
                for (int i = 0; i < h.Length; i++) sb.Append(h[i].ToString("x2"));
                return sb.ToString();
            }
        }

        public static string HtmlAttr(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '&': sb.Append("&amp;"); break;
                    case '<': sb.Append("&lt;"); break;
                    case '>': sb.Append("&gt;"); break;
                    case '"': sb.Append("&quot;"); break;
                    default: sb.Append(c); break;
                }
            }
            return sb.ToString();
        }

        /// <summary>JSON string literal. Hand-rolled because the in-box
        /// JavaScriptSerializer would pull in a much larger surface for one
        /// trivial job.</summary>
        public static string JsonStr(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        public static string MimeOf(string ext)
        {
            switch (ext)
            {
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".webp": return "image/webp";
                case ".svg": return "image/svg+xml";
                case ".bmp": return "image/bmp";
                case ".ico": return "image/x-icon";
                default: return "application/octet-stream";
            }
        }

        /// <summary>Reads UTF-8 without stripping a BOM — Node's
        /// readFileSync(p,'utf8') keeps U+FEFF too, and matching that keeps
        /// the sha256 conflict check byte-identical between hosts.</summary>
        public static string ReadText(string path)
        {
            return Encoding.UTF8.GetString(File.ReadAllBytes(path));
        }

        public static void WriteText(string path, string text)
        {
            File.WriteAllBytes(path, Encoding.UTF8.GetBytes(text));
        }

        public static string Base64(byte[] b)
        {
            return Convert.ToBase64String(b);
        }

        /// <summary>Append-only diagnostic log. Used to debug the launch path
        /// (WebView2 init, window show) on user machines where the winexe gives
        /// no console and the failure is otherwise invisible.</summary>
        public static void Log(string msg)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "mdlight", "native");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "debug.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + Environment.NewLine);
            }
            catch (Exception) { /* logging must never break the app */ }
        }
    }
}
