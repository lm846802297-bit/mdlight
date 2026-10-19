using System;
using System.IO;
using System.Text;

namespace Mdlight
{
    internal enum SaveStatus
    {
        Ok,
        Conflict,
        Error
    }

    internal sealed class SaveResult
    {
        public SaveStatus Status;
        public string Sha;      // new sha on Ok, current-on-disk sha on Conflict
        public string Error;
    }

    /// <summary>
    /// The one document this process is showing. Mirrors what mdlight.mjs keeps
    /// in module-level state (mdPath/mdDir): the path is fixed at launch.
    /// </summary>
    internal sealed class Doc
    {
        public readonly string FullPath;
        public readonly string Dir;
        public readonly string Name;

        public Doc(string path)
        {
            FullPath = Path.GetFullPath(path);
            Dir = Path.GetDirectoryName(FullPath);
            Name = Path.GetFileName(FullPath);
        }

        public string ReadSource()
        {
            return Util.ReadText(FullPath);
        }

        public string CurrentSha()
        {
            return Util.Sha256Hex(ReadSource());
        }

        private readonly object _saveGate = new object();

        /// <summary>
        /// Writes the file, refusing to clobber an external change unless the
        /// caller passes force. This is the same contract as POST /api/save in
        /// mdlight.mjs: the editor sends the sha of the text it started from,
        /// and a mismatch returns 409 rather than silently losing an edit made
        /// in another program.
        /// </summary>
        public SaveResult Save(string source, string baseSha, bool force)
        {
            // Serialise the whole read-check-write. Two overlapping saves used
            // to share one temp name, and the losing request's fallback could
            // delete the document outright.
            lock (_saveGate)
            {
                SaveResult r = new SaveResult();
                string cur;
                try
                {
                    cur = ReadSource();
                }
                catch (Exception e)
                {
                    r.Status = SaveStatus.Error;
                    r.Error = e.Message;
                    return r;
                }

                string curSha = Util.Sha256Hex(cur);
                if (!force && baseSha != null && baseSha != curSha)
                {
                    r.Status = SaveStatus.Conflict;
                    r.Sha = curSha;
                    return r;
                }

                // Unique temp beside the target (same volume, so the swap is
                // atomic); never reused, so parallel saves cannot trample it.
                string tmp = FullPath + ".mdlight-tmp-" + Guid.NewGuid().ToString("N");
                try
                {
                    Util.WriteText(tmp, source);
                    try
                    {
                        File.Replace(tmp, FullPath, null);
                    }
                    catch (Exception)
                    {
                        // File.Replace is unavailable on some filesystems / when
                        // a sync client holds the target. Copy over it instead of
                        // deleting first: if this fails the original survives.
                        using (FileStream src = File.OpenRead(tmp))
                        using (FileStream dst = new FileStream(FullPath, FileMode.Create,
                                                              FileAccess.Write, FileShare.None))
                        {
                            src.CopyTo(dst);
                        }
                    }
                    r.Status = SaveStatus.Ok;
                    r.Sha = Util.Sha256Hex(source);
                }
                catch (Exception e)
                {
                    r.Status = SaveStatus.Error;
                    r.Error = e.Message;
                }
                finally
                {
                    try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception) { }
                }
                return r;
            }
        }
    }

    /// <summary>Opens the document in the user's external editor (fix #6b:
    /// MD_EDITOR template instead of probing the registry).</summary>
    internal static class Editor
    {
        public static string Open(string file, int line)
        {
            if (line < 1) line = 1;

            string tpl = Environment.GetEnvironmentVariable("MD_EDITOR");
            if (!string.IsNullOrEmpty(tpl))
            {
                string cmd = tpl.Replace("{file}", file).Replace("{line}", line.ToString());
                return SpawnShell(cmd) ? "MD_EDITOR" : null;
            }

            // Same probe order as the Node build; `notepad` is always present so
            // the chain effectively cannot fall through.
            string[][] chain = new string[][]
            {
                new string[] { "code", "--goto" },
                new string[] { "code-insiders", "--goto" },
                new string[] { "subl" },
                new string[] { "notepad++" },
                new string[] { "notepad" },
            };
            for (int i = 0; i < chain.Length; i++)
            {
                string exe = chain[i][0];
                if (!Which(exe)) continue;
                bool gotoStyle = chain[i].Length > 1;
                string args = gotoStyle
                    ? chain[i][1] + " \"" + file + ":" + line + "\""
                    : "\"" + file + "\"";
                if (SpawnExe(exe, args)) return exe;
            }
            return null;
        }

        private static bool Which(string exe)
        {
            try
            {
                System.Diagnostics.ProcessStartInfo psi =
                    new System.Diagnostics.ProcessStartInfo("where", exe);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (System.Diagnostics.Process p = System.Diagnostics.Process.Start(psi))
                {
                    p.WaitForExit(3000);
                    return p.ExitCode == 0;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Launch an executable directly. Going through `cmd /c start` (the old
        /// route) made cmd expand %VAR% sequences in the document path, so a
        /// file named "100%TEMP%.md" opened the wrong place.
        /// </summary>
        private static bool SpawnExe(string exe, string args)
        {
            try
            {
                System.Diagnostics.ProcessStartInfo psi =
                    new System.Diagnostics.ProcessStartInfo(exe, args);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                System.Diagnostics.Process.Start(psi);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>MD_EDITOR is a whole command line (may include a shell
        /// built-in), so it still has to go through cmd.exe.</summary>
        private static bool SpawnShell(string cmdline)
        {
            try
            {
                System.Diagnostics.ProcessStartInfo psi =
                    new System.Diagnostics.ProcessStartInfo("cmd.exe",
                        "/c start \"\" " + cmdline);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                System.Diagnostics.Process.Start(psi);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
