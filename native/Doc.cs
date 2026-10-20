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

    // External-editor discovery/launch lives in native/Editor.cs (probe chain:
    // MD_EDITOR -> registry App Paths -> PATH -> notepad). The old class here
    // only knew the env var and a bare `where` probe, so a machine without an
    // editor on PATH could not open one at all.
}
