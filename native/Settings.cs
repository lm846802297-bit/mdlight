using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace Mdlight
{
    /// <summary>
    /// GUI settings dialog (the `--settings` CLI flag and the in-page ⚙ button).
    /// Settings are kept in %APPDATA%\mdlight\config.json via native/Config.cs. WinForms is a
    /// UI subsystem, so every dialog runs on its own STA thread.
    /// </summary>
    internal static class Settings
    {
        /// <summary>Open the dialog on a fresh STA thread; returns immediately.</summary>
        public static void ShowAsync(Server server)
        {
            Thread t = new Thread(() => Show(server, null));
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
        }

        /// <summary>Open the dialog synchronously (used by `--settings` at startup).</summary>
        public static void Show(Server server)
        {
            Show(server, null);
        }

        private static void Show(Server server, IWin32Window owner)
        {
            try
            {
                using (Form f = Build(server))
                {
                    if (owner != null) f.ShowDialog(owner);
                    else f.ShowDialog();
                }
            }
            catch (Exception e)
            {
                Util.Log("Settings.Show failed: " + e);
                MessageBox.Show("设置窗口失败:\n" + e.Message, "mdlight",
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string Cfg(string key, string def)
        {
            string v = Config.Get(key, null);
            return v == null ? def : v;
        }

        private static Form Build(Server server)
        {
            // ---- read the current config to seed the controls -----------------
            string font = Cfg("font", "Segoe UI");
            double fontSize = Config.GetNum("fontSize", 16);
            string theme = Cfg("theme", "system");
            string language = Cfg("language", "zh-CN");
            bool hardBreaks = Config.GetBool("hardBreaks", false);
            bool codeLineno = Config.GetBool("codeLineno", false);
            bool codeWrap = Config.GetBool("codeWrap", true);
            bool rememberPosition = Config.GetBool("rememberPosition", true);
            bool customTitleBar = Config.GetBool("customTitleBar", false);

            Form f = new Form();
            f.Text = "mdlight 设置";
            f.FormBorderStyle = FormBorderStyle.FixedDialog;
            f.MaximizeBox = false;
            f.MinimizeBox = false;
            f.StartPosition = FormStartPosition.CenterScreen;
            f.ClientSize = new Size(340, 430);

            int y = 14;

            // Local functions are C# 7; the in-box csc.exe is C# 4, so use a
            // lambda (C# 3) instead.
            Func<string, int, Label> L = delegate(string text, int rowY)
            {
                var lb = new Label();
                lb.Text = text;
                lb.AutoSize = true;
                lb.Location = new Point(16, rowY);
                f.Controls.Add(lb);
                return lb;
            };

            // 字体
            L("字体:", y);
            var fontCombo = new ComboBox();
            fontCombo.Location = new Point(120, y - 2);
            fontCombo.Width = 200;
            fontCombo.DropDownHeight = 220;
            try
            {
                foreach (FontFamily fam in FontFamily.Families)
                    fontCombo.Items.Add(fam.Name);
            }
            catch (Exception) { }
            if (fontCombo.Items.Count == 0) fontCombo.Items.Add("Segoe UI");
            fontCombo.Text = font;
            if (fontCombo.Items.Contains(font)) fontCombo.SelectedItem = font;
            else fontCombo.Text = font;
            f.Controls.Add(fontCombo);
            y += 32;

            // 字号
            L("字号:", y);
            var sizeNum = new NumericUpDown();
            sizeNum.Minimum = 10;
            sizeNum.Maximum = 40;
            sizeNum.Value = (decimal)(fontSize < 10 ? 16 : fontSize > 40 ? 40 : fontSize);
            sizeNum.Location = new Point(120, y - 3);
            sizeNum.Width = 80;
            f.Controls.Add(sizeNum);
            y += 32;

            // 主题
            L("主题:", y);
            var themeCombo = new ComboBox();
            themeCombo.Location = new Point(120, y - 2);
            themeCombo.Width = 200;
            themeCombo.DropDownStyle = ComboBoxStyle.DropDownList;
            themeCombo.Items.Add("system");
            themeCombo.Items.Add("light");
            themeCombo.Items.Add("dark");
            themeCombo.Items.Add("sepia");
            themeCombo.Items.Add("nord");
            themeCombo.Items.Add("solarized");
            themeCombo.Items.Add("dracula");
            themeCombo.Items.Add("matrix");
            themeCombo.Items.Add("gruvbox");
            themeCombo.Items.Add("ocean");
            themeCombo.Items.Add("forest");
            themeCombo.Items.Add("rosepine");
            themeCombo.Items.Add("catppuccin");
            themeCombo.Items.Add("cyberpunk");
            themeCombo.Items.Add("tokyonight");
            themeCombo.Items.Add("monokai");
            int themeIdx = themeCombo.Items.IndexOf(theme);
            themeCombo.SelectedIndex = themeIdx < 0 ? 0 : themeIdx;
            f.Controls.Add(themeCombo);
            y += 32;

            // 语言
            L("语言:", y);
            var langCombo = new ComboBox();
            langCombo.Location = new Point(120, y - 2);
            langCombo.Width = 200;
            langCombo.DropDownStyle = ComboBoxStyle.DropDownList;
            langCombo.Items.Add("zh-CN");
            langCombo.Items.Add("en-US");
            int langIdx = langCombo.Items.IndexOf(language);
            langCombo.SelectedIndex = langIdx < 0 ? 0 : langIdx;
            f.Controls.Add(langCombo);
            y += 34;

            var hardBox = new CheckBox { Text = "硬换行（每行 <br>，soft breaks）", AutoSize = true, Checked = hardBreaks, Location = new Point(16, y) };
            f.Controls.Add(hardBox);
            y += 26;
            var linenoBox = new CheckBox { Text = "代码块显示行号", AutoSize = true, Checked = codeLineno, Location = new Point(16, y) };
            f.Controls.Add(linenoBox);
            y += 26;
            var wrapBox = new CheckBox { Text = "代码块自动换行", AutoSize = true, Checked = codeWrap, Location = new Point(16, y) };
            f.Controls.Add(wrapBox);
            y += 26;
            var posBox = new CheckBox { Text = "记住阅读位置（下次打开回到原处）", AutoSize = true, Checked = rememberPosition, Location = new Point(16, y) };
            f.Controls.Add(posBox);
            y += 26;
            var titleBarBox = new CheckBox { Text = "自绘标题栏（隐藏系统标题栏）", AutoSize = true, Checked = customTitleBar, Location = new Point(16, y) };
            f.Controls.Add(titleBarBox);

            // buttons
            var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, Size = new Size(80, 28) };
            cancel.Location = new Point(340 - 80 - 92, 430 - 40);
            var save = new Button { Text = "保存", DialogResult = DialogResult.OK, Size = new Size(80, 28) };
            save.Location = new Point(340 - 80 - 8, 430 - 40);
            f.Controls.Add(cancel);
            f.Controls.Add(save);
            f.CancelButton = cancel;
            f.AcceptButton = save;

            save.Click += delegate(object s, EventArgs e)
            {
                try
                {
                    var patch = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                    patch["font"] = fontCombo.Text;
                    patch["fontSize"] = (double)sizeNum.Value;
                    patch["theme"] = (string)themeCombo.SelectedItem;
                    patch["language"] = (string)langCombo.SelectedItem;
                    patch["hardBreaks"] = hardBox.Checked;
                    patch["codeLineno"] = linenoBox.Checked;
                    patch["codeWrap"] = wrapBox.Checked;
                    patch["rememberPosition"] = posBox.Checked;
                    patch["customTitleBar"] = titleBarBox.Checked;
                    Config.Set(patch);
                    if (server != null) server.Reload();
                }
                catch (Exception ce)
                {
                    Util.Log("Settings save failed: " + ce.Message);
                    MessageBox.Show("保存失败:\n" + ce.Message, "mdlight",
                                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            };

            return f;
        }
    }
}
