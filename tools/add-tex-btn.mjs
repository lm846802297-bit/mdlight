import { readFileSync, writeFileSync } from 'node:fs';

// 1. ui/index.html — insert #mdl-btn-tex after #mdl-btn-csv
let html = readFileSync('ui/index.html', 'utf8');
const texBtn = "      <button class=\"mdl-btn\" id=\"mdl-btn-tex\" title=\"\u5bfc\u51fa\u4e3a LaTeX (.tex)\" data-i18n-title=\"export-tex\">TeX</button>\n";
const marker = '    <button class="mdl-btn" id="mdl-btn-csv" title="\u5bfc\u51fa\u8868\u683c\u4e3a CSV" data-i18n-title="export-csv">\ud83d\udcca</button>';
if (html.indexOf('mdl-btn-tex') < 0) {
  if (html.indexOf(marker) >= 0) {
    html = html.replace(marker, marker + '\n' + texBtn.trimEnd());
    console.log('index.html: tex button inserted after csv button');
  } else {
    // fallback: insert after the split button
    const m2 = 'id="mdl-btn-split"';
    if (html.indexOf(m2) >= 0 && html.indexOf('mdl-btn-tex') < 0) {
      const idx = html.indexOf(m2) + m2.length;
      const endTag = html.indexOf('</button>', idx) + '</button>'.length;
      html = html.slice(0, endTag + 1) + '\n' + texBtn + html.slice(endTag + 1);
      console.log('index.html: tex button inserted (fallback)');
    }
  }
  writeFileSync('ui/index.html', html);
}

// 2. ui/i18n.js — add tex keys
let i18n = readFileSync('ui/i18n.js', 'utf8');
if (i18n.indexOf("'tex-exported'") < 0) {
  const zhAnchor = "      'tab-close': '\u5173\u95ed',";
  const zhKeys = "      'export-tex': '\u5bfc\u51fa\u4e3a LaTeX (.tex)',\n"
    + "      'tex-exported': '\u5df2\u5bfc\u51fa LaTeX \u6587\u4ef6',\n"
    + "      'tex-failed': 'LaTeX \u5bfc\u51fa\u5931\u8d25',\n";
  i18n = i18n.replace(zhAnchor, zhKeys + zhAnchor);
  const enAnchor = "      'tab-close': 'Close',";
  const enKeys = "      'export-tex': 'Export to LaTeX (.tex)',\n"
    + "      'tex-exported': 'LaTeX file exported',\n"
    + "      'tex-failed': 'LaTeX export failed',\n";
  i18n = i18n.replace(enAnchor, enKeys + enAnchor);
  writeFileSync('ui/i18n.js', i18n);
  console.log('i18n.js: tex keys added');
}

// 3. mdlight.mjs — add POST /api/export-latex route
let mjs = readFileSync('mdlight.mjs', 'utf8');
if (mjs.indexOf('/api/export-latex') < 0) {
  const csvRouteStart = "  if (req.method === 'POST' && path === '/api/export-csv') {";
  const csvIdx = mjs.indexOf(csvRouteStart);
  if (csvIdx >= 0) {
    const route = "  // \uFE0F export as LaTeX: the page posts the converted .tex text; we write it next to the doc.\n"
      + "  if (req.method === 'POST' && path === '/api/export-latex') {\n"
      + "    let name = url.searchParams.get('name') || (basename(mdPath, extname(mdPath)) + '.tex');\n"
      + "    name = basename(name);\n"
      + "    if (!/\.tex$/i.test(name) || name.indexOf(':') >= 0) {\n"
      + "      json(res, { ok: false, error: 'name must be a .tex file' });\n"
      + "      return;\n"
      + "    }\n"
      + "    const target = resolve(dirname(mdPath), name);\n"
      + "    if (target === resolve(mdPath)) {\n"
      + "      json(res, { ok: false, error: 'refusing to overwrite the document' });\n"
      + "      return;\n"
      + "    }\n"
      + "    readBody(req, (buf) => {\n"
      + "      try {\n"
      + "        writeFileSync(target, (buf ? buf.toString('utf8') : ''), 'utf8');\n"
      + "        json(res, { ok: true, path: target });\n"
      + "      } catch (e) {\n"
      + "        json(res, { ok: false, error: String(e && e.message || e) });\n"
      + "      }\n"
      + "    });\n"
      + "    return;\n"
      + "  }\n"
      + "\n";
    mjs = mjs.slice(0, csvIdx) + route + mjs.slice(csvIdx);
    writeFileSync('mdlight.mjs', mjs);
    console.log('mdlight.mjs: /api/export-latex route added');
  }
}

console.log('done');
