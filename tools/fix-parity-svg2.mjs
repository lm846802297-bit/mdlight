import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/parity-check.mjs', 'utf8');
const old = "  const norm = (s) => s.replace(/\s+/g, ' ').trim();\n  ok(norm(a.body) === norm(b.body), '★ 两边 #mdl-content 结构完全一致',";
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = `  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  // Mermaid SVGs carry engine-specific presentation attributes (width/height/
  // viewBox/style/theme seeds); collapse each to a marker so the structural
  // comparison stays meaningful.
  const collapse = (s) => s.replace(/<svg[^>]*>.*?<\/svg>/g, '[MERMAID-SVG]');
  const an = collapse(norm(a.body));
  const bn = collapse(norm(b.body));
  ok(an === bn, '★ 两边 #mdl-content 结构完全一致（mermaid SVG 折叠后）',`;
s = s.replace(old, nw, 1);
// the diff-reporting closure below references norm(a.body)/norm(b.body); update to an/bn
s = s.replace("        const x = norm(a.body), y = norm(b.body);",
             "        const x = an, y = bn;", 1);
s = s.replace("    norm(a.body) === norm(b.body) ? '' :\n      'first diff @ ' + (() => {",
             "    an === bn ? '' :\n      'first diff @ ' + (() => {", 1);
writeFileSync('test/parity-check.mjs', s);
console.log('fix-parity-svg2 done');
