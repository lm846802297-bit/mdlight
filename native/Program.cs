using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.IO.Pipes;
using System.Text;
using System.Runtime;
using System.Windows.Forms;

namespace Mdlight
{
    /// <summary>
    /// Native mdlight host: .NET Framework + WebView2 (system Chromium).
    ///
    /// Why this exists: the Node SEA build has to ship node.exe verbatim
    /// (~89 MB of V8) because Node cannot be trimmed. This host is about 1 MB
    /// of IL on top of the WebView2 runtime that Windows 11 already installs.
    ///
    /// Division of labour: C# owns the window, the HTTP server, file watching
    /// and disk I/O; everything that renders markdown stays in the existing
    /// JavaScript (core/renderer.mjs) so both hosts produce identical output.
    /// No WebView2 type is touched before the assembly resolver is installed
    /// (see BootstrapNative) — hence the split between Main and ShowWindow.
    /// </summary>
    internal static class Program
    {
        private const string AppTitle = "mdlight";
private static readonly string MutexName = "Globalmdlight-single-" +
            (Environment.GetEnvironmentVariable("USERNAME") ?? "default");
        // The named pipe the primary instance listens on; a second instance
        // connects, writes the file path, and the primary swaps its doc.
        private const string PipeName = "mdlight-hotopen";

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string lpPathName);

        [DllImport("kernel32.dll")]
        private static extern bool AttachConsole(uint dwProcessId);

        [DllImport("kernel32.dll")]
        private static extern bool FreeConsole();

