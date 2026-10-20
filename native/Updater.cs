using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace Mdlight
{
    /// <summary>
    /// Self-update: check the latest release on a configurable endpoint and,
    /// when a newer build exists, download the new mdlight.exe and swap it in
    /// with an .cmd wrapper (a running .exe cannot be overwritten on Windows).
    ///
    /// Update source (config key `updateUrl`, env MDLIGHT_UPDATE_URL):
    ///   a GitHub Releases API JSON document of the shape
    ///     { "tag_name": "v0.9.0", "assets": [ { "name":"mdlight.exe",
    ///       "browser_download_url": "https://…/mdlight.exe" } ] }
    /// Default:
    ///   https://api.github.com/repos/lm846802297-bit/mdlight/releases/latest
    ///
    /// Auto-check is gated by config `checkUpdateOnStart` (default true) and
    /// always runs in the background so it never blocks opening a document.
    /// The repo must be public (or configured with a direct static URL / tokens)
    /// for the GitHub API to answer — a 404/denied source returns a clear error.
    /// </summary>
    internal static class Updater
    {
        public static string UpdateUrl
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("MDLIGHT_UPDATE_URL");
                if (!string.IsNullOrEmpty(env)) return env;
                string cfg = Config.Get("updateUrl", null);
                if (!string.IsNullOrEmpty(cfg)) return cfg;
                return "https://api.github.com/repos/lm846802297-bit/mdlight/releases/latest";
            }
        }

        /// <summary>If the page offers an explicit static download URL, prefer it.</summary>
        public static string StaticDownloadUrl
        {
            get
            {
                string cfg = Config.Get("updateDownloadUrl", null);
                if (!string.IsNullOrEmpty(cfg)) return cfg;
                return Environment.GetEnvironmentVariable("MDLIGHT_UPDATE_DOWNLOAD");
            }
        }

        public class UpdateInfo
        {
            public bool HasUpdate;
            public bool Error;
            public string Message;        // human-readable (error or result)
            public string LatestVersion;  // e.g. "0.9.0"
            public string DownloadUrl;
            public long DownloadSize;     // 0 = unknown
        }

        /// <summary>Compare "a.b.c…" dotted versions; returns >0 if a newer than b.</summary>
        public static int CompareVersions(string a, string b)
        {
            var pa = Split(a); var pb = Split(b);
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int x = i < pa.Length ? pa[i] : 0;
                int y = i < pb.Length ? pb[i] : 0;
                if (x != y) return x.CompareTo(y);
            }
            return 0;
        }
        private static int[] Split(string v)
        {
            v = (v ?? "").Trim();
            int start = 0;
            while (start < v.Length && !char.IsDigit(v[start])) start++; // skip "v"
            var t = v.Substring(start);
            var parts = t.Split('.');
            int[] r = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                string seg = parts[i];
                double d;
                int n;
                if (int.TryParse(seg, out n)) r[i] = n;
                else if (double.TryParse(seg, System.Globalization.NumberStyles.Any,
                         System.Globalization.CultureInfo.InvariantCulture, out d)) r[i] = (int)d;
                else r[i] = 0;
            }
            return r;
        }

        /// <summary>
        /// Fetch the latest release info. If `downloadUrl` is supplied (a direct
        /// asset URL), skip the API call and just report it as available when its
        /// tag/version isn't known — used by the static-download configuration.
        /// </summary>
        public static UpdateInfo Check(TimeSpan? timeout)
        {
            var info = new UpdateInfo();
            try
            {
                string direct = StaticDownloadUrl;
                if (!string.IsNullOrEmpty(direct))
                {
                    // Static mode: can't know the conveyed version, so only report
                    // when a version tag was configured next to it.
                    string ver = Config.Get("updateVersion", null);
                    if (string.IsNullOrEmpty(ver))
                    {
                        info.Error = true;
                        info.Message = "已配置静态下载地址，但缺少 updateVersion 无法比较版本。";
                        return info;
                    }
                    if (CompareVersions(ver, Page.Version) > 0)
                    {
                        info.HasUpdate = true;
                        info.LatestVersion = ver;
                        info.DownloadUrl = direct;
                    }
                    else
                    {
                        info.Message = "已是最新版本 v" + Page.Version + "。";
                    }
                    return info;
                }

                string url = UpdateUrl;
                if (string.IsNullOrWhiteSpace(url))
                {
                    info.Error = true;
                    info.Message = "未配置更新源。";
                    return info;
                }

                using (WebClient wc = new WebClient())
                {
                    // .NET Framework 4 defaults to TLS 1.0, which GitHub refuses;
                    // enable 1.2 (and classic) so the update check actually works.
                    ServicePointManager.SecurityProtocol =
                        (SecurityProtocolType)768 /*Tls12*/ | (SecurityProtocolType)192 /*Tls11*/
                        | SecurityProtocolType.Tls;
                    wc.Headers.Add("User-Agent", "mdlight/" + Page.Version);
                    wc.Headers.Add("Accept", "application/vnd.github+json");
                    wc.Encoding = Encoding.UTF8;
                    // WebClient on the in-box .NET Framework has no Timeout
                    // property; enforce a hard deadline with a background thread.
                    string json = null;
                    Exception innerErr = null;
                    bool done = false;
                    Thread worker = new Thread(() =>
                    {
                        try { json = wc.DownloadString(url); }
                        catch (Exception e) { innerErr = e; }
                        done = true;
                    });
                    worker.IsBackground = true;
                    worker.Start();
                    if (!worker.Join(timeout.HasValue ? (int)timeout.Value.TotalMilliseconds : 8000)
                        || !done)
                    {
                        info.Error = true;
                        info.Message = "检查更新超时（网络不可达或无响应）。";
                        return info;
                    }
                    if (innerErr != null) throw innerErr;

                    var obj = Json.GetObject(json);
                    string tag = obj.ContainsKey("tag_name") ? Convert.ToString(obj["tag_name"]) : null;
                    string latest = tag;
                    if (!string.IsNullOrEmpty(latest) &&
                        latest.StartsWith("v", StringComparison.OrdinalIgnoreCase))
                        latest = latest.Substring(1);
                    if (string.IsNullOrEmpty(latest))
                    {
                        // no tag_name: try name / version fallbacks
                        object nm;
                        if (obj.TryGetValue("name", out nm))
                            latest = Convert.ToString(nm);
                    }

                    string download = null;
                    object rawAssets;
                    if (obj.TryGetValue("assets", out rawAssets))
                    {
                        string assets = Convert.ToString(rawAssets);
                        // minimal scan for the mdlight.exe asset's browser_download_url
                        int idx = 0;
                        int n = assets.Length;
                        while (idx < n)
                        {
                            int nm = assets.IndexOf("\"name\":", idx, StringComparison.OrdinalIgnoreCase);
                            if (nm < 0) break;
                            int vs = assets.IndexOf('"', nm + 7);
                            int ve = vs > 0 ? assets.IndexOf('"', vs + 1) : -1;
                            if (vs > 0 && ve > vs) idx = ve;
                            string assetName = ve > vs ? assets.Substring(vs + 1, ve - vs - 1) : "";
                            int du = assets.IndexOf("browser_download_url", ve, StringComparison.OrdinalIgnoreCase);
                            if (du < 0) break;
                            int ds = du > 0 ? assets.IndexOf('"', du + 21) : -1;
                            int de = ds > 0 ? assets.IndexOf('"', ds + 1) : -1;
                            string assetUrl = de > ds ? assets.Substring(ds + 1, de - ds - 1) : "";
                            if (assetName.Equals("mdlight.exe", StringComparison.OrdinalIgnoreCase)
                                && !string.IsNullOrEmpty(assetUrl)) { download = assetUrl; break; }
                            idx = Math.Max(de, du + 1);
                        }
                    }

                    if (CompareVersions(latest, Page.Version) > 0)
                    {
                        info.HasUpdate = true;
                        info.LatestVersion = latest;
                        info.DownloadUrl = string.IsNullOrEmpty(download)
                            ? (StaticDownloadUrl ?? "")
                            : download;
                        info.Message = "发现新版本 v" + latest + "（当前 v" + Page.Version + "）。";
                    }
                    else
                    {
                        info.Message = "已是最新版本 v" + Page.Version + "。";
                    }
                }
            }
            catch (WebException we)
            {
                info.Error = true;
                HttpWebResponse r = we.Response as HttpWebResponse;
                int code = r == null ? 0 : (int)r.StatusCode;
                info.Message = (code == 404 || code == 403 || code == 401)
                    ? "无法访问更新源（" + code + "）：仓库可能未公开或需要令牌。" +
                      "请设置 updateUrl 或 public 仓库后重试。"
                    : "检查更新失败：" + we.Message;
            }
            catch (Exception e)
            {
                info.Error = true;
                info.Message = "检查更新失败：" + e.Message;
            }
            return info;
        }

        /// <summary>
        /// Download the update to %LOCALAPPDATA%\mdlight\updates, write a tiny
        /// cmd that waits for this process to exit, replaces the exe, and
        /// relaunches, then start it. Returns a status string for the caller.
        /// </summary>
        public static string DownloadAndApply(string downloadUrl)
        {
            try
            {
                if (string.IsNullOrEmpty(downloadUrl)) return "下载地址为空。";
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "mdlight", "updates");
                Directory.CreateDirectory(dir);
                string newExe = Path.Combine(dir, "mdlight-new.exe");
                string curExe = System.Reflection.Assembly.GetExecutingAssembly().Location
                    ?? Process.GetCurrentProcess().MainModule.FileName;

                using (WebClient wc = new WebClient())
                {
                    ServicePointManager.SecurityProtocol =
                        (SecurityProtocolType)768 | (SecurityProtocolType)192 | SecurityProtocolType.Tls;
                    wc.Headers.Add("User-Agent", "mdlight/" + Page.Version);
                    wc.DownloadFile(downloadUrl, newExe);
                }
                if (!File.Exists(newExe) || new FileInfo(newExe).Length < 1000)
                    return "下载失败：文件过小或未生成。";

                string cmd = Process.GetCurrentProcess().Id + "";
                string scriptPath = Path.Combine(dir, "apply-update.cmd");
                string script = "@echo off\r\n"
                    + "ping 127.0.0.1 -n 3 > nul\r\n"
                    + "taskkill /PID " + cmd + " /F /T > nul 2>&1\r\n"
                    + "del /F \"" + curExe + "\" > nul 2>&1\r\n"
                    + "copy /Y \"" + newExe + "\" \"" + curExe + "\" > nul\r\n"
                    + "start \"\" \"" + curExe + "\"\r\n"
                    + "del /F \"%~f0\" > nul 2>&1\r\n";
                File.WriteAllText(scriptPath, script, new UTF8Encoding(false));

                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = scriptPath,
                    WindowStyle = System.Diagnostics.ProcessWindowStyle.Hidden,
                    UseShellExecute = true,
                });
                return "已下载 v" + (Config.Get("updateVersion", "?") ?? "?") +
                    "，正在替换并重启";
            }
            catch (Exception e)
            {
                Util.Log("apply update failed: " + e);
                return "更新失败：" + e.Message;
            }
        }
    }
}