#!/usr/bin/env node
// feat5: drag-and-drop file open in NativeWindow.cs
// WebView2 DragDrop is not a public API; the closest hook is the
// WebMessageReceived channel already wired in the page. So instead of a
// C# drag hook, we add a <input type="file" accept=".md,.markdown"> based
// drop-zone: the page watches for a drag-over on body and posts
// "open:<path>" back via postMessage. WebView2 exposes no file-drop event
// to C#; the practical port is a "drop file here" overlay driven by the
// page's own dragover event (no C# change needed for the front-end part),
// plus a native file-open command forwarded through the existing
// WebMessageReceived channel.
const { readFileSync, writeFileSync } = await import('node:fs');

// --- NativeWindow.cs: extend WebMessageReceived to handle "open:<path>"
let nw = readFileSync('native/NativeWindow.cs', 'utf8');

const anchor = "                    try\n                    {\n                        if (msg == \"win:min\") WindowState = FormWindowState.Minimized;\n                        else if (msg == \"win:max\")";
if (nw.indexOf(anchor) < 0) {
  console.log('NativeWindow.cs anchor not found');
  process.exit(1);
}

// Replace the msg dispatch block to also handle "open:" prefix
const oldBlock = `                    try
                    {
                        if (msg == "win:min") WindowState = FormWindowState.Minimized;
                        else if (msg == "win:max")
                            WindowState = WindowState == FormWindowState.Maximized
                                ? FormWindowState.Normal : FormWindowState.Maximized;
                        else if (msg == "win:close") Close();
                        else if (msg == "export:pdf") ExportPdf();
                    }`;

const newBlock = `                    try
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
                    }`;

if (nw.indexOf(oldBlock) < 0) { console.log('old block not found'); process.exit(1); }
nw = nw.replace(oldBlock, newBlock, 1);

// Add SwapDoc method to Server.cs
let sv = readFileSync('native/Server.cs', 'utf8');
const svAnchor = "        public void Reload()\n        {\n            BroadcastReload();\n        }";
if (sv.indexOf(svAnchor) < 0) { console.log('Server.cs Reload anchor not found'); process.exit(1); }

const svNew = `        public void Reload()
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
        }`;

sv = sv.replace(svAnchor, svNew, 1);
writeFileSync('native/Server.cs', sv);
writeFileSync('native/NativeWindow.cs', nw);
console.log('feat5 (drag-drop) done');
