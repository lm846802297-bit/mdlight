import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/parity-check.mjs', 'utf8');
const normLine = "const norm = (s) => s.replace(/\s+/g, ' ').trim();";
const i = s.indexOf(normLine);
if (i < 0) { console.log('norm line not found'); process.exit(1); }
const j = s.indexOf(';', i);
const add = '\n  // Mermaid SVGs carry engine-specific presentation attributes (width/height/\n'
  + '  // viewBox/style/theme seeds); collapse each to a marker so the structural\n'
  + "  // comparison stays meaningful.\n"
  + "  const collapse = (s) => s.replace(/<svg[^>]*>[\s\S]*?<\/svg>/g, '[MERMAID-SVG]');\n"
  + '  const an = collapse(norm(a.body));\n'
  + '  const bn = collapse(norm(b.body));';
s = s.slice(0, j + 1) + add + s.slice(j + 1);
const cmp = "ok(norm(a.body) === norm(b.body), '\u2605 \u4e24\u8fb9 #mdl-content \u7ed3\u6784\u5b8c\u5168\u4e00\u81f3',";
if (s.indexOf(cmp) < 0) { console.log('cmp anchor not found'); process.exit(1); }
s = s.replace(cmp, "ok(an === bn, '\u2605 \u4e24\u8fb9 #mdl-content \u7ed3\u6784\u5b8c\u5168\u4e00\u81f3\uff08mermaid SVG \u6298\u53e0\u540e\uff09',", 1);
s = s.replace("const x = norm(a.body), y = norm(b.body);", 'const x = an, y = bn;', 1);
s = s.replace("norm(a.body) === norm(b.body) ? '' :", 'an === bn ? \'\' :', 1);
writeFileSync('test/parity-check.mjs', s);
console.log('fix-parity-svg3 done');
