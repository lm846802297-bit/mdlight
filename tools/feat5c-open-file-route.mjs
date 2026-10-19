// feat5c: add /api/open-file route to native/Server.cs
import { readFileSync, writeFileSync } from 'node:fs';

let sv = readFileSync('native/Server.cs', 'utf8');

// Insert the new route just before the "📊 export: the page posts the CSV text" comment
const anchor = "            // \u{1F4CA} export: the page posts the CSV text; we write it next to the doc.";
if (sv.indexOf(anchor) < 0) { console.log('Server.cs anchor not found'); process.exit(1); }

const routeBlock = `            // 📂 open-file: the drop handler posts {name, content}; write the
            // dropped .md into the doc's directory and signal a reload so the
            // WebView2 picks it up on the next navigation.
            if (path == "/api/open-file" &&
                string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                HandleOpenFile(req, res);
                return;
            }

`;
sv = sv.replace(anchor, routeBlock + anchor, 1);

// Add the HandleOpenFile method just before HandleExportCsv
const hvAnchor = "        private void HandleExportCsv(HttpListenerRequest req, HttpListenerResponse res)";
if (sv.indexOf(hvAnchor) < 0) { console.log('HandleExportCsv anchor not found'); process.exit(1); }

const methodBlock = `        /// <summary>POST /api/open-file — body is {"name":"X.md","content":"..."};
        /// write the file next to the current doc and reload the watcher.</summary>
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

            string name = Json.GetString(body, "name");
            string content = Json.GetString(body, "content");
            if (string.IsNullOrEmpty(name) || content == null)
            {
                SendError(res, 400, "name and content required");
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
            SendJson(res, "{\\"ok\\":true,\\"path\\":" + Util.JsonStr(outPath) + "}");
        }

`;
sv = sv.replace(hvAnchor, methodBlock + hvAnchor, 1);
writeFileSync('native/Server.cs', sv);
console.log('feat5c Server.cs done');
