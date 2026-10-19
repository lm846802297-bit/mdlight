using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Mdlight
{
    /// <summary>
    /// The app window: a plain WinForms Form hosting a WebView2 control. This is
    /// the piece the Node build fakes by launching Edge with --app; here it is a
    /// real window owned by our own process, so it gets its own taskbar entry,
    /// icon and title, and needs no Edge executable to be found.
    /// </summary>
    internal sealed class NativeWindow : Form
    {
        private readonly Server server;
        private readonly Doc doc;
        private readonly WebView2 web;

        /// <summary>Set when WebView2 could not start, so Main can exit 1.</summary>
        public bool Failed;

        // ---- DWM / frameless title bar ----------------------------------------
        // The OS title bar is replaced by the page's own top bar, which is
        // draggable via -webkit-app-region: drag. DWM extends the frame under the
        // client area so rounded corners / the accent colour still read as a
        // window. Window controls are buttons in that bar; the page tells us what
        // to do through WebView2's WebMessageReceived.
        private const int WM_NCHITTEST = 0x84;
        private const int HTCAPTION = 2;
        private const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12;
        private const int HTTOPLEFT = 13, HTTOPRIGHT = 14;
        private const int HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
        private const int RESIZE_MARGIN = 7;

        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS { public int Left, Right, Top, Bottom; }
        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

        public NativeWindow(Server server, Doc doc)
        {
            this.server = server;
            this.doc = doc;

            Text = "mdlight — " + doc.Name;
            ClientSize = new Size(1200, 860);
            MinimumSize = new Size(520, 360);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;

            // Frameless: the page draws the title bar and the window controls.
            FormBorderStyle = FormBorderStyle.None;
            DoubleBuffered = true;
            HandleCreated += delegate(object o, EventArgs e)
            {
                try
                {
                    MARGINS m = new MARGINS { Left = 0, Right = 0, Top = 1, Bottom = 0 };
                    DwmExtendFrameIntoClientArea(Handle, ref m);
                }
                catch (Exception) { }
            };

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            Controls.Add(web);

            Load += OnLoaded;
            FormClosed += delegate(object o, FormClosedEventArgs e)
            {
                try { web.Dispose(); } catch (Exception) { }
            };
        }

        private async void OnLoaded(object sender, EventArgs e)
        {
            try
            {
                // keep the browser profile out of the exe's directory: that may
                // be read-only (Program Files) or on a network share
                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "mdlight", "webview2");
                Directory.CreateDirectory(dataDir);
                Util.Log("NativeWindow: dataDir=" + dataDir);

                CoreWebView2Environment env =
                    await CoreWebView2Environment.CreateAsync(null, dataDir, null);
                Util.Log("NativeWindow: CreateAsync ok");
                await web.EnsureCoreWebView2Async(env);
                Util.Log("NativeWindow: EnsureCoreWebView2Async ok");

                CoreWebView2Settings s = web.CoreWebView2.Settings;
                s.IsStatusBarEnabled = false;
                s.AreDevToolsEnabled = false;
                s.AreDefaultContextMenusEnabled = true;
                s.IsZoomControlEnabled = true;
                s.IsSwipeNavigationEnabled = false;

                // ctrl-click / target=_blank: hand off to the real browser
                web.CoreWebView2.NewWindowRequested +=
                    delegate(object o, CoreWebView2NewWindowRequestedEventArgs a)
                {
                    a.Handled = true;
                    try { System.Diagnostics.Process.Start(a.Uri); } catch (Exception) { }
                };

                // Plain <a href="https://..."> click navigates in place — hand it
                // off to the OS browser too, otherwise mdlight turns into a page.
                web.CoreWebView2.NavigationStarting +=
                    delegate(object o, CoreWebView2NavigationStartingEventArgs a)
                {
                    string u = (a.Uri ?? "").Trim();
                    if (u.StartsWith(server.BaseUrl, StringComparison.OrdinalIgnoreCase)
                        || u.StartsWith("file://", StringComparison.OrdinalIgnoreCase)
                        || u.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
                        || u.StartsWith("blob:", StringComparison.OrdinalIgnoreCase))
                        return;
                    a.Cancel = true;
                    try { System.Diagnostics.Process.Start(u); } catch (Exception) { }
                };

                // The page's title-bar buttons post back their intent.
                web.CoreWebView2.WebMessageReceived +=
                    delegate(object o, CoreWebView2WebMessageReceivedEventArgs a)
                {
                    string msg = "";
                    try { msg = a.TryGetWebMessageAsString() ?? ""; } catch (Exception) { }
                    try
                    {
                        if (msg == "win:min") WindowState = FormWindowState.Minimized;
                        else if (msg == "win:max")
                            WindowState = WindowState == FormWindowState.Maximized
                                ? FormWindowState.Normal : FormWindowState.Maximized;
                        else if (msg == "win:close") Close();
                        else if (msg == "export:pdf") ExportPdf();
                    }
                    catch (Exception ex) { Util.Log("win ctl error: " + ex.Message); }
                };

                string url = server.BaseUrl + (server.BaseUrl.EndsWith("/") ? "" : "/")
                    + "?frameless=1";
                web.CoreWebView2.Navigate(url);
                Util.Log("NativeWindow: Navigate " + url);
                web.Focus();
            }
            catch (Exception ex)
            {
                Util.Log("NativeWindow FAILED: " + ex);
                Failed = true;
                MessageBox.Show(
                    "WebView2 初始化失败。\n\n" +
                    "mdlight 需要系统的 Microsoft Edge WebView2 Runtime\n" +
                    "（Windows 11 自带；Windows 10 可能需安装一次）：\n" +
                    "https://developer.microsoft.com/microsoft-edge/webview2/\n\n" +
                    ex.Message,
                    "mdlight", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        // 📄 export: render the current page to PDF via WebView2's own print
        // pipeline, so mermaid / KaTeX come out exactly as on screen.
        private async void ExportPdf()
        {
            try
            {
                using (SaveFileDialog d = new SaveFileDialog())
                {
                    d.Filter = "PDF 文件 (*.pdf)|*.pdf";
                    d.FileName = Path.GetFileNameWithoutExtension(doc.Name) + ".pdf";
                    d.Title = "导出 PDF";
                    if (d.ShowDialog(this) != DialogResult.OK) return;
                    string path = d.FileName;
                    try
                    {
                        // PrintToPdfAsync returns a Task: the sync try/catch used
                        // to swallow nothing and report nothing, so a failure was
                        // completely invisible.
                        await web.CoreWebView2.PrintToPdfAsync(path);
                    }
                    catch (Exception e)
                    {
                        MessageBox.Show("导出 PDF 失败：\n" + e.Message,
                                        "mdlight", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
            }
            catch (Exception ex) { Util.Log("export pdf error: " + ex.Message); }
        }

        // Frameless windows have no borders to grab, so resize has to be
        // implemented by hit-testing the window edges ourselves.
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCHITTEST)
            {
                base.WndProc(ref m);
                if (WindowState == FormWindowState.Maximized) return;
                int x = unchecked((short)(long)m.LParam);
                int y = unchecked((short)((long)m.LParam >> 16));
                // convert to client coordinates to compare with ClientSize
                Point p = PointToClient(new Point(x, y));
                int w = ClientSize.Width, h = ClientSize.Height;
                bool left = p.X < RESIZE_MARGIN, right = p.X > w - RESIZE_MARGIN;
                bool top = p.Y < RESIZE_MARGIN, bottom = p.Y > h - RESIZE_MARGIN;
                int hit = 0;
                if (top && left) hit = HTTOPLEFT;
                else if (top && right) hit = HTTOPRIGHT;
                else if (bottom && left) hit = HTBOTTOMLEFT;
                else if (bottom && right) hit = HTBOTTOMRIGHT;
                else if (left) hit = HTLEFT;
                else if (right) hit = HTRIGHT;
                else if (top) hit = HTTOP;
                else if (bottom) hit = HTBOTTOM;
                else return; // HTCLIENT: let the page handle it (drag / buttons)
                m.Result = (IntPtr)hit;
                return;
            }
            base.WndProc(ref m);
        }
    }
}
