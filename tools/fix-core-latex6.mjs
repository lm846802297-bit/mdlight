import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
const bs = String.fromCharCode(92);

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();

  if (t.startsWith('out.push(') && t.includes('cmd')) {
    const four = bs + bs + bs + bs;
    lines[i] = '      out.push(' + "'" + four + "'" + ' + cmd + ' + '"{")
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  if (t.includes("img[2].split('?')")) {
    const two = bs + bs;
    const lineA = "      var file = img[2].split('?')[0].split('#')[0]"
      + ".replace(new RegExp('" + two + "g"), '/')"
      + ".replace(/[^A-Za-z0-9_.\\" + bs + bs + "-/]/g, '');";
    lines[i] = lineA;
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
