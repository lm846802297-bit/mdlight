import { readFileSync, writeFileSync } from 'node:fs';

// native/Server.cs — add /api/export-latex route
let cs = readFileSync('native/Server.cs', 'utf8');
if (cs.indexOf('/api/export-latex') < 0) {
  // insert route dispatch after the export-csv dispatch block
  const anchor = '                HandleExportCsv(req, res);\n                return;\n            }';
  const csAnchor = "            if (path == \"/api/export-csv\" &&\n                string.Equals(req.HttpMethod, \"POST\", StringComparison.OrdinalIgnoreCase))\n            {\n                HandleExportCsv(req, res);\n                return;\n            }";
  if (cs.indexOf(csAnchor) >= 0) {
    const newRoute = csAnchor + "\n\n"
      + "            // TeX export: the page posts the converted .tex text; write it next to the doc.\n"
      + "            if (path == \"/api/export-latex\" &&\n"
      + "                string.Equals(req.HttpMethod, \"POST\", StringComparison.OrdinalIgnoreCase))\n"
      + "            {\n"
      + "                HandleExportLatex(req, res);\n"
      + "                return;\n"
      + "            }";
    cs = cs.replace(csAnchor, newRoute);
    console.log('Server.cs: route dispatch added');
  }
  // add the handler method after HandleExportCsv
  const handlerEnd = '        /// <summary>POST /api/upload-asset?name=X.png';
  const handlerCode =
    "        /// <summary>POST /api/export-latex?name=X.tex — body is the .tex text produced\n"
    + "        /// by the page's mdToLatex(); written next to the markdown document.</summary>\n"
    + "        private void HandleExportLatex(HttpListenerRequest req, HttpListenerResponse res)\n"
    + "        {\n"
    + "            try\n"
    + "            {\n"
    + "                if (req.ContentLength64 > 64L * 1024 * 1024)\n"
    + "                {\n"
    + "                    SendError(res, 413, \"too large\");\n"
    + "                    return;\n"
    + "                }\n"
    + "                string tex;\n"
    + "                using (Stream s = req.InputStream)\n"
    + "                {\n"
    + "                    tex = Encoding.UTF8.GetString(Util.ReadAll(s));\n"
    + "                }\n"
    + "                string name = req.QueryString[\"name\"];\n"
    + "                if (string.IsNullOrEmpty(name)) name = Path.GetFileNameWithoutExtension(doc.Name) + \".tex\";\n"
    + "                name = Path.GetFileName(name);\n"
    + "                if (!name.EndsWith(\".tex\", StringComparison.OrdinalIgnoreCase)\n"
    + "                    || name.IndexOf(':') >= 0\n"
    + "                    || IsReservedDeviceName(name))\n"
    + "                {\n"
    + "                    SendError(res, 400, \"name must be a .tex file\");\n"
    + "                    return;\n"
    + "                }\n"
    + "                string outPath = Path.Combine(doc.Dir, name);\n"
    + "                if (string.Equals(Path.GetFullPath(outPath), doc.FullPath,\n"
    + "                                  StringComparison.OrdinalIgnoreCase))\n"
    + "                {\n"
    + "                    SendError(res, 400, \"refusing to overwrite the document\");\n"
    + "                    return;\n"
    + "                }\n"
    + "                // No BOM for .tex — LaTeX toolchains are BOM-hostile.\n"
    + "                System.IO.File.WriteAllText(outPath, tex, new UTF8Encoding(false));\n"
    + "                SendJson(res, \"{\\\"ok\\\":true,\\\"path\\\":\" + Util.JsonStr(outPath) + \"}\");\n"
    + "            }\n"
    + "            catch (Exception e)\n"
    + "            {\n"
    + "                SendJson(res, \"{\\\"ok\\\":false,\\\"error\\\":\" + Util.JsonStr(e.Message) + \"}\");\n"
    + "            }\n"
    + "        }\n\n"
    + handlerEnd;
  if (cs.indexOf(handlerEnd) >= 0) {
    cs = cs.replace(handlerEnd, handlerCode);
    console.log('Server.cs: HandleExportLatex method added');
  }
  writeFileSync('native/Server.cs', cs);
}
console.log('done');
