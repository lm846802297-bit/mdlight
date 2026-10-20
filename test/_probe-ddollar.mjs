// Scratch probe: find $$...$$ display blocks whose inner content contains an unescaped '$'.
// Used to judge whether tightening display math is safe on the real corpus.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
    else if (/\.md$/i.test(e.name)) files.push(p);
  }
})(root);

let blocks = 0, bad = 0;
const examples = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  let i = 0;
  while ((i = s.indexOf('$$', i)) !== -1) {
    const j = s.indexOf('$$', i + 2);
    if (j === -1) break;
    const inner = s.slice(i + 2, j);
    blocks++;
    // unescaped '$' = a '$' not preceded by a backslash
    let unesc = false;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === '$' && inner[k - 1] !== '\\') { unesc = true; break; }
    }
    if (unesc) {
      bad++;
      if (examples.length < 6) examples.push([basename(f), JSON.stringify(inner.slice(0, 100))]);
    }
    i = j + 2;
  }
}
console.log('files:', files.length, 'display blocks:', blocks, 'with inner unescaped $:', bad);
for (const [f, ex] of examples) console.log(' -', f, '::', ex);
