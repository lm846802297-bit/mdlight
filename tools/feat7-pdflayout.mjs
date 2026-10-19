// feat7: publish-quality PDF layout — add @page margins, page-break-avoid on
// headings/tables/figures, and orphan/widow control to the print CSS.
// Extends the existing applyPdfMacros in ui/app.js.
import { readFileSync, writeFileSync } from 'node:fs';

let s = readFileSync('ui/app.js', 'utf8');

// Replace the existing applyPdfMacros CSS generation with a richer block.
const oldCssGen = `    var css = ['@media print {', '  @page { size: auto; margin: 20mm 15mm; }'];
    var q = String.fromCharCode(34); // double-quote char, kept out of the source string
    if (h) css.push('  body::before { content: ' + q + h.replace(new RegExp(q, 'g'), '\\\\' + q) + q + '; position: fixed; top: 5mm; left: 15mm; right: 15mm; font-size: 9px; color: #666; }');
    if (f) css.push('  body::after { content: ' + q + f.replace(new RegExp(q, 'g'), '\\\\' + q) + q + '; position: fixed; bottom: 5mm; left: 15mm; right: 15mm; font-size: 9px; color: #666; }');
    css.push('}');`;

const newCssGen = `    var css = [
      '@media print {',
      '  @page { size: auto; margin: 20mm 15mm; }',
      '  body { line-height: 1.6; orphans: 3; widows: 3; }',
      '  h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }',
      '  p, li { orphans: 3; widows: 3; }',
      '  pre, code { break-inside: avoid; page-break-inside: avoid; }',
      '  table { break-inside: avoid; page-break-inside: avoid; }',
      '  figure, .mdl-diagram { break-inside: avoid; page-break-inside: avoid; }',
      '  .mdl-folded { display: none; }',
      '  #mdl-toc, .mdl-toolbar, .mdl-find-bar, .mdl-sc-panel, #mdl-editor { display: none !important; }',
      '  body::before, body::after { z-index: 100; pointer-events: none; }',
    ];
    var q = String.fromCharCode(34);
    if (h) css.push('  body::before { content: ' + q + h.replace(new RegExp(q, 'g'), '\\\\' + q) + q + '; position: fixed; top: 5mm; left: 15mm; right: 15mm; font-size: 9px; color: #666; }');
    if (f) css.push('  body::after { content: ' + q + f.replace(new RegExp(q, 'g'), '\\\\' + q) + q + '; position: fixed; bottom: 5mm; left: 15mm; right: 15mm; font-size: 9px; color: #666; }');
    css.push('}');`;

if (s.indexOf(oldCssGen) < 0) {
  console.log('CSS gen block not found — checking exact text');
  // Try a looser match: look for the @media print line
  const looseAnchor = "var css = ['@media print {', '  @page { size: auto; margin: 20mm 15mm; }'];";
  if (s.indexOf(looseAnchor) < 0) {
    console.log('loose anchor also not found');
    process.exit(1);
  }
  // Find the full block and replace it
  const start = s.indexOf(looseAnchor);
  const endMarker = "css.push('}');";
  const end = s.indexOf(endMarker, start);
  if (end < 0) { console.log('end marker not found'); process.exit(1); }
  const blockEnd = end + endMarker.length;
  const oldBlock = s.substring(start, blockEnd);
  s = s.replace(oldBlock, newCssGen, 1);
} else {
  s = s.replace(oldCssGen, newCssGen, 1);
}

writeFileSync('ui/app.js', s);
console.log('feat7 done');
