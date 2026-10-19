using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Mdlight
{
    /// <summary>
    /// Writes a single self-contained HTML file that opens from file:// with no
    /// server and no network.
    ///
    /// Unlike the Node build, this host cannot pre-render (it has no renderer),
    /// so the export carries the markdown source plus the browser renderer and
    /// renders on load. Same trade-off as the live page, and it keeps the
    /// export honest rather than shipping an empty document.
    ///
    /// Mermaid is deliberately NOT bundled: it is ~5 MB of chunks and the
    /// exported page shows the diagram source with an explanatory hint, exactly
    /// like the Node export.
    /// </summary>
    internal static class Exporter
    {
        /// <summary>Checks that an absolute path stays within the document's
        /// directory — same guard as Server.HandleImage, so a malicious
        /// ![..](../../.ssh/id_rsa) cannot embed arbitrary local files into
        /// the exported HTML.</summary>
        private static bool IsWithinDir(string abs, string dir)
        {
            string prefix = dir.EndsWith("" + Path.DirectorySeparatorChar)
                ? dir : dir + Path.DirectorySeparatorChar;
            return abs.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }

        private static readonly Regex FontRef =
            new Regex(@"url\(fonts/([A-Za-z0-9_.\-]+)\)", RegexOptions.Compiled);
        private static readonly Regex ImgRef =
            new Regex("(<img[^>]+src=\")(?!data:|https?:|/)([^\"]+)(\")",
                      RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // The native page renders in the browser, so at export time there is no
        // <img> tag to rewrite yet — only the markdown source. Images therefore
        // have to be inlined in the SOURCE (![alt](./x.png) -> ![alt](data:...)),
        // which keeps the exported file self-contained once it is rendered.
        private static readonly Regex MdImgRef =
            new Regex(@"(!\[[^\]]*\]\(\s*)([^)\s""]+)(\s+""[^""]*"")?(\s*\))",
                      RegexOptions.Compiled);

        public static string DefaultOutPath(Doc doc)
        {
            return Path.Combine(doc.Dir,
                Path.GetFileNameWithoutExtension(doc.Name) + ".html");
        }

        public static string Write(Doc doc)
        {
            return Write(doc, DefaultOutPath(doc));
        }

        public static string Write(Doc doc, string outPath)
        {
            string source = InlineSourceImages(doc.ReadSource(), doc.Dir);
            string page = Page.Build(doc);

            string katexCss = FontRef.Replace(
                Assets.GetText("katex.min.css") ?? "",
                delegate(Match m) { return FontDataUri(m.Groups[1].Value); });

            string hljsCss = Assets.GetText("hljs-github.css") ?? "";
            string appCss = Assets.GetText("app.css") ?? "";
            string customCss = Page.CustomCss(doc);
            string renderer = Assets.GetText("renderer.js") ?? "";
            string appJs = Assets.GetText("app.js") ?? "";

            // The <link>/<script src> tags are removed unconditionally below, so
            // a missing asset would silently produce a blank/ugly export. Fail
            // loudly instead (the build's add() skips absent node_modules files).
            if (appCss.Length == 0) throw new InvalidOperationException("导出失败：缺少内嵌 app.css");
            if (appJs.Length == 0) throw new InvalidOperationException("导出失败：缺少内嵌 app.js");
            if (renderer.Length == 0) throw new InvalidOperationException("导出失败：缺少内嵌 renderer.js");
            if (katexCss.Length == 0) throw new InvalidOperationException("导出失败：缺少内嵌 katex.min.css");

            string styles =
                "<style>" + katexCss + "</style>\n" +
                "<style>" + hljsCss + "</style>\n" +
                "<style>" + appCss + "</style>\n" +
                "<style class=\"mdl-custom\">" + customCss + "</style>";

            // "</" would terminate the script element early, so escape it inside
            // the JSON literal (valid JS either way).
            string srcJson = Util.JsonStr(source).Replace("</", "<\\/");

            page = page
                .Replace("data-live", "data-static")
                // editing needs /api/save; hide the buttons in a static export
                .Replace("<button class=\"mdl-btn\" id=\"mdl-btn-wysiwyg\"",
                         "<button class=\"mdl-btn\" id=\"mdl-btn-wysiwyg\" hidden")
                .Replace("<button class=\"mdl-btn\" id=\"mdl-btn-edit\"",
                         "<button class=\"mdl-btn\" id=\"mdl-btn-edit\" hidden")
                .Replace("<link rel=\"stylesheet\" href=\"/assets/katex.css\">", "")
                .Replace("<link rel=\"stylesheet\" href=\"/assets/app.css\">", "")
                .Replace("<link rel=\"stylesheet\" href=\"/assets/custom.css\">", "")
                .Replace("<!--MDL:ASSETS-->", styles)
                .Replace("<script src=\"/assets/mdserial.js\"></script>", "")
                .Replace("<script src=\"/assets/wysiwyg.js\"></script>", "")
                .Replace("<script src=\"/assets/i18n.js\"></script>", "")
                .Replace("<script src=\"/assets/renderer.js\"></script>",
                         "<script>\n" + renderer + "\n</script>")
                .Replace("<script src=\"/assets/app.js\"></script>",
                         "<script>window.__MDL_SRC__ = " + srcJson + ";</script>\n" +
                         "<script>\n" + appJs + "\n</script>");

            page = ImgRef.Replace(page, delegate(Match m)
            {
                try
                {
                    string rel = m.Groups[2].Value;
                    string abs = Path.GetFullPath(Path.Combine(
                        doc.Dir, rel.Replace('/', Path.DirectorySeparatorChar)));
                    if (!IsWithinDir(abs, doc.Dir) || !File.Exists(abs)) return m.Value;
                    return m.Groups[1].Value +
                           "data:" + Util.MimeOf(Path.GetExtension(abs).ToLowerInvariant()) +
                           ";base64," + Util.Base64(File.ReadAllBytes(abs)) +
                           m.Groups[3].Value;
                }
                catch (Exception)
                {
                    return m.Value;
                }
            });

            Util.WriteText(outPath, page);
            return outPath;
        }

        /// <summary>Rewrite markdown image links to data URIs so the export stays
        /// a single file. Anything that is already self-contained (data:, http(s):,
        /// protocol-relative or absolute) is left alone, as is anything unreadable.</summary>
        public static string InlineSourceImages(string source, string docDir)
        {
            return MdImgRef.Replace(source, delegate(Match m)
            {
                try
                {
                    string rel = m.Groups[2].Value;
                    if (rel.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
                        || rel.StartsWith("http:", StringComparison.OrdinalIgnoreCase)
                        || rel.StartsWith("https:", StringComparison.OrdinalIgnoreCase)
                        || rel.StartsWith("//", StringComparison.Ordinal)   // protocol-relative
                        || rel.StartsWith("#"))
                        return m.Value;
                    string abs = Path.GetFullPath(Path.Combine(
                        docDir, rel.Replace('/', Path.DirectorySeparatorChar)));
                    if (!IsWithinDir(abs, docDir) || !File.Exists(abs)) return m.Value;
                    return m.Groups[1].Value +
                           "data:" + Util.MimeOf(Path.GetExtension(abs).ToLowerInvariant()) +
                           ";base64," + Util.Base64(File.ReadAllBytes(abs)) +
                           (m.Groups[3].Success ? m.Groups[3].Value : "") +
                           m.Groups[4].Value;
                }
                catch (Exception)
                {
                    return m.Value;
                }
            });
        }

        private static string FontDataUri(string name)
        {
            byte[] b = Assets.Get("fonts/" + name);
            if (b == null) return "url(fonts/" + name + ")";
            return "url(data:font/woff2;base64," + Util.Base64(b) + ")";
        }
    }
}
