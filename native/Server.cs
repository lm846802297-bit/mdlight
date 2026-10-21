using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Mdlight
{
    /// <summary>
    /// Loopback HTTP host with the same route surface as mdlight.mjs, so the
    /// unchanged ui/app.js works against either backend.
    ///
    /// Differences from the Node build, all forced by having no renderer here:
    ///   /            serves the template WITHOUT a rendered body + /api/doc
    ///   /assets/renderer.js  the browser build of core/renderer.mjs
    ///   /assets/fonts/*      served as files (Node base64-inlines them into
    ///                        katex.css instead, which would bloat every page)
    /// </summary>
    internal sealed class Server
    {
        private const int PortFirst = 20100;
        private const int PortAttempts = 40;

        private Doc doc;
        private HttpListener listener;
        private volatile bool stopping;
        private readonly List<SseClient> clients = new List<SseClient>();
        private readonly object clientsGate = new object();
        private FileSystemWatcher watcher;
        private Timer debounce;
        private readonly object debounceGate = new object();

        private static readonly Regex ChunkName =
            new Regex(@"^[A-Za-z0-9._-]+\.js$", RegexOptions.Compiled);
        private static readonly Regex ImageExt =
            new Regex(@"\.(png|jpe?g|gif|webp|svg|bmp|ico)$",
                      RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public int Port { get; private set; }
        public string BaseUrl { get { return "http://127.0.0.1:" + Port + "/"; } }

        public Server(Doc doc)
        {
            this.doc = doc;
        }

        public void Start()
        {
            Start(0);
        }

        /// <summary>preferred &gt; 0 asks for that exact port first (parity with
        /// the Node build's -p/--port); if it is taken we fall back to the scan
        /// range rather than refusing to open the document.</summary>
        public void Start(int preferred)
        {
            List<int> candidates = new List<int>();
            if (preferred > 0 && preferred <= 65535) candidates.Add(preferred);
            for (int i = 0; i < PortAttempts; i++) candidates.Add(PortFirst + i);

            for (int i = 0; i < candidates.Count; i++)
            {
                int port = candidates[i];
                HttpListener l = new HttpListener();
                try
                {
                    // Prefixes.Add itself throws for an out-of-range port, so it
                    // has to be inside the try to keep the fallback working.
                    l.Prefixes.Add("http://127.0.0.1:" + port + "/");
                    l.Start();
                    listener = l;
                    Port = port;
                    break;
                }
                catch (Exception)
                {
                    // port busy (another mdlight instance) — try the next one
                    try { l.Close(); } catch (Exception) { }
                }
            }
            if (listener == null)
                throw new InvalidOperationException(
                    "无法绑定本地端口 " + PortFirst + "-" + (PortFirst + PortAttempts - 1));

            Thread t = new Thread(AcceptLoop);
            t.IsBackground = true;
            t.Start();
            StartWatcher();
        }

        public void Stop()
        {
            stopping = true;
            try
            {
                if (watcher != null) { watcher.EnableRaisingEvents = false; watcher.Dispose(); }
            }
            catch (Exception) { }
            try { if (debounce != null) debounce.Dispose(); } catch (Exception) { }
            try { if (listener != null) listener.Stop(); } catch (Exception) { }
            try
            {
                lock (clientsGate) { clients.Clear(); }
            }
            catch (Exception) { }
        }

        /// <summary>
        /// A page on any other origin must not be able to drive this local API
        /// (POST /api/save with Content-Type text/plain is a CORS "simple
        /// request", so no preflight would stop it). Browsers always attach
        /// Sec-Fetch-Site, and same-origin fetch attaches Origin: reject anything
        /// that is not our own page.
        /// </summary>
        private bool IsTrustedRequest(HttpListenerRequest req)
        {
            string site = req.Headers["Sec-Fetch-Site"];
            if (!string.IsNullOrEmpty(site) &&
                site != "same-origin" && site != "none")
                return false;
            string origin = req.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin) &&
                origin != "http://127.0.0.1:" + Port)
                return false;
            return true;
        }

        // -- plumbing ---------------------------------------------------------

        private void AcceptLoop()
        {
            while (!stopping)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = listener.GetContext();
                }
                catch (Exception)
                {
                    // A shutdown makes GetContext throw; anything else is a
                    // transient HTTP.sys hiccup, which used to kill the loop
                    // while the window stayed open (page reloaded forever).
                    if (stopping) break;
                    Thread.Sleep(50);
                    continue;
                }
                // one thread per request: an SSE stream must not block accepts
                ThreadPool.QueueUserWorkItem(delegate(object o)
                {
                    HttpListenerContext c = (HttpListenerContext)o;
                    try { Handle(c); }
                    catch (Exception e)
                    {
                        try
                        {
                            c.Response.StatusCode = 500;
                            c.Response.ContentType = "text/plain; charset=utf-8";
                            byte[] b = Encoding.UTF8.GetBytes("error: " + e.Message);
                            c.Response.ContentLength64 = b.Length;
                            c.Response.OutputStream.Write(b, 0, b.Length);
                            c.Response.Close();
                        }
                        catch (Exception) { try { c.Response.Abort(); } catch (Exception) { } }
                    }
                }, ctx);
            }
        }

        private static string DecodePath(HttpListenerRequest req)
        {
            string raw = req.Url.AbsolutePath;
            try { return Uri.UnescapeDataString(raw); }
            catch (Exception) { return raw; }
        }

        private static void Send(HttpListenerResponse res, string type, byte[] body)
        {
            res.StatusCode = 200;
            res.ContentType = type;
            res.ContentLength64 = body.Length;
            res.OutputStream.Write(body, 0, body.Length);
            res.Close();
        }

        private static void SendText(HttpListenerResponse res, string type, string text)
        {
            Send(res, type, Encoding.UTF8.GetBytes(text));
        }

        private static void SendJson(HttpListenerResponse res, string json)
        {
            SendText(res, "application/json; charset=utf-8", json);
        }

        private static void SendError(HttpListenerResponse res, int code, string text)
        {
            res.StatusCode = code;
            res.ContentType = "text/plain; charset=utf-8";
            byte[] b = Encoding.UTF8.GetBytes(text);
            res.ContentLength64 = b.Length;
            res.OutputStream.Write(b, 0, b.Length);
            res.Close();
        }

        private static void SendPack(HttpListenerResponse res, string key, string mime)
        {
            byte[] b = Assets.Get(key);
            if (b == null)
            {
                SendError(res, 404, "missing asset: " + key);
                return;
            }
            Send(res, mime, b);
        }

        // -- routing ----------------------------------------------------------

        private void Handle(HttpListenerContext ctx)
        {
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;
            string path = DecodePath(req);

            // Only our own page may call the API: without this, any website
            // could POST /api/save (text/plain is a CORS simple request) and
            // overwrite the open document.
            if (path.StartsWith("/api/") || path == "/events")
            {
                if (!IsTrustedRequest(req)) { SendError(res, 403, "forbidden"); return; }
            }

            if (path == "/events")
            {
                // A live SSE stream lives for as long as the tab is open. Give it
                // a dedicated thread so reloads cannot pile up blocked ThreadPool
                // threads and stall page loads.
                HttpListenerResponse sse = res;
                Thread t = new Thread(delegate(object o)
                {
                    try { HandleEvents((HttpListenerResponse)o); } catch (Exception) { }
                });
                t.IsBackground = true;
                t.Start(sse);
                return;
            }

            if (path == "/api/doc" && string.IsNullOrEmpty(req.QueryString["path"]))
            {
                string src;
                try { src = doc.ReadSource(); }
                catch (Exception e)
                {
                    SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
                    return;
                }
                SendJson(res, "{\"ok\":true,\"source\":" + Util.JsonStr(src) +
                              ",\"sha\":" + Util.JsonStr(Util.Sha256Hex(src)) +
                              ",\"path\":" + Util.JsonStr(doc.FullPath) +
                              ",\"name\":" + Util.JsonStr(doc.Name) + "}");
                return;
            }
            // GET /api/doc?path=<abs> — read a second document for the split view
            if (path == "/api/doc" && !string.IsNullOrEmpty(req.QueryString["path"]))
            {
                string p = req.QueryString["path"];
                if (p == null || !System.IO.File.Exists(p))
                {
                    SendJson(res, "{\"ok\":false,\"error\":\"not found\"}");
                    return;
                }
                try
                {
                    string src = System.IO.File.ReadAllText(p);
                    string sha = Util.Sha256Hex(src);
                    SendJson(res, "{\"ok\":true,\"source\":" + Util.JsonStr(src) + ",\"path\":" + Util.JsonStr(p) + ",\"name\":" + Util.JsonStr(System.IO.Path.GetFileName(p)) + ",\"sha\":" + Util.JsonStr(sha) + "}");
                }
                catch (Exception ex)
                {
                    SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(ex.Message) + "}");
                }
                return;
            }


            if (path == "/api/source")
            {
                string src = doc.ReadSource();
                SendJson(res, "{\"ok\":true,\"source\":" + Util.JsonStr(src) +
                              ",\"sha\":" + Util.JsonStr(Util.Sha256Hex(src)) + "}");
                return;
            }

            if (path == "/api/config")
            {
                if (string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                    HandleConfigSave(req, res);
                else
                    HandleConfigGet(res);
                return;
            }

            // The ⚙ button: pop the settings dialog on its own STA thread (the
            // request thread must not block) and report when the dialog closes.
            if (path == "/api/settings")
            {
                Settings.ShowAsync(this);
                SendJson(res, "{\"ok\":true,\"settings\":true}");
                return;
            }

            // Self-update: check the latest release (GET) and download+apply (POST).
            if (path == "/api/update-check")
            {
                var info = Updater.Check(TimeSpan.FromSeconds(8));
                string json = "{\"ok\":true,\"hasUpdate\":" + (info.HasUpdate ? "true" : "false")
                    + ",\"error\":" + (info.Error ? "true" : "false")
                    + ",\"current\":\"" + Page.Version + "\""
                    + ",\"latest\":" + Util.JsonStr(info.LatestVersion)
                    + ",\"downloadUrl\":" + Util.JsonStr(info.DownloadUrl)
                    + ",\"message\":" + Util.JsonStr(info.Message) + "}";
                SendJson(res, json);
                return;
            }
            if (path == "/api/update-apply" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                string dl = req.QueryString["url"];
                string msg = Updater.DownloadAndApply(dl);
                SendJson(res, "{\"ok\":true,\"message\":" + Util.JsonStr(msg) + "}");
                return;
            }

            // .md file binding: install (default assoc + right-click) / unbind.
            if (path == "/api/bind" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                string msg = Mdlight.Shell.Install();
                SendJson(res, "{\"ok\":true,\"message\":" + Util.JsonStr(msg) + "}");
                return;
            }
            if (path == "/api/unbind" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                string msg = Mdlight.Shell.Uninstall();
                SendJson(res, "{\"ok\":true,\"message\":" + Util.JsonStr(msg) + "}");
                return;
            }

            if (path == "/api/save" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleSave(req, res);
                return;
            }

            if (path == "/api/open-editor")
            {
                // line may be absent: 0 means "unknown", so the launcher omits
                // the ":line" suffix instead of opening a bogus position.
                int line = 0;
                string q = req.QueryString["line"];
                if (!string.IsNullOrEmpty(q)) int.TryParse(q, out line);
                if (line < 0) line = 0;
                EditorLaunch r = Editor.OpenEx(doc.FullPath, line);
                if (r.Via == null)
                {
                    Util.Log("open-editor failed: " + r.Error);
                    SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(r.Error) +
                                  ",\"hint\":" + Util.JsonStr(
                                      "可设置环境变量 MD_EDITOR，例如 code --goto {file}:{line}") + "}");
                }
                else
                {
                    SendJson(res, "{\"ok\":true,\"via\":" + Util.JsonStr(r.Via) + "}");
                }
                return;
            }

            if (path == "/api/export")
            {
                HandleExport(res);
                return;
            }

            // 📂 open-file: the drop handler posts {name, content}; write the
            // dropped .md into the doc's directory and signal a reload so the
            // WebView2 picks it up on the next navigation.
            if (path == "/api/open-file" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleOpenFile(req, res);
                return;
            }

            // 📂 pick-file: Ctrl+O. Shows the Windows open dialog on the UI thread
            // and returns its path, so the page can hand it back to /api/open-file
            // ({path}) and switch the window to a real, editable document. Without
            // this the shortcut fell back to a client-side file input, which yields
            // a path-less copy that could not be saved.
            if (path == "/api/pick-file" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandlePickFile(res);
                return;
            }

            // ⇣ import-md: body {"name":"X.md","content":"...markdown..."}; write the
            // converted .md next to the doc and swap to it (一键导入 result).
            if (path == "/api/import-md" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleImportMd(req, res);
                return;
            }

            // 📊 export: the page posts the CSV text; we write it next to the doc.
            if (path == "/api/export-csv" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleExportCsv(req, res);
                return;
            }

            // TeX export: the page posts the converted .tex text; write it next to the doc.
            if (path == "/api/export-latex" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleExportLatex(req, res);
                return;
            }

            // 🖼 upload: raw image bytes in the body, written to <docdir>/assets.
            if (path == "/api/upload-asset" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleUploadAsset(req, res);
                return;
            }

            // -- static assets, all from the embedded pack --------------------
            if (path == "/assets/app.js") { SendPack(res, "app.js", "application/javascript; charset=utf-8"); return; }
            if (path == "/assets/mdserial.js") { SendPack(res, "mdserial.js", "application/javascript; charset=utf-8"); return; }
            if (path == "/assets/wysiwyg.js") { SendPack(res, "wysiwyg.js", "application/javascript; charset=utf-8"); return; }
            if (path == "/assets/i18n.js") { SendPack(res, "i18n.js", "application/javascript; charset=utf-8"); return; }
            if (path == "/assets/app.css") { SendPack(res, "app.css", "text/css; charset=utf-8"); return; }
            if (path == "/assets/renderer.js") { SendPack(res, "renderer.js", "application/javascript; charset=utf-8"); return; }
            if (path == "/assets/renderer-worker.js") { SendPack(res, "renderer-worker.js", "application/javascript; charset=utf-8"); return; }
            if (path == "/assets/katex.css") { SendPack(res, "katex.min.css", "text/css; charset=utf-8"); return; }
            if (path == "/assets/hljs.css") { SendPack(res, "hljs-github.css", "text/css; charset=utf-8"); return; }
            if (path == "/assets/custom.css")
            {
                SendText(res, "text/css; charset=utf-8", Page.CustomCss(doc));
                return;
            }

            // NB: katex.min.css references url(fonts/X.woff2) relatively, and
            // this css lives at /assets/katex.css — so those requests arrive as
            // /assets/fonts/X.woff2. No rewriting needed.
            if (path.StartsWith("/assets/fonts/", StringComparison.Ordinal))
            {
                string name = path.Substring("/assets/fonts/".Length);
                if (name.IndexOf('/') >= 0 || name.IndexOf('\\') >= 0)
                {
                    SendError(res, 400, "bad font name");
                    return;
                }
                SendPack(res, "fonts/" + name, "font/woff2");
                return;
            }

            if (path.StartsWith("/assets/mermaid/", StringComparison.Ordinal))
            {
                string rel = path.Substring("/assets/mermaid/".Length);
                // kinds.json is metadata, not a chunk — it has no .js suffix
                if (rel == "kinds.json")
                {
                    SendPack(res, "mermaid/kinds.json", "application/json; charset=utf-8");
                    return;
                }
                if (!ChunkName.IsMatch(rel))
                {
                    SendError(res, 400, "bad chunk name");
                    return;
                }
                SendPack(res, "mermaid/" + rel, "application/javascript; charset=utf-8");
                return;
            }

            if (ImageExt.IsMatch(path))
            {
                HandleImage(res, path);
                return;
            }

            if (path == "/" || path == "/index.html")
            {
                SendText(res, "text/html; charset=utf-8", Page.Build(doc));
                return;
            }

            SendError(res, 404, "not found");
        }

        private void HandleImage(HttpListenerResponse res, string path)
        {
            try
            {
                string rel = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                string abs = Path.GetFullPath(Path.Combine(doc.Dir, rel));
                // stay inside the document's directory — a missing guard here
                // would let a page read arbitrary files off the disk
                string prefix = Path.GetFullPath(doc.Dir);
                if (!prefix.EndsWith(Path.DirectorySeparatorChar.ToString()))
                    prefix += Path.DirectorySeparatorChar;
                if (!abs.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    SendError(res, 404, "image not found");
                    return;
                }
                if (!File.Exists(abs))
                {
                    SendError(res, 404, "image not found");
                    return;
                }
                Send(res, Util.MimeOf(Path.GetExtension(abs).ToLowerInvariant()),
                     File.ReadAllBytes(abs));
            }
            catch (Exception)
            {
                SendError(res, 404, "image not found");
            }
        }

        private void HandleSave(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body;
            try
            {
                if (req.ContentLength64 > 64L * 1024 * 1024)
                {
                    SendError(res, 413, "too large");
                    return;
                }
                using (Stream s = req.InputStream)
                {
                    body = Encoding.UTF8.GetString(Util.ReadAll(s));
                }
            }
            catch (Exception e)
            {
                SendError(res, 400, "read error: " + e.Message);
                return;
            }

            string source = null, baseSha = null;
            bool force = false;
            try
            {
                source = Json.GetString(body, "source");
                baseSha = Json.GetString(body, "base");
                force = Json.GetBool(body, "force");
            }
            catch (Exception e)
            {
                SendText(res, "application/json; charset=utf-8",
                         "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
                return;
            }

            if (source == null)
            {
                SendText(res, "application/json; charset=utf-8",
                         "{\"ok\":false,\"error\":\"source missing\"}");
                return;
            }

            SaveResult r = doc.Save(source, baseSha, force);
            if (r.Status == SaveStatus.Conflict)
            {
                res.StatusCode = 409;
                res.ContentType = "application/json; charset=utf-8";
                byte[] b = Encoding.UTF8.GetBytes(
                    "{\"ok\":false,\"conflict\":true,\"sha\":" + Util.JsonStr(r.Sha) + "}");
                res.ContentLength64 = b.Length;
                res.OutputStream.Write(b, 0, b.Length);
                res.Close();
                return;
            }
            if (r.Status == SaveStatus.Error)
            {
                SendText(res, "application/json; charset=utf-8",
                         "{\"ok\":false,\"error\":" + Util.JsonStr(r.Error) + "}");
                return;
            }
            SendJson(res, "{\"ok\":true,\"saved\":true,\"sha\":" + Util.JsonStr(r.Sha) + "}");
        }

        /// <summary>GET /api/config -> the whole user preferences object.</summary>
        private void HandleConfigGet(HttpListenerResponse res)
        {
            // Read the file fresh so the window reflects external edits too.
            string json;
            try
            {
                json = System.IO.File.Exists(Config.FilePath)
                    ? System.IO.File.ReadAllText(Config.FilePath, Encoding.UTF8)
                    : "{}\n";
            }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
                return;
            }
            SendText(res, "application/json; charset=utf-8", json);
        }

        /// <summary>POST /api/config -> merge a flat patch into the config file.</summary>
        private void HandleConfigSave(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body = null;
            try
            {
                if (req.HasEntityBody) body = Encoding.UTF8.GetString(Util.ReadAll(req.InputStream));
            }
            catch (Exception e)
            {
                SendError(res, 400, "read error: " + e.Message);
                return;
            }

            System.Collections.Generic.Dictionary<string, object> patch = null;
            try { patch = Json.GetObject(body); }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
                return;
            }
            if (patch == null || patch.Count == 0)
            {
                SendJson(res, "{\"ok\":false,\"error\":\"empty patch\"}");
                return;
            }
            // GetObject hands back raw JSON text for each value; normalise it so
            // Config stores the actual type rather than the quoted string.
            var typed = new System.Collections.Generic.Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Collections.Generic.KeyValuePair<string, object> kv in patch)
            {
                string raw = kv.Value as string;
                typed[kv.Key] = raw == null ? kv.Value : Normalise(raw);
            }
            try
            {
                Config.Set(typed);
            }
            catch (Exception ce)
            {
                Util.Log("Config.Set failed: " + ce.Message + " @ " + ce.StackTrace);
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(ce.Message) + "}");
                return;
            }
            SendJson(res, "{\"ok\":true,\"config\":true}");
        }

        private static object Normalise(string raw)
        {
            string t = raw.Trim();
            if (t.Length >= 2 && t[0] == '"' && t[t.Length - 1] == '"')
                return Json.GetString("{\"v\":" + t + "}", "v");
            if (t == "true") return true;
            if (t == "false") return false;
            if (t == "null") return null;
            double dv;
            if (double.TryParse(t, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out dv))
                return dv;
            return t;
        }

        private void HandleExport(HttpListenerResponse res)
        {
            try
            {
                string outPath = Exporter.Write(doc);
                SendJson(res, "{\"ok\":true,\"path\":" + Util.JsonStr(outPath) + "}");
            }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
            }
        }

        /// <summary>POST /api/export-csv?name=X.csv — body is the raw CSV text; write
        /// it beside the document. The frontend sends one request per table.</summary>
        /// <summary>Win32 reserved device names would be opened as devices rather
        /// than files (CON, NUL, LPT1, …).</summary>
        private static bool IsReservedDeviceName(string name)
        {
            string stem = Path.GetFileNameWithoutExtension(name).Trim().ToUpperInvariant();
            switch (stem)
            {
                case "CON": case "PRN": case "AUX": case "NUL":
                case "COM1": case "COM2": case "COM3": case "COM4": case "COM5":
                case "COM6": case "COM7": case "COM8": case "COM9":
                case "LPT1": case "LPT2": case "LPT3": case "LPT4": case "LPT5":
                case "LPT6": case "LPT7": case "LPT8": case "LPT9":
                    return true;
            }
            return false;
        }

        /// <summary>POST /api/open-file — body is {"name":"X.md","content":"..."};
        /// write the file next to the current doc and reload the watcher.</summary>
        /// <summary>POST /api/pick-file — Ctrl+O. Runs the open dialog on the UI
        /// thread and answers {ok:true,path:"…"} (path null when cancelled) or
        /// {ok:false,error:…}. --no-window hosts answer ok:false so the page falls
        /// back to its file input.</summary>
        private static void HandlePickFile(HttpListenerResponse res)
        {
            NativeWindow win = Program.Current;
            if (win == null)
            {
                SendJson(res, "{\"ok\":false,\"error\":\"no-window\"}");
                return;
            }
            string picked;
            try
            {
                // ShowDialog must not run on the listener's thread: the dialog needs
                // the STA UI thread that owns the window, and it needs an owner or it
                // can open behind the frameless window.
                picked = (string)win.Invoke(new Func<string>(Program.PickFile));
            }
            catch (Exception e)
            {
                Util.Log("pick-file failed: " + e.Message);
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
                return;
            }
            SendJson(res, "{\"ok\":true,\"path\":" +
                (picked == null ? "null" : Util.JsonStr(picked)) + "}");
        }

        private void HandleOpenFile(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body;
            try
            {
                if (req.ContentLength64 > 64L * 1024 * 1024)
                {
                    SendError(res, 413, "too large");
                    return;
                }
                using (Stream s = req.InputStream)
                {
                    body = Encoding.UTF8.GetString(Util.ReadAll(s));
                }
            }
            catch (Exception e)
            {
                SendError(res, 400, "read error: " + e.Message);
                return;
            }

            // Two call shapes:
            //   {path: "..."}  — switch to an existing file (tab manager)
            //   {name, content} — write a dropped new file into the doc dir
            string p = Json.GetString(body, "path");
            if (!string.IsNullOrEmpty(p))
            {
                try { p = System.IO.Path.GetFullPath(p); }
                catch (Exception) { }
                if (!System.IO.File.Exists(p))
                {
                    SendError(res, 404, "file not found");
                    return;
                }
                SwapDoc(new Doc(p));
                SendJson(res, "{\"ok\":true,\"path\":" + Util.JsonStr(p) + "}");
                return;
            }
            string name = Json.GetString(body, "name");
            string content = Json.GetString(body, "content");
            if (string.IsNullOrEmpty(name) || content == null)
            {
                SendError(res, 400, "path or (name+content) required");
                return;
            }
            // Only accept markdown files; strip any path component.
            name = System.IO.Path.GetFileName(name);
            if (!name.EndsWith(".md", StringComparison.OrdinalIgnoreCase) &&
                !name.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase))
            {
                SendError(res, 400, "only .md files can be dropped in");
                return;
            }
            string outPath = System.IO.Path.Combine(doc.Dir, name);
            System.IO.File.WriteAllText(outPath, content, new UTF8Encoding(false));
            // Re-point the watcher at the new file and tell the page to reload.
            SwapDoc(new Doc(outPath));
            SendJson(res, "{\"ok\":true,\"path\":" + Util.JsonStr(outPath) + "}");
        }

        /// <summary>POST /api/import-md — body {"name":"X.md","content":"...markdown..."};
        /// write the converted markdown next to the doc and swap to it. Same shape
        /// and guards as the "drop" branch of HandleOpenFile, so an imported
        /// PDF/LaTeX → Markdown result becomes an editable document immediately.</summary>
        private void HandleImportMd(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                if (req.ContentLength64 > 64L * 1024 * 1024)
                {
                    SendError(res, 413, "too large");
                    return;
                }
                string body;
                using (Stream s = req.InputStream)
                {
                    body = Encoding.UTF8.GetString(Util.ReadAll(s));
                }
                string name = Json.GetString(body, "name");
                string content = Json.GetString(body, "content");
                if (string.IsNullOrEmpty(name) || content == null)
                {
                    SendError(res, 400, "name+content required");
                    return;
                }
                name = System.IO.Path.GetFileName(name);
                if (!name.EndsWith(".md", StringComparison.OrdinalIgnoreCase) &&
                    !name.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase))
                {
                    SendError(res, 400, "name must be a .md file");
                    return;
                }
                string outPath = System.IO.Path.Combine(doc.Dir, name);
                if (string.Equals(System.IO.Path.GetFullPath(outPath), doc.FullPath,
                                  StringComparison.OrdinalIgnoreCase))
                {
                    SendError(res, 400, "refusing to overwrite the open document");
                    return;
                }
                System.IO.File.WriteAllText(outPath, content, new UTF8Encoding(false));
                SwapDoc(new Doc(outPath));
                SendJson(res, "{\"ok\":true,\"path\":" + Util.JsonStr(outPath) + "}");
            }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
            }
        }

        private void HandleExportCsv(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                if (req.ContentLength64 > 64L * 1024 * 1024)
                {
                    SendError(res, 413, "too large");
                    return;
                }
                string csv;
                using (Stream s = req.InputStream)
                {
                    csv = Encoding.UTF8.GetString(Util.ReadAll(s));
                }
                string name = req.QueryString["name"];
                if (string.IsNullOrEmpty(name)) name = Path.GetFileNameWithoutExtension(doc.Name) + ".csv";
                name = Path.GetFileName(name); // strip any path component
                // Must stay a .csv inside the doc dir: without this,
                // ?name=paper.md replaced the markdown source with the CSV text.
                if (!name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)
                    || name.IndexOf(':') >= 0
                    || IsReservedDeviceName(name))
                {
                    SendError(res, 400, "name must be a .csv file");
                    return;
                }
                string outPath = Path.Combine(doc.Dir, name);
                if (string.Equals(Path.GetFullPath(outPath), doc.FullPath,
                                  StringComparison.OrdinalIgnoreCase))
                {
                    SendError(res, 400, "refusing to overwrite the document");
                    return;
                }
                // UTF-8 BOM so Excel opens it without mangling Chinese.
                System.IO.File.WriteAllText(outPath, csv, new UTF8Encoding(true));
                SendJson(res, "{\"ok\":true,\"path\":" + Util.JsonStr(outPath) + "}");
            }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
            }
        }

        /// <summary>POST /api/export-latex?name=X.tex — body is the .tex text produced
        /// by the page's mdToLatex(); written next to the markdown document.</summary>
        private void HandleExportLatex(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                if (req.ContentLength64 > 64L * 1024 * 1024)
                {
                    SendError(res, 413, "too large");
                    return;
                }
                string tex;
                using (Stream s = req.InputStream)
                {
                    tex = Encoding.UTF8.GetString(Util.ReadAll(s));
                }
                string name = req.QueryString["name"];
                if (string.IsNullOrEmpty(name)) name = Path.GetFileNameWithoutExtension(doc.Name) + ".tex";
                name = Path.GetFileName(name);
                if (!name.EndsWith(".tex", StringComparison.OrdinalIgnoreCase)
                    || name.IndexOf(':') >= 0
                    || IsReservedDeviceName(name))
                {
                    SendError(res, 400, "name must be a .tex file");
                    return;
                }
                string outPath = Path.Combine(doc.Dir, name);
                if (string.Equals(Path.GetFullPath(outPath), doc.FullPath,
                                  StringComparison.OrdinalIgnoreCase))
                {
                    SendError(res, 400, "refusing to overwrite the document");
                    return;
                }
                // No BOM for .tex — LaTeX toolchains are BOM-hostile.
                System.IO.File.WriteAllText(outPath, tex, new UTF8Encoding(false));
                SendJson(res, "{\"ok\":true,\"path\":" + Util.JsonStr(outPath) + "}");
            }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
            }
        }

        /// <summary>POST /api/upload-asset?name=X.png — raw image bytes in the
        /// body; write them to &lt;docdir&gt;/assets and return the relative path
        /// so the page can insert ![](assets/X.png).</summary>
        private void HandleUploadAsset(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                string name = req.QueryString["name"];
                if (string.IsNullOrEmpty(name))
                {
                    SendError(res, 400, "name missing");
                    return;
                }
                name = Path.GetFileName(name);
                if (!ImageExt.IsMatch(name))
                {
                    SendError(res, 400, "not an image");
                    return;
                }
                if (req.ContentLength64 > 32L * 1024 * 1024)
                {
                    SendError(res, 413, "too large");
                    return;
                }
                byte[] data;
                using (Stream s = req.InputStream)
                {
                    data = Util.ReadAll(s);
                }
                string dir = Path.Combine(doc.Dir, "assets");
                Directory.CreateDirectory(dir);
                string outPath = Path.Combine(dir, name);
                System.IO.File.WriteAllBytes(outPath, data);
                SendJson(res, "{\"ok\":true,\"path\":\"assets/" + name + "\"}");
            }
            catch (Exception e)
            {
                SendJson(res, "{\"ok\":false,\"error\":" + Util.JsonStr(e.Message) + "}");
            }
        }

        // -- server-sent events ----------------------------------------------

        private void HandleEvents(HttpListenerResponse res)
        {
            SseClient client = new SseClient();
            client.Res = res;
            try
            {
                res.StatusCode = 200;
                res.ContentType = "text/event-stream";
                res.SendChunked = true;
                res.KeepAlive = true;
                try { res.Headers.Add("Cache-Control", "no-cache"); } catch (Exception) { }

                WriteToClient(client, Encoding.UTF8.GetBytes("retry: 1000\n\n"));
                lock (clientsGate) clients.Add(client);
            }
            catch (Exception)
            {
                try { res.Abort(); } catch (Exception) { }
                return;
            }

            // HttpListener exposes no disconnect event, so keep the stream alive
            // with a comment ping and treat a failed write as "client is gone".
            // Runs on its own thread (see the /events dispatch) so a reload does
            // not park a ThreadPool thread for the whole ping interval.
            try
            {
                while (!stopping)
                {
                    Thread.Sleep(4000);
                    WriteToClient(client, Encoding.UTF8.GetBytes(": ping\n\n"));
                }
            }
            catch (Exception) { }
            finally
            {
                lock (clientsGate) clients.Remove(client);
                try { res.Close(); } catch (Exception) { }
            }
        }

        /// <summary>One live SSE stream. Each client carries its own write lock:
        /// a single stalled reader used to block every other broadcast because
        /// all writes shared one gate.</summary>
        private sealed class SseClient
        {
            public HttpListenerResponse Res;
            public readonly object Gate = new object();
        }

        private void WriteToClient(SseClient client, byte[] data)
        {
            lock (client.Gate)
            {
                client.Res.OutputStream.Write(data, 0, data.Length);
                client.Res.OutputStream.Flush();
            }
        }

        public void Reload()
        {
            BroadcastReload();
        }

        /// <summary>Stop the file watcher (call before re-pointing it).</summary>
        public void StopWatcher()
        {
            if (watcher != null)
            {
                watcher.EnableRaisingEvents = false;
                watcher.Dispose();
                watcher = null;
            }
        }

        /// <summary>Swap the document this server serves without restarting.
        /// Used by the native drag-and-drop open: the WebView2 is re-navigated
        /// to the new doc's URL and the file watcher is re-pointed.</summary>
        public void SwapDoc(Doc newDoc)
        {
            this.doc = newDoc;
            StopWatcher();
            StartWatcher();
            BroadcastReload();
        }

        private void BroadcastReload()
        {
            byte[] msg = Encoding.UTF8.GetBytes("data: reload\n\n");
            List<SseClient> snapshot;
            lock (clientsGate)
            {
                if (clients.Count == 0) return;
                snapshot = new List<SseClient>(clients);
            }
            // Write outside clientsGate so one slow client cannot stall new SSE
            // registrations or the debounce thread.
            List<SseClient> dead = null;
            for (int i = 0; i < snapshot.Count; i++)
            {
                try { WriteToClient(snapshot[i], msg); }
                catch (Exception)
                {
                    if (dead == null) dead = new List<SseClient>();
                    dead.Add(snapshot[i]);
                }
            }
            if (dead != null)
            {
                lock (clientsGate)
                {
                    for (int i = 0; i < dead.Count; i++) clients.Remove(dead[i]);
                }
            }
        }

        // -- file watching ----------------------------------------------------

        private void StartWatcher()
        {
            watcher = new FileSystemWatcher(doc.Dir);
            watcher.IncludeSubdirectories = false;
            watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite |
                                   NotifyFilters.Size | NotifyFilters.CreationTime;
            watcher.Changed += OnFsEvent;
            watcher.Created += OnFsEvent;
            watcher.Deleted += OnFsEvent;
            watcher.Renamed += OnFsRenamed;
            watcher.Error += delegate(object s, ErrorEventArgs e)
            {
                // buffer overflow on a busy directory: nothing to do, the next
                // real edit still arrives as a fresh event
            };
            watcher.EnableRaisingEvents = true;
        }

        private void OnFsRenamed(object sender, RenamedEventArgs e)
        {
            // editors save atomically: write temp, rename over the target
            OnFsEvent(sender, e);
        }

        private void OnFsEvent(object sender, FileSystemEventArgs e)
        {
            string name = Path.GetFileName(e.FullPath);
            if (!string.Equals(name, doc.Name, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(name, "custom.css", StringComparison.OrdinalIgnoreCase))
                return;

            lock (debounceGate)
            {
                if (debounce != null) debounce.Dispose();
                // 150 ms coalesces the burst an atomic save produces
                debounce = new Timer(delegate(object o) { BroadcastReload(); },
                                     null, 150, Timeout.Infinite);
            }
        }
    }

    /// <summary>Just enough JSON reading for POST /api/save's three fields.
    /// Hand-rolled rather than dragging in JavaScriptSerializer.</summary>
    internal static class Json
    {
        public static string GetString(string json, string key)
        {
            object v = Get(json, key);
            return v as string;
        }

        public static bool GetBool(string json, string key)
        {
            object v = Get(json, key);
            return v is bool && (bool)v;
        }

        /// <summary>Parse a flat JSON object into a key/value map. Values that are
        /// themselves objects/arrays are kept as their raw JSON string, so the
        /// patch can carry nested blocks without losing structure.</summary>
        public static System.Collections.Generic.Dictionary<string, object> GetObject(string json)
        {
            var map = new System.Collections.Generic.Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrEmpty(json)) return map;
            int n = json.Length, i = 0;
            SkipWs(json, ref i, n);
            if (i >= n || json[i] != '{') return map;
            i++; SkipWs(json, ref i, n);
            while (i < n && json[i] != '}')
            {
                SkipWs(json, ref i, n);
                string key = ReadString(json, ref i, n);
                SkipWs(json, ref i, n);
                if (i < n && json[i] == ':') i++;
                SkipWs(json, ref i, n);
                string val = ReadRawValue(json, ref i, n);
                map[key] = val;
                SkipWs(json, ref i, n);
                if (i < n && json[i] == ',') { i++; SkipWs(json, ref i, n); }
                else break;
            }
            return map;
        }

        private static void SkipWs(string json, ref int i, int n)
        {
            while (i < n && char.IsWhiteSpace(json[i])) i++;
        }

        private static string ReadString(string json, ref int i, int n)
        {
            SkipWs(json, ref i, n);
            if (i >= n || json[i] != '"') return "";
            i++;  // opening quote
            var sb = new System.Text.StringBuilder();
            while (i < n && json[i] != '"')
            {
                if (json[i] == '\\' && i + 1 < n)
                {
                    char e = json[i + 1];
                    if (e == 'n') sb.Append('\n');
                    else if (e == 'r') sb.Append('\r');
                    else if (e == 't') sb.Append('\t');
                    else if (e == 'b') sb.Append('\b');
                    else if (e == 'f') sb.Append('\f');
                    else if (e == 'u' && i + 5 < n)
                    {
                        int code = Convert.ToInt32(json.Substring(i + 2, 4), 16);
                        sb.Append((char)code);
                        i += 4;
                    }
                    else sb.Append(e);
                    i += 2;
                }
                else { sb.Append(json[i]); i++; }
            }
            i++;  // closing quote
            return sb.ToString();
        }

        /// <summary>Read one value as raw text, keeping strings unescaped only for
        /// the caller to re-serialise.</summary>
        private static string ReadRawValue(string json, ref int i, int n)
        {
            SkipWs(json, ref i, n);
            if (i >= n) return "";
            char c = json[i];
            if (c == '"')
            {
                int st = i; i++;
                while (i < n)
                {
                    if (json[i] == '\\') { i++; if (i < n) i++; continue; }
                    if (json[i] == '"') { i++; break; }
                    i++;
                }
                return json.Substring(st, i - st);
            }
            if (c == '{' || c == '[')
            {
                int st = i, depth = 0;
                bool inStr = false;
                while (i < n)
                {
                    char ch = json[i];
                    if (inStr) { if (ch == '"' && json[i - 1] != '\\') inStr = false; }
                    else if (ch == '"') inStr = true;
                    else if (ch == c) depth++;
                    else if (ch == (c == '{' ? '}' : ']')) { depth--; if (depth == 0) { i++; break; } }
                    i++;
                }
                return json.Substring(st, i - st);
            }
            int st2 = i;
            while (i < n && json[i] != ',' && json[i] != '}' && !char.IsWhiteSpace(json[i])) i++;
            return json.Substring(st2, i - st2);
        }

        private static object Get(string json, string key)
        {
            int i = FindValue(json, key);
            if (i < 0) return null;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length) return null;

            if (json[i] == '"')
            {
                StringBuilder sb = new StringBuilder();
                i++;
                while (i < json.Length && json[i] != '"')
                {
                    char c = json[i];
                    if (c == '\\' && i + 1 < json.Length)
                    {
                        i++;
                        char e = json[i];
                        switch (e)
                        {
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'u':
                                sb.Append((char)Convert.ToInt32(
                                    json.Substring(i + 1, 4), 16));
                                i += 4;
                                break;
                            default: sb.Append(e); break;
                        }
                        i++;
                    }
                    else { sb.Append(c); i++; }
                }
                return sb.ToString();
            }

            if (json.Length >= i + 4 && string.CompareOrdinal(json, i, "true", 0, 4) == 0) return true;
            if (json.Length >= i + 5 && string.CompareOrdinal(json, i, "false", 0, 5) == 0) return false;
            return null;
        }

        /// <summary>Finds the value of a top-level key in a flat JSON object.
        /// Walks the string once; a quoted string whose previous significant
        /// character is { or , and which is followed by : counts as a key.
        /// A string value that spells the key is never mistaken for the key.</summary>
        private static int FindValue(string json, string key)
        {
            string needle = "\"" + key + "\"";
            int n = json.Length;
            int i = 0;
            bool atKeyPos = true;  // true at start and right after { [ ,
            while (i < n)
            {
                char c = json[i];
                if (char.IsWhiteSpace(c)) { i++; continue; }
                if (c == '{' || c == '[') { i++; atKeyPos = true; continue; }
                if (c == '}' || c == ']' || c == ':') { i++; atKeyPos = false; continue; }
                if (c == ',') { i++; atKeyPos = true; continue; }
                if (c == '"')
                {
                    int j = i + 1;
                    while (j < n)
                    {
                        if (json[j] == '\\') { j += 2; continue; }
                        if (json[j] == '"') break;
                        j++;
                    }
                    if (atKeyPos && json.Substring(i, j - i + 1) == needle)
                    {
                        int k = j + 1;
                        while (k < n && char.IsWhiteSpace(json[k])) k++;
                        if (k < n && json[k] == ':') return k + 1;
                    }
                    i = j + 1;
                    atKeyPos = false;
                    continue;
                }
                while (i < n && json[i] != ',' && json[i] != '}' &&
                       json[i] != ']' && json[i] != ':' && !char.IsWhiteSpace(json[i])) i++;
                atKeyPos = false;
            }
            return -1;
        }
    }
}
