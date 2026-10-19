// Append the clean mdToLatex source (tools/feat14-latex-src.js) to core/renderer.mjs
import { readFileSync, writeFileSync } from 'node:fs';

let core = readFileSync('core/renderer.mjs', 'utf8');
if (core.includes('export function mdToLatex')) {
  console.log('mdToLatex already present');
  process.exit(0);
}
const src = readFileSync('tools/feat14-latex-src.js', 'utf8');

// update the export list
const em = core.match(/export \{[^}]+\}/m);
if (em) {
  const inner = em[0].replace(/^export \{|\}$/g, '').trim();
  if (inner.indexOf('mdToLatex') < 0) {
    core = core.replace(em[0], 'export { ' + inner + ', mdToLatex }');
  }
}
core = core.replace(/\n*$/, '\n') + '\n' + src + '\n';
writeFileSync('core/renderer.mjs', core);
console.log('mdToLatex appended, core len:', core.length);
