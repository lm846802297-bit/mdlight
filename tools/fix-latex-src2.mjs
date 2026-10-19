import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('tools/feat14-latex-src.js', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('out.push(') && lines[i].includes('cmd')) {
    // replace with correct line using char codes:
    // single-quote = 39, backslash = 92
    // target: out.push('<BS>' + cmd + '{' + inlineTex(h[2]) + '}');
    // where <BS> is one backslash char in the source file
    const bs = String.fromCharCode(92);
    lines[i] = "      out.push('" + bs + "' + cmd + '{' + inlineTex(h[2]) + '}');";
    console.log('fixed line', i + 1, JSON.stringify(lines[i]));
  }
}
writeFileSync('tools/feat14-latex-src.js', lines.join('\n'));
