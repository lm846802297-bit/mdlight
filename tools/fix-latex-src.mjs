import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('tools/feat14-latex-src.js', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf("out.push('' + cmd") >= 0 || lines[i].match(/out\.push\('\\'? \+ cmd/)) {
    lines[i] = "      out.push('\' + cmd + '{' + inlineTex(h[2]) + '}');";
    console.log('fixed line', i + 1, ':', lines[i]);
  }
}
writeFileSync('tools/feat14-latex-src.js', lines.join('\n'));
