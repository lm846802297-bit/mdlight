using System;
using System.Collections.Generic;
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

        // ---- remembered window geometry ---------------------------------------
        // Saved to config.json (winWidth/winHeight/winX/winY/winMaximized) so a
        // relaunch lands where the user left the window. Anything implausible
        // (zero size, off-screen coordinates from a monitor that is gone) is
        // rejected and we fall back to the old 1200x860 centred default.
        private const int DefaultWindowWidth = 1200;
        private const int DefaultWindowHeight = 860;
        private const int MinWindowWidth = 520;
        private const int MinWindowHeight = 360;
        private const int MinVisiblePx = 80;          // at least this much on a monitor
        private const int GeometrySaveDelayMs = 700;  // debounce resize/move storms

        private Timer geometryTimer;
        private bool geometryHooked;
        private bool lastWasMaximized;
        private Rectangle lastNormalBounds;
        private string lastGeometrySignature;

        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS { public int Left, Right, Top, Bottom; }
        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

        public NativeWindow(Server server, Doc doc)
        {
            this.server = server;
            this.doc = doc;

            Text = "mdlight — " + doc.Name;
            MinimumSize = new Size(MinWindowWidth, MinWindowHeight);
            BackColor = Color.White;

            // Frameless: the page draws the title bar and the window controls.
            FormBorderStyle = FormBorderStyle.None;
            DoubleBuffered = true;

            // Must run before the handle exists so the window is created at the
            // remembered spot instead of jumping there after the first paint.
            RestoreGeometry();

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
                try { if (geometryTimer != null) { geometryTimer.Stop(); geometryTimer.Dispose(); } }
                catch (Exception) { }
                try { web.Dispose(); } catch (Exception) { }
            };

            HookGeometry();
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
                        else if (msg.StartsWith("open:"))
                        {
                            // Drag-and-drop from the page: navigate WebView2 to a
                            // new local doc. The server is rebuilt in-place by
                            // reloading the URL (the server's doc is swapped via
                            // the /api/open-file route if present, else a fresh
                            // start).
                            string p = msg.Substring(5);
                            Util.Log("open-file request: " + p);
                            if (System.IO.File.Exists(p))
                            {
                                Doc newDoc = new Doc(p);
                                // Swap the doc in the running server so the next
                                // page load shows the new file.
                                server.SwapDoc(newDoc);
                                web.CoreWebView2.Navigate(server.BaseUrl + "?frameless=1&doc=" +
                                    System.Uri.EscapeDataString(p));
                            }
                            else
                            {
                                MessageBox.Show("文件不存在：" + p, "mdlight",
                                                MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            }
                        }
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

        // ---- window geometry persistence --------------------------------------
        // The window remembers size/position/maximized state in config.json.
        // Everything read back is untrusted: a config written on a bigger monitor
        // (or a corrupt one) must not produce a 0px or unreachable window.

        /// <summary>Restore the last geometry, or fall back to 1200x860 centred.</summary>
        private void RestoreGeometry()
        {
            bool restored = false;
            try
            {
                double w = Config.GetNum("winWidth", double.NaN);
                double h = Config.GetNum("winHeight", double.NaN);
                double x = Config.GetNum("winX", double.NaN);
                double y = Config.GetNum("winY", double.NaN);

                if (!double.IsNaN(w) && !double.IsNaN(h) && !double.IsNaN(x) && !double.IsNaN(y))
                {
                    int iw = (int)Math.Round(w);
                    int ih = (int)Math.Round(h);
                    int ix = (int)Math.Round(x);
                    int iy = (int)Math.Round(y);

                    // Bound the size by the whole virtual desktop (all monitors),
                    // not just the primary one, and keep coordinates well inside
                    // what Windows can represent.
                    Rectangle vs = SystemInformation.VirtualScreen;
                    int maxW = vs.Width > 0 ? vs.Width : 16000;
                    int maxH = vs.Height > 0 ? vs.Height : 16000;
                    bool sane = iw >= MinWindowWidth && ih >= MinWindowHeight
                             && iw <= maxW && ih <= maxH
                             && Math.Abs(ix) <= 32000 && Math.Abs(iy) <= 32000;

                    if (sane)
                    {
                        Rectangle r = new Rectangle(ix, iy, iw, ih);
                        if (IsVisibleEnough(r))
                        {
                            ClientSize = new Size(iw, ih);
                            StartPosition = FormStartPosition.Manual;
                            Location = new Point(ix, iy);
                            lastNormalBounds = r;
                            lastGeometrySignature = GeometrySignature(r, false);
                            restored = true;
                            Util.Log("window geometry restored: " + GeometrySignature(r, false));
                        }
                        else
                        {
                            Util.Log("window geometry ignored (off-screen): " + GeometrySignature(r, false));
                        }
                    }
                    else
                    {
                        Util.Log("window geometry ignored (out of range): "
                            + iw + "x" + ih + " at " + ix + "," + iy);
                    }
                }
            }
            catch (Exception ex)
            {
                Util.Log("window geometry restore error: " + ex.Message);
            }

            if (!restored)
            {
                ClientSize = new Size(DefaultWindowWidth, DefaultWindowHeight);
                StartPosition = FormStartPosition.CenterScreen;
                Util.Log("window geometry: using default "
                    + DefaultWindowWidth + "x" + DefaultWindowHeight);
            }

            try
            {
                if (Config.GetBool("winMaximized", false))
                {
                    lastWasMaximized = true;
                    WindowState = FormWindowState.Maximized;
                }
            }
            catch (Exception ex) { Util.Log("window maximize restore error: " + ex.Message); }
        }

        /// <summary>
        /// At least MinVisiblePx of the rectangle has to land inside some
        /// monitor's working area. Screen coordinates are signed: monitors left
        /// of / above the primary one have negative X or Y, so no absolute values.
        /// </summary>
        private static bool IsVisibleEnough(Rectangle r)
        {
            try
            {
                Screen[] screens = Screen.AllScreens;
                for (int i = 0; i < screens.Length; i++)
                {
                    Rectangle hit = Rectangle.Intersect(r, screens[i].WorkingArea);
                    if (hit.Width >= MinVisiblePx && hit.Height >= MinVisiblePx) return true;
                }
            }
            catch (Exception ex) { Util.Log("screen probe error: " + ex.Message); }
            return false;
        }

        private void HookGeometry()
        {
            geometryHooked = true;
            geometryTimer = new Timer();
            geometryTimer.Interval = GeometrySaveDelayMs;
            geometryTimer.Tick += delegate(object o, EventArgs e)
            {
                geometryTimer.Stop();
                SaveGeometry(false);
            };
            // Resize and Move fire many times while dragging; the timer collapses
            // them into a single config write.
            Resize += delegate(object o, EventArgs e) { OnGeometryChanged(); };
            Move += delegate(object o, EventArgs e) { OnGeometryChanged(); };
            // FormClosing (not FormClosed) so the final write still happens while
            // Bounds/RestoreBounds are valid.
            FormClosing += delegate(object o, FormClosingEventArgs e) { SaveGeometry(true); };
        }

        private void OnGeometryChanged()
        {
            try
            {
                if (WindowState == FormWindowState.Normal)
                {
                    lastNormalBounds = Bounds;
                    lastWasMaximized = false;
                }
                else if (WindowState == FormWindowState.Maximized)
                {
                    lastWasMaximized = true;
                }

                if (geometryTimer == null) return;
                // Saving while minimized would record the minimized icon rect.
                if (WindowState == FormWindowState.Minimized) return;
                geometryTimer.Stop();
                geometryTimer.Start();
            }
            catch (Exception ex) { Util.Log("window geometry change error: " + ex.Message); }
        }

        private void SaveGeometry(bool closing)
        {
            if (!geometryHooked) return;
            try
            {
                Rectangle r;
                bool maximized;
                if (WindowState == FormWindowState.Normal)
                {
                    r = Bounds;
                    maximized = false;
                }
                else if (WindowState == FormWindowState.Maximized)
                {
                    // Keep the pre-maximize rect so un-maximizing after a relaunch
                    // goes back to the real size, not the full screen.
                    r = RestoreBounds;
                    if (r.Width < MinWindowWidth || r.Height < MinWindowHeight)
                        r = lastNormalBounds;
                    maximized = true;
                }
                else
                {
                    r = lastNormalBounds;
                    maximized = lastWasMaximized;
                }

                if (r.Width < MinWindowWidth || r.Height < MinWindowHeight)
                {
                    if (closing) Util.Log("window geometry not saved (degenerate): " + r);
                    return;
                }
                if (!IsVisibleEnough(r))
                {
                    // Keep the previous good value rather than persisting garbage.
                    if (closing) Util.Log("window geometry not saved (off-screen): " + r);
                    return;
                }

                string sig = GeometrySignature(r, maximized);
                if (sig == lastGeometrySignature) return;

                Dictionary<string, object> patch = new Dictionary<string, object>();
                patch["winWidth"] = r.Width;
                patch["winHeight"] = r.Height;
                patch["winX"] = r.X;
                patch["winY"] = r.Y;
                patch["winMaximized"] = maximized;
                Config.Set(patch);
                lastGeometrySignature = sig;
                Util.Log("window geometry saved: " + sig);
            }
            catch (Exception ex)
            {
                Util.Log("window geometry save error: " + ex.Message);
            }
        }

        private static string GeometrySignature(Rectangle r, bool maximized)
        {
            return r.Width + "x" + r.Height + "@" + r.X + "," + r.Y + (maximized ? "+max" : "");
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
