import { readFileSync, writeFileSync } from 'node:fs';
let js = readFileSync('ui/app.js', 'utf8');
const anchor = "ctxMenu.appendChild(ctxItem('\ud83d\udcca', t('export-csv', '\u5bfc\u51fa\u8868\u683c\u4e3a CSV'), '', function () { exportCsv(); }));";
if (js.indexOf(anchor) >= 0 && js.indexOf('export-tex') < 1597) {
  const newLine = "\n    ctxMenu.appendChild(ctxItem('TeX', t('export-tex', '\u5bfc\u51fa\u4e3a LaTeX (.tex)'), '', function () { exportLatex(); }));";
  js = js.replace(anchor, anchor + newLine);
  writeFileSync('ui/app.js', js);
  console.log('app.js: tex ctx-menu item added');
} else if (js.indexOf("t('export-tex'") >= 0) {
  console.log('app.js: tex ctx-menu already present');
} else {
  console.log('app.js: anchor not found, skipping ctx menu');
}