        [STAThread]
        private static int Main(string[] argv)
        {
            // WinForms must be initialised BEFORE any control is created.
            // OpenFileDialog (PickFile) and the window are both IWin32Window
            // controls; calling these two after the first one throws
            // InvalidOperationException, which silently kills a winexe.
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // ---- argument parsing (mirrors mdlight.mjs) --------------------
            string file = null;
            string exportPath = null;
            bool export = false;
            bool noWindow = false;
            bool install = false;
            bool uninstall = false;
            bool unbind = false;
            bool settings = false;
            bool updateCheck = false;
            int forcedPort = 0;
            bool help = false;
            bool version = false;

            for (int i = 0; i < argv.Length; i++)
            {
                string a = argv[i];
                if (a == "--help" || a == "-h") { help = true; }
                else if (a == "--version" || a == "-v") { version = true; }
                else if (a == "--install" || a == "-i") { install = true; }
                else if (a == "--uninstall" || a == "-u") { uninstall = true; }
                else if (a == "--unbind") { unbind = true; }
                else if (a == "--settings") { settings = true; }
                else if (a == "--update-check") { updateCheck = true; }
                else if (a == "--check-update") { updateCheck = true; }
                else if (a == "--export")
                {
                    export = true;
                    if (i + 1 < argv.Length && !argv[i + 1].StartsWith("-"))
                        exportPath = argv[++i];
                }
                else if (a == "--no-window" || a == "--headless") { noWindow = true; }
                else if (a == "--port" || a == "-p")
                {
                    // Only consume the next token when it really is a port:
                    // "mdlight.exe --port paper.md" used to swallow the document.
                    int p;
                    if (i + 1 < argv.Length && int.TryParse(argv[i + 1], out p)
                        && p > 0 && p <= 65535)
                    {
                        forcedPort = p;
                        i++;
                    }
                }
                else if (a.StartsWith("-") && a.Length > 1)
                {
                    // unknown flag: ignore rather than refuse to open a file
                }
                else if (file == null) { file = a; }
            }

            if (help) { WriteConsole(HelpText()); return 0; }
            if (version) { WriteConsole(AppTitle + " " + Page.Version + " (native)"); return 0; }

            // ---- system integration --------------------------------------
            if (install) { WriteConsole(Shell.Install()); return 0; }
            if (uninstall) { WriteConsole(Shell.Uninstall()); return 0; }
            if (unbind) { WriteConsole(Shell.Unbind()); return 0; }
            // --settings stands alone: no document is opened, the dialog just
            // edits the shared config.json that every future window reads.
            if (settings) { Settings.Show(null); return 0; }
            // --update-check: query the update source, print result, exit.
            if (updateCheck)
            {
                var ui = Updater.Check(TimeSpan.FromSeconds(8));
                WriteConsole(ui.Message + (ui.DownloadUrl != null && ui.HasUpdate
                    ? "\n  下载: " + ui.DownloadUrl : ""));
                return 0;
            }

            // ---- single-instance + CLI hot-send ---------------------------------
            // If another mdlight window is already open, forward the file to it
            // via the named pipe and exit — no second window, no port clash.
            // --no-window and --export are exempt (they don't open a window).
            if (!noWindow && !export)
            {
                bool created;
                Mutex instanceMutex =
                    new Mutex(true, MutexName, out created);
                if (!created)
                {
                    Util.Log("second instance detected, forwarding to pipe");
                    bool forwarded = ForwardToPrimary(file);
                    instanceMutex.Close();
                    if (forwarded)
                    {
                        WriteConsole("已转发给正在运行的 mdlight: " +
                                      (file ?? "<当前文件>"));
                        return 0;
                    }
                    // forwarding failed: fall through and open a new window
                }
                else
                {
                    // we are the primary — start the hot-open pipe listener
                    StartPipeListener();
                    // the listener thread closure keeps instanceMutex alive for the process lifetime
                }
            }

            // ---- pick a document ------------------------------------------
            if (file == null)
            {
                Util.Log("PickFile: showing OpenFileDialog");
                string picked = PickFile();
                Util.Log("PickFile: returned " + (picked ?? "<cancel>"));
                if (picked == null) return 2;
                file = picked;
            }
            Util.Log("file=" + file);
            try { file = Path.GetFullPath(file); }
            catch (Exception pe)
            {
                Util.Log("GetFullPath failed: " + pe.Message);
                MessageBox.Show("无法解析路径:\n" + file + "\n\n" + pe.Message, AppTitle,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            if (!File.Exists(file))
            {
                Util.Log("file missing: " + file);
                MessageBox.Show("文件不存在:\n" + file, AppTitle,
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            Doc doc;
            try
            {
                Assets.Init();              // fail fast on a broken build
                Util.Log("Assets.Init ok");
                doc = new Doc(file);
                string src0 = doc.ReadSource();           // readable / correct encoding?
                Util.Log("ReadSource ok, len=" + src0.Length);
            }
            catch (Exception e)
            {
                Util.Log("ReadSource FAILED: " + e);
                MessageBox.Show("无法读取文件:\n" + e.Message, AppTitle,
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            // ---- export only ----------------------------------------------
            if (export)
            {
                try
                {
                    string outPath = exportPath == null
                        ? Exporter.DefaultOutPath(doc)
                        : Path.GetFullPath(exportPath);
                    // Refuse to overwrite the markdown source with HTML: it
                    // used to be possible with `mdlight.exe --export paper.md`.
                    string outFull = Path.GetFullPath(outPath);
                    if (string.Equals(outFull, doc.FullPath, StringComparison.OrdinalIgnoreCase)
                        || outFull.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
                        || outFull.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase))
                    {
                        MessageBox.Show("导出路径不能是 Markdown 源文件:\n" + outFull, AppTitle,
                                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return 1;
                    }
                    Exporter.Write(doc, outPath);
                    WriteConsole("导出完成: " + outPath + "  (" +
                                 new FileInfo(outPath).Length + " 字节)");
                    return 0;
                }
                catch (Exception e)
                {
                    MessageBox.Show("导出失败:\n" + e.Message, AppTitle,
                                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
            }

            // ---- serve ----------------------------------------------------
            Server server = new Server(doc);
            CurrentServer = server;
            try
            {
                server.Start(forcedPort);
                Util.Log("Server.Start ok, baseUrl=" + server.BaseUrl);
            }
            catch (Exception e)
            {
                Util.Log("Server.Start FAILED: " + e);
                MessageBox.Show("无法启动本地服务:\n" + e.Message, AppTitle,
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            if (forcedPort != 0 && forcedPort != server.Port)
                WriteConsole("port " + forcedPort + " busy, using " + server.Port);

            if (noWindow)
            {
                // headless mode for scripting/tests: serve until killed
                Util.Log("no-window: serving " + server.BaseUrl);
                WriteConsole("mdlight serving " + server.BaseUrl);
                ManualResetEvent done = new ManualResetEvent(false);
                done.WaitOne();
                return 0;
            }

            Util.Log("calling ShowWindow");
            int rc = ShowWindow(server, doc);
            Util.Log("ShowWindow returned " + rc);
            return rc;
        }

        // ---------------------------------------------------------------------

        // ---------------------------------------------------------------------

        private static bool ForwardToPrimary(string filePath)
        {
            // Connect to the primary instance's hot-open pipe. The path is
            // transmitted as UTF-8 with a 4-byte little-endian length prefix.
            if (filePath == null)
                return false; // nothing to forward (the picker runs in the primary)
            try
            {
                using (NamedPipeClientStream pipe =
                        new NamedPipeClientStream(".", PipeName,
                        PipeDirection.Out))
                {
                    pipe.Connect(3000);
                    byte[] data = Encoding.UTF8.GetBytes(filePath);
                    byte[] header = BitConverter.GetBytes(data.Length);
                    pipe.Write(header, 0, 4);
                    pipe.Write(data, 0, data.Length);
                    pipe.Flush();
                }
                return true;
            }
            catch (Exception e)
            {
                Util.Log("ForwardToPrimary failed: " + e.Message);
                return false;
            }
        }

        private static void StartPipeListener()
        {
            // One server-side pipe instance; each incoming connection is handled
            // on a background thread so the UI thread is never blocked.
            Thread t = new Thread(new ParameterizedThreadStart(delegate(object arg)
            {
                try
                {
                    while (true)
                    {
                        NamedPipeServerStream srv =
                            new NamedPipeServerStream(PipeName, PipeDirection.In,
                                                      1,
                                                      PipeTransmissionMode.Byte,
                                                      PipeOptions.Asynchronous);
                        srv.WaitForConnection();
                        int len = 0;
                        byte[] header = new byte[4];
                        srv.Read(header, 0, 4);
                        len = BitConverter.ToInt32(header, 0);
                        if (len <= 0 || len > 65536) continue;
                        byte[] buf = new byte[len];
                        int read = 0;
                        while (read < len)
                        {
                            int n = srv.Read(buf, read, len - read);
                            if (n <= 0) break;
                            read += n;
                        }
                        if (read != len) { srv.Close(); continue; }
                        string path = Encoding.UTF8.GetString(buf, 0, read);
                        Util.Log("hot-open request: " + path);
                        if (File.Exists(path))
                        {
                            // Signal the UI thread to swap the doc. The Server
                            // instance is the one currently serving; we find it
                            // via the static currentDoc holder set in Main.
                            if (CurrentServer != null)
                            {
                                CurrentServer.SwapDoc(new Doc(path));
                                CurrentServer.Reload();
                            }
                        }
                        srv.Close();
                    }
                }
                catch (Exception e) { Util.Log("pipe listener error: " + e.Message); }
            }));
            t.IsBackground = true;
            t.Start();
        }

        private static string PickFile()
        {
            // automation hook (mirrors mdlight.mjs): skip the dialog entirely
            string pick = Environment.GetEnvironmentVariable("MDLIGHT_PICK");
            if (!string.IsNullOrEmpty(pick))
            {
                Util.Log("PickFile: MDLIGHT_PICK=" + pick);
                return File.Exists(pick) ? pick : null;
            }

            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "选择 Markdown 文件 — mdlight";
                dlg.Filter = "Markdown (*.md;*.markdown)|*.md;*.markdown|所有文件 (*.*)|*.*";
                dlg.CheckFileExists = true;
                dlg.Multiselect = false;
                if (dlg.ShowDialog() == DialogResult.OK)
                    return dlg.FileName;
                return null;
            }
        }

        /// <summary>
        /// Runs on the STA UI thread. Extracts the embedded WebView2 assemblies
        /// and native loader to %LOCALAPPDATA%\mdlight\native\&lt;version&gt;, wires
        /// up assembly / DLL resolution, then shows the window.
        /// </summary>
        private static int ShowWindow(Server server, Doc doc)
        {
            string nativeDir;
            try
            {
                nativeDir = BootstrapNative();
            }
            catch (Exception e)
            {
                MessageBox.Show("初始化失败:\n" + e.Message, AppTitle,
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            NativeWindow win = null;
            try
            {
                win = new NativeWindow(server, doc);
                Application.Run(win);
                // A WebView2 init failure used to still exit 0, so launchers and
                // scripts believed the document had been shown.
                return win.Failed ? 1 : 0;
            }
            finally
            {
                server.Stop();
                if (win != null) win.Dispose();
            }
        }

        private static string BootstrapNative()
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "mdlight", "native", Page.Version);
            try
            {
                Directory.CreateDirectory(dir);

                ExtractTo("mdl.dll.Core", Path.Combine(dir, "Microsoft.Web.WebView2.Core.dll"));
                ExtractTo("mdl.dll.WinForms", Path.Combine(dir, "Microsoft.Web.WebView2.WinForms.dll"));
                ExtractTo("mdl.dll.Loader", Path.Combine(dir, "WebView2Loader.dll"));
                Util.Log("BootstrapNative: extracted to " + dir);

                // the native loader must be findable by the managed Core.dll's P/Invoke
                SetDllDirectory(dir);

                finalNativeDir = dir;
                AppDomain.CurrentDomain.AssemblyResolve += ResolveWebView2;
                Util.Log("BootstrapNative: SetDllDirectory + AssemblyResolve ok");
                return dir;
            }
            catch (Exception e)
            {
                Util.Log("BootstrapNative FAILED: " + e);
                throw;
            }
        }

        private static Server CurrentServer;
        private static string finalNativeDir;

        private static Assembly ResolveWebView2(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            string file = null;
            if (name == "Microsoft.Web.WebView2.Core")
                file = "Microsoft.Web.WebView2.Core.dll";
            else if (name == "Microsoft.Web.WebView2.WinForms")
                file = "Microsoft.Web.WebView2.WinForms.dll";
            if (file == null) return null;
            string path = Path.Combine(finalNativeDir, file);
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        }

        private static void ExtractTo(string resource, string path)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
            {
                if (s == null)
                    throw new InvalidOperationException("缺少内嵌资源 " + resource);
                // reuse a previous extraction only when the size matches, so an
                // upgraded exe never loads a stale DLL
                if (File.Exists(path) && new FileInfo(path).Length == s.Length) return;
                // Write to a unique temp then move: two instances starting at
                // once used to trip over a half-written DLL ("being used by
                // another process") and refuse to start.
                string tmp = path + "." + Guid.NewGuid().ToString("N");
                try
                {
                    using (FileStream f = File.Create(tmp)) s.CopyTo(f);
                    try
                    {
                        if (File.Exists(path)) File.Delete(path);
                        File.Move(tmp, path);
                    }
                    catch (IOException)
                    {
                        // another instance won the race; reuse its file
                    }
                }
                finally
                {
                    try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception) { }
                }
            }
        }

        private static void WriteConsole(string text)
        {
            bool attached = false;
            try
            {
                FreeConsole();
                attached = AttachConsole(0xFFFFFFFF); // ATTACH_PARENT_PROCESS
                Console.WriteLine(text);
                Console.Out.Flush();
            }
            catch (Exception) { }
            if (!attached)
            {
                // Double-clicked winexe: there is no parent console, so --help /
                // --version / the export result used to vanish silently.
                try
                {
                    MessageBox.Show(text, AppTitle, MessageBoxButtons.OK,
                                    MessageBoxIcon.Information);
                }
                catch (Exception) { }
            }
        }

        private static string HelpText()
        {
            return AppTitle + " " + Page.Version + " — 轻量离线 Markdown 阅读器（原生版）\n" +
                "\n" +
                "用法\n" +
                "  mdlight.exe 论文.md            打开并显示（无边框窗口）\n" +
                "  mdlight.exe                    弹出文件选择框\n" +
                "  mdlight.exe 论文.md --export [out.html]\n" +
                "                                 导出单文件 HTML（自包含、离线可看）\n" +
                "\n" +
                "选项\n" +
                "  --export [path]   导出 HTML 后退出（默认同名 .html）\n" +
                "  --no-window       只启动本地服务，不开窗口\n" +
                "  -p, --port N      首选端口（占用时自动顺延）\n" +
                "  -i, --install     安装 .md 右键菜单 + 默认关联\n" +
                "  -u, --uninstall   卸载 .md 右键菜单 + 默认关联\n" +
                "      --unbind      仅解除 .md 默认关联（保留右键菜单）\n" +
                "      --settings    打开设置窗口\n" +
                "      --update-check 检查更新（显示最新版本/下载地址）\n" +
                "  -v, --version     显示版本\n" +
                "  -h, --help        显示本帮助\n" +
                "\n" +
                "环境变量\n" +
                "  MD_EDITOR         可选。外部编辑器命令模板，含 {file} 与 {line}；\n" +
                "                    不设置时自动探测 code / Code.exe / sublime_text /\n" +
                "                    notepad++ / notepad。\n" +
                "                    例: MD_EDITOR=\"code --goto {file}:{line}\"\n" +
                "\n" +
                "这个 exe 是自足的：界面、KaTeX（含字体）、highlight.js、\n" +
                "mermaid 分块全部内嵌，不依赖 Node，也不需要联网。\n";
        }
    }
}
