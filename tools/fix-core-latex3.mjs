import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('out.push(') && lines[i].includes('cmd')) {
    const q = String.fromCharCode(39);  // '
    const bs = String.fromCharCode(92); // \
    // target source text:
    //       out.push('\' + cmd + '{' + inlineTex(h[2]) + '}');
    // where \ is two backslash characters in the file
    lines[i] = '      out.push(' + q + bs + bs + q + ' + cmd + ' + q + '{' + q + ' + inlineTex(h[2]) + ' + q + '}' + q + ');';
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
