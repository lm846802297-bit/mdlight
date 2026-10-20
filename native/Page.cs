using System;
using System.IO;
using System.Text;

namespace Mdlight
{
    /// <summary>
    /// Builds the viewer page from the embedded ui/index.html template.
    ///
    /// The body is intentionally empty: this host has no Node renderer, so the
    /// page fetches the markdown from /api/doc and renders it with
    /// window.MDLRenderer (the browser build of core/renderer.mjs). Node's
    /// mdlight.mjs fills __BODY__ server-side instead; both produce the same
    /// markup, which is why app.js is shared unchanged.
    /// </summary>
    internal static class Page
    {
        public const string Version = "0.9.3";

        public static string Build(Doc doc)
        {
            string tpl = Assets.GetText("index.html");
            if (tpl == null)
                throw new InvalidOperationException("index.html 不在资源包内");

            return tpl
                .Replace("__TITLE_HTML__", Util.HtmlAttr(doc.Name))
                .Replace("__FILENAME_HTML__", Util.HtmlAttr(doc.Name))
                .Replace("__FILEPATH_HTML__", Util.HtmlAttr(doc.FullPath))
                .Replace("__FILEPATH_JSON__", Util.JsonStr(doc.FullPath))
                .Replace("__VERSION__", Version)
                .Replace("__BODY__", "<p class=\"mdl-loading\">正在渲染…</p>")
                .Replace("__TOC_JSON__", "[]")
                .Replace("__EQ_COUNT__", "0")
                .Replace("__ERR_COUNT__", "0")
                .Replace("__MERMAID_COUNT__", "0")
                .Replace("__CLIENT_RENDER__", "true")
                // classic script: the page renders with the bundled renderer
                .Replace("<!--MDL:RENDERER-->",
                         "<script src=\"/assets/renderer.js\"></script>");
        }

        /// <summary>
        /// User theming without touching the app, same lookup order as the Node
        /// build: %APPDATA%\mdlight\custom.css, then custom.css beside the .md.
        /// </summary>
        public static string CustomCss(Doc doc)
        {
            try
            {
                string appData = Environment.GetFolderPath(
                    Environment.SpecialFolder.ApplicationData);
                string userCss = Path.Combine(Path.Combine(appData, "mdlight"), "custom.css");
                if (File.Exists(userCss)) return Util.ReadText(userCss);
            }
            catch (Exception) { /* %APPDATA% unavailable — fall through */ }

            try
            {
                string local = Path.Combine(doc.Dir, "custom.css");
                if (File.Exists(local)) return Util.ReadText(local);
            }
            catch (Exception) { }

            return "";
        }
    }
}
