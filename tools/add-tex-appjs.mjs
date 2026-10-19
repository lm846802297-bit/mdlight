import { readFileSync, writeFileSync } from 'node:fs';

let js = readFileSync('ui/app.js', 'utf8');

// 1. Add exportLatex() function after exportCsv() block (after line 657 'if (csvBtn) csvBtn.addEventListener...')
const csvBtnAnchor = "  var csvBtn = document.getElementById('mdl-btn-csv');\n  if (csvBtn) csvBtn.addEventListener('click', exportCsv);\n";
if (js.indexOf(csvBtnAnchor) >= 0 && js.indexOf('exportLatex') < 0) {
  const texCode = csvBtnAnchor + "\n"
    + "  // ---- export current document as LaTeX (.tex) --------------------------\n"
    + "  function exportLatex() {\n"
    + "    var mod = window.MDLRenderer;\n"
    + "    if (!mod || typeof mod.mdToLatex !== 'function') {\n"
    + "      toast(t('tex-failed', 'LaTeX \u5bfc\u51fa\u5931\u8d25')); return;\n"
    + "    }\n"
    + "    // Get the raw markdown source: prefer the in-memory source from the\n"
    + "    // source editor if open, otherwise fetch from the server.\n"
    + "    var sourceEl2 = document.getElementById('mdl-source');\n"
    + "    var doExport = function (source) {\n"
    + "      if (!source) { toast(t('tex-failed', 'LaTeX \u5bfc\u51fa\u5931\u8d25')); return; }\n"
    + "      var tex;\n"
    + "      try { tex = mod.mdToLatex(source); }\n"
    + "      catch (e) { toast(t('tex-failed', 'LaTeX \u5bfc\u51fa\u5931\u8d25')); return; }\n"
    + "      var base = (S.filepath || 'document').replace(/\.[^.]*$/, '');\n"
    + "      var name = base + '.tex';\n"
    + "      fetch('/api/export-latex?name=' + encodeURIComponent(name),\n"
    + "        { method: 'POST', body: tex })\n"
    + "        .then(function (r) { return r.json(); })\n"
    + "        .then(function (j) {\n"
    + "          if (j && j.ok) toast(t('tex-exported', '\u5df2\u5bfc\u51fa LaTeX \u6587\u4ef6'));\n"
    + "          else toast(t('tex-failed', 'LaTeX \u5bfc\u51fa\u5931\u8d25') + ' ' + ((j && j.error) || ''));\n"
    + "        })\n"
    + "        .catch(function () { toast(t('no-service', '\u65e0\u6cd5\u8054\u7cfb mdlight \u670d\u52a1')); });\n"
    + "    };\n"
    + "    if (sourceEl2 && sourceEl2.value && sourceEl2.value.trim()) {\n"
    + "      doExport(sourceEl2.value);\n"
    + "    } else {\n"
    + "      // fetch source from the server\n"
    + "      fetch('/api/source', { cache: 'no-store' })\n"
    + "        .then(function (r) { return r.json(); })\n"
    + "        .then(function (j) { doExport((j && j.source) || ''); })\n"
    + "        .catch(function () { toast(t('no-service', '\u65e0\u6cd5\u8054\u7cfb mdlight \u670d\u52a1')); });\n"
    + "    }\n"
    + "  }\n"
    + "  var texBtn = document.getElementById('mdl-btn-tex');\n"
    + "  if (texBtn) texBtn.addEventListener('click', exportLatex);\n";
  js = js.replace(csvBtnAnchor, texCode);
  writeFileSync('ui/app.js', js);
  console.log('app.js: exportLatex + tex button handler added');
} else {
  console.log('app.js: skipped (anchor missing or already present)');
}
