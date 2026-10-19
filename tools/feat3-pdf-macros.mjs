#!/usr/bin/env node
// feat3: PDF header/footer macros + @page CSS in ui/app.js
const { readFileSync, writeFileSync } = await import('node:fs');
let s = readFileSync('ui/app.js', 'utf8');

const printAnchor = "  // ---- print ------------------------------------------------------------------\n  var printBtn = document.getElementById('mdl-btn-print');";
if (s.indexOf(printAnchor) < 0) { console.log('print anchor not found'); process.exit(1); }

// Build the code to insert (avoid nested-escape problems by keeping the
// generated JS free of backslash-heavy string literals).
const block = [
  "  // ---- PDF header / footer macros (@page + JS replacement) -----------------",
  "  // {title}/{page}/{total}/{date} placeholders in the configured",
  "  // pdfHeader/pdfFooter strings are substituted at print time; an @media",
  "  " + "print <style> carries @page margins so the print engine (or WebView2's",
  "  // PrintToPdfAsync) lays out with real page geometry.",
  "  function pdfMacro(str, title, page, total) {",
  "    if (!str) return '';",
  "    var d = new Date();",
  "    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');",
  "    return String(str)",
  "      .replace(/\\{title\\}/g, title || '')",
  "      .replace(/\\{page\\}/g, String(page || 1))",
  "      .replace(/\\{total\\}/g, String(total || 1))",
  "      .replace(/\\{date\\}/g, date);",
  "  }",
  "  function estimateTotalPages() {",
  "    var h = document.body.scrollHeight || 842;",
  "    return Math.max(1, Math.ceil(h / 842));",
  "  }",
  "  function applyPdfMacros() {",
  "    var cfg = S.cfg || {};",
  "    var header = cfg.pdfHeader || '';",
  "    var footer = cfg.pdfFooter || '';",
  "    if (!header && !footer) return;",
  "    var title = (S.toc && S.toc[0] && S.toc[0].text) || (fileEl ? fileEl.textContent : '');",
  "    var total = estimateTotalPages();",
  "    var curPage = Math.max(1, Math.round((window.scrollY || 0) / 842) + 1);",
  "    var h = pdfMacro(header, title, curPage, total);",
  "    var f = pdfMacro(footer, title, curPage, total);",
  "    var style = document.getElementById('mdl-pdf-macros') || document.createElement('style');",
  "    style.id = 'mdl-pdf-macros';",
  "    var css = ['@media print {', '  @page { size: auto; margin: 20mm 15mm; }'];",
  "    var q = String.fromCharCode(34); // double-quote char, kept out of the source string",
  "    if (h) css.push('  body::before { content: ' + q + h.replace(new RegExp(q, 'g'), '\\\\' + q) + q + '; position: fixed; top: 5mm; left: 15mm; right: 15mm; font-size: 9px; color: #666; }');",
  "    if (f) css.push('  body::after { content: ' + q + f.replace(new RegExp(q, 'g'), '\\\\' + q) + q + '; position: fixed; bottom: 5mm; left: 15mm; right: 15mm; font-size: 9px; color: #666; }');",
  "    css.push('}');",
  "    style.textContent = css.join(String.fromCharCode(10));",
  "    if (!style.parentNode) document.head.appendChild(style);",
  "  }",
  "",
].join('\n');

s = s.replace(printAnchor, block + '\n' + printAnchor, 1);

const oldPrintHandler = "  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });";
const newPrintHandler =
  "  if (printBtn) printBtn.addEventListener('click', function () {\n" +
  "    applyPdfMacros();\n" +
  "    window.print();\n" +
  "  });";

if (s.indexOf(oldPrintHandler) < 0) { console.log('print handler not found'); process.exit(1); }
s = s.replace(oldPrintHandler, newPrintHandler, 1);

writeFileSync('ui/app.js', s);
console.log('feat3 done');
