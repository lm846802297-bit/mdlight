import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('out.push(') && lines[i].includes('cmd')) {
    const bs = String.fromCharCode(92);
    lines[i] = "      out.push('" + bs + "' + cmd + '{' + inlineTex(h[2]) + '}');";
    console.log('core line', i + 1, 'fixed:', JSON.stringify(lines[i]));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
