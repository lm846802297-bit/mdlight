import { readFileSync, writeFileSync } from 'node:fs';

// 1) native/Server.cs — add GET /api/doc?path=... to read a second doc
let cs = readFileSync('native/Server.cs', 'utf8');
const anchor = '            if (path == "/api/doc")';
if (cs.indexOf(anchor) < 0) { console.log('cs anchor not found'); process.exit(1); }
// find the end of the existing /api/doc handler (the closing brace after the JSON send)
const i = cs.indexOf(anchor);
// The handler is: if (path == "/api/doc") { ... return; }
// find the closing of this if-block
const handlerStart = cs.indexOf('{', i);
let depth = 0, handlerEnd = handlerStart;
for (let k = handlerStart; k < cs.length; k++) {
  if (cs[k] === '{') depth++;
  else if (cs[k] === '}') { depth--; if (depth === 0) { handlerEnd = k; break; } }
}
const existingHandler = cs.slice(i, handlerEnd + 1);
// Append a second handler right after it
const newHandler = String.raw`
            // GET /api/doc?path=<abs> — read a second document for the split view
            if (path.StartsWith("/api/doc?", StringComparison.Ordinal))
            {
                string q = path.Substring("/api/doc?".Length);
                string p = null;
                int pi = q.IndexOf("path=");
                if (pi >= 0)
                    p = Uri.UnescapeDataString(q.Substring(pi + 5).Split('&')[0]);
                if (p == null || !System.IO.File.Exists(p))
                {
                    SendJson(res, new { ok = false, error = "not found" });
                    return;
                }
                try
                {
                    string src = System.IO.File.ReadAllText(p);
                    string sha = Util.Sha256Hex(src);
                    SendJson(res, new { ok = true, source = src, path = p, sha = sha });
                }
                catch (Exception ex)
                {
                    SendJson(res, new { ok = false, error = ex.Message });
                }
                return;
            }
`;
cs = cs.slice(0, handlerEnd + 1) + newHandler + cs.slice(handlerEnd + 1);
writeFileSync('native/Server.cs', cs);
console.log('Server.cs: /api/doc?path= handler added');

// 2) native/Server.cs — add SendJson helper if not present
cs = readFileSync('native/Server.cs', 'utf8');
if (cs.indexOf('SendJson') < 0) {
  // add it after the SendText helper
  const sendTextAnchor = cs.indexOf('void SendText(HttpResponseStream res');
  if (sendTextAnchor < 0) { console.log('SendText anchor not found'); process.exit(1); }
  const insertAt = cs.indexOf('\n', cs.indexOf('}', sendTextAnchor)) + 1;
  const helper = String.raw`
        static void SendJson(HttpResponseStream res, object obj)
        {
            var json = Json.Serialize(obj);
            var bytes = Encoding.UTF8.GetBytes(json);
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength = bytes.Length;
            res.Write(bytes, 0, bytes.Length);
        }
`;
  cs = cs.slice(0, insertAt) + helper + cs.slice(insertAt);
  writeFileSync('native/Server.cs', cs);
  console.log('Server.cs: SendJson helper added');
} else {
  console.log('Server.cs: SendJson already present');
}

// 3) ui/app.js — i18n keys for split
let js = readFileSync('ui/app.js', 'utf8');
// add i18n keys to both language objects
const i18nFile = 'ui/i18n.js';
let i18n = readFileSync(i18nFile, 'utf8');
const zhAnchor = "  'dd-not-md':";
const enAnchor = "  'dd-not-md':";
if (i18n.indexOf("split-enabled") < 0) {
  // add keys near the dd keys
  const ddIdx = i18n.indexOf(zhAnchor);
  if (ddIdx < 0) { console.log('i18n dd anchor not found'); process.exit(1); }
  const insert = String.raw`  'split-enabled': '\u5206\u5c4f\u5df2\u6253\u5f00\uff0c\u53f3\u4fa7\u663e\u793a\u53e6\u4e00\u4e2a\u6587\u6863',
  'split-disabled': '\u5206\u5c4f\u5df2\u5173\u95ed',
`;
  i18n = i18n.slice(0, ddIdx) + insert + i18n.slice(ddIdx);
  writeFileSync(i18nFile, i18n);
  console.log('i18n: split keys added');
} else {
  console.log('i18n: split keys already present');
}
