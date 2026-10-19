import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  // line 736: var file = img[2].split('?')[0].split('#')[0].replace(/\/g, '/')...
  if (t.includes("img[2].split('?')") && t.includes("replace(/\/g")) {
    // We need the file to contain .replace(/\/g, '/') where \ is two backslash chars
    const bs = String.fromCharCode(92);
    lines[i] = "      var file = img[2].split('?')[0].split('#')[0].replace(new RegExp('" + bs + bs + "g"), '/').replace(/[^A-Za-z0-9_.\-" + bs + "/]/g, '');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
