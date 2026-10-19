using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

namespace Mdlight
{
    /// <summary>
    /// Windows shell integration: "open with mdlight" on any markdown file and
    /// a default association for .md so a double-click lands in mdlight.
    ///
    /// Everything is written under HKCU (no admin needed). The context-menu
    /// entry goes on the .md class's shell subkey, which Windows honours without
    /// the UserChoice hash that guards the default-program selection — so the
    /// right-click path always works, while `Unbind` removes both.
    /// </summary>
    internal static class Shell
    {
        private const string ExtKey = @"Software\Classes\.md";
        private const string ProgIdKey = @"Software\Classes\mdlight.md";
        private const string ProgId = "mdlight.md";

        /// <summary>Full path of the currently running mdlight executable.</summary>
        private static string ExePath()
        {
            string p = Assembly.GetExecutingAssembly().Location;
            return p ?? Process.GetCurrentProcess().MainModule.FileName;
        }

        /// <summary>Install right-click "用 mdlight 打开" + default .md association.</summary>
        public static string Install()
        {
            try
            {
                string exe = ExePath();
                if (!File.Exists(exe)) return "失败: 找不到 mdlight.exe (" + exe + ")";

                // --- default association: .md -> mdlight.md ProgID -------------
                // HKCU\Software\Classes\.md\(Default) = mdlight.md
                RegistryKey ext = Registry.CurrentUser.CreateSubKey(ExtKey);
                // Remember whatever handled .md before us (e.g. Typora), so
                // --uninstall can put it back instead of leaving .md unassigned.
                object prevDefault = ext.GetValue(null);
                string prevStr = prevDefault as string;
                if (!string.IsNullOrEmpty(prevStr) && prevStr != ProgId)
                {
                    RegistryKey keep = Registry.CurrentUser.CreateSubKey(ProgIdKey);
                    keep.SetValue("PrevDefault", prevStr, RegistryValueKind.String);
                    keep.Close();
                }
                ext.SetValue(null, ProgId, RegistryValueKind.String);

                // ProgID description + open command (double-click entry point)
                RegistryKey prog = Registry.CurrentUser.CreateSubKey(ProgIdKey);
                prog.SetValue(null, "Markdown 文档", RegistryValueKind.String);
                prog.SetValue("FriendlyTypeName", "Markdown 文档", RegistryValueKind.String);
                RegistryKey icon = prog.CreateSubKey("DefaultIcon");
                icon.SetValue(null, "\"" + exe + "\",0", RegistryValueKind.String);
                icon.Close();
                RegistryKey open = prog.CreateSubKey(@"shell\open\command");
                open.SetValue(null, "\"" + exe + "\" \"%1\"", RegistryValueKind.String);
                open.Close();

                // --- right-click menu on any .md ---------------------------------
                // HKCU\Software\Classes\.md\shell\mdlight\command = "exe" "%1"
                RegistryKey shell = ext.CreateSubKey(@"shell\mdlight");
                shell.SetValue(null, "用 mdlight 打开", RegistryValueKind.String);
                shell.SetValue("Icon", "\"" + exe + "\",0", RegistryValueKind.String);
                shell.SetValue("MUIVerb", "用 mdlight 打开", RegistryValueKind.String);
                shell.Close();
                RegistryKey shellCmd = ext.CreateSubKey(@"shell\mdlight\command");
                shellCmd.SetValue(null, "\"" + exe + "\" \"%1\"", RegistryValueKind.String);
                shellCmd.Close();
                ext.Close();

                NotifyAssocChanged();
                return "已安装：.md 右键菜单 + 默认用 mdlight 打开。\n  双击 .md 文件，或在 .md 上右键 → \"用 mdlight 打开\"。";
            }
            catch (Exception e)
            {
                return "安装失败: " + e.Message;
            }
        }

        /// <summary>Remove the right-click menu entry and the ProgID.</summary>
        public static string Uninstall()
        {
            try
            {
                bool removed = false;
                // restore the previous handler before dropping the ProgID
                string prev = null;
                try
                {
                    RegistryKey p = Registry.CurrentUser.OpenSubKey(ProgIdKey);
                    if (p != null) { prev = p.GetValue("PrevDefault") as string; p.Close(); }
                }
                catch (Exception) { }
                // drop the shell entry on .md
                try
                {
                    RegistryKey ext = Registry.CurrentUser.OpenSubKey(ExtKey, true);
                    if (ext != null)
                    {
                        ext.DeleteSubKeyTree(@"shell\mdlight", false);
                        // if the default value still points at us, clear it
                        if ((ext.GetValue(null) as string) == ProgId)
                            ext.SetValue(null, prev ?? string.Empty, RegistryValueKind.String);
                        ext.Close();
                        removed = true;
                    }
                }
                catch (Exception) { }
                // drop the ProgID
                try
                {
                    Registry.CurrentUser.DeleteSubKeyTree(ProgIdKey, false);
                    removed = true;
                }
                catch (Exception) { }

                NotifyAssocChanged();
                return removed
                    ? "已卸载：移除 .md 右键菜单与默认关联。"
                    : "未发现已安装的 mdlight 关联。";
            }
            catch (Exception e)
            {
                return "卸载失败: " + e.Message;
            }
        }

        /// <summary>Release the default .md association without touching the menu.</summary>
        public static string Unbind()
        {
            try
            {
                string prev = null;
                try
                {
                    RegistryKey p = Registry.CurrentUser.OpenSubKey(ProgIdKey);
                    if (p != null) { prev = p.GetValue("PrevDefault") as string; p.Close(); }
                }
                catch (Exception) { }
                try
                {
                    RegistryKey ext = Registry.CurrentUser.OpenSubKey(ExtKey, true);
                    if (ext != null && (ext.GetValue(null) as string) == ProgId)
                    {
                        ext.SetValue(null, prev ?? string.Empty, RegistryValueKind.String);
                        ext.Close();
                    }
                }
                catch (Exception) { }
                try { Registry.CurrentUser.DeleteSubKeyTree(ProgIdKey, false); }
                catch (Exception) { }

                NotifyAssocChanged();
                return "已解除 .md 默认关联（右键菜单仍保留）。";
            }
            catch (Exception e)
            {
                return "解除失败: " + e.Message;
            }
        }

        /// <summary>
        /// Tell Explorer the file association changed so it refreshes without a
        /// sign-out. SHChangeNotify is the supported API for this.
        /// </summary>
        [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
        private static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);

        private static void NotifyAssocChanged()
        {
            try { SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero); } // SHCNE_ASSOCCHANGED
            catch (Exception) { }
        }
    }
}
