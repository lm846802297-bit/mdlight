import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');
const block = readFileSync('tools/feat12-block.js', 'utf8');

const oldStart = s.indexOf('  function applyPdfMacros() {');
const oldEnd = s.indexOf('  // ---- print ------------------------------------------------------------------', oldStart);
if (oldStart < 0 || oldEnd < 0) { console.log('anchors not found'); process.exit(1); }

s = s.slice(0, oldStart) + block + s.slice(oldEnd);

// 2) print button: re-do the call with afterprint unwinding
const oldPrint = "  var printBtn = document.getElementById('mdl-btn-print');\n  if (printBtn) printBtn.addEventListener('click', function () {\n    applyPdfMacros();\n    window.print();\n  });";
if (s.indexOf(oldPrint) < 0) { console.log('print anchor not found'); process.exit(1); }
const NEW_PRINT =
  "  var printBtn = document.getElementById('mdl-btn-print');\n" +
  "  if (printBtn) printBtn.addEventListener('click', function () {\n" +
  "    applyPdfMacros();\n" +
  "    // Let the paginated layout paint before the print dialog locks the DOM.\n" +
  "    setTimeout(function () { window.print(); }, 80);\n" +
  "  });\n" +
  "  // Undo pagination after printing so the on-screen view returns to normal flow.\n" +
  "  window.addEventListener('afterprint', function () {\n" +
  "    var content = document.getElementById('mdl-content');\n" +
  "    if (content) {\n" +
  "      content.querySelectorAll(':scope > .pdf-page').forEach(function (p) {\n" +
  "        while (p.firstChild) content.insertBefore(p.firstChild, p);\n" +
  "        p.remove();\n" +
  "      });\n" +
  "      content.classList.remove('pdf-paginated');\n" +
  "      var st = document.getElementById('mdl-pdf-macros');\n" +
  "      if (st) st.remove();\n" +
  "    }\n" +
  "  });";
s = s.replace(oldPrint, NEW_PRINT, 1);
writeFileSync('ui/app.js', s);
console.log('feat12-paginated-pdf done');
