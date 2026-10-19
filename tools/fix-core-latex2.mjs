import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('out.push(') && lines[i].includes('cmd')) {
    // Use char codes to write exactly: out.push('\' + cmd + '{' + inlineTex(h[2]) + '}');
    // 92 = backslash, 39 = single quote
    const bs = String.fromCharCode(92);
    const q = String.fromCharCode(39);
    lines[i] = "      out.push(" + q + bs + q + " + cmd + " + q + "{" + q + " + inlineTex(h[2]) + " + q + "}" + q + ");";
    console.log('line', i + 1, '=>', lines[i]);
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
