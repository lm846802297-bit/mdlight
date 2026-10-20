// bisect: find the minimal single line (and then minimal prefix) that makes render() throw.
import { render } from '../core/renderer.mjs';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

let bad = [];
for (let i = 0; i < lines.length; i++) {
  try { render(lines[i]); } catch (e) { bad.push(i + 1); }
}
console.log('lines that throw alone: ' + (bad.length ? bad.join(', ') : '(none)'));
for (const n of bad.slice(0, 3)) {
  console.log('--- line ' + n + ':');
  console.log(JSON.stringify(lines[n - 1].slice(0, 400)));
  // shrink the line char by char from the left and right to find a minimal repro
  let s = lines[n - 1];
  let changed = true;
  while (changed) {
    changed = false;
    for (let cut = 1; cut < s.length; cut++) {
      const t = s.slice(cut);
      let thrown = false;
      try { render(t); } catch { thrown = true; }
      if (thrown) { s = t; changed = true; break; }
    }
    if (changed) continue;
    for (let cut = s.length - 1; cut >= 1; cut--) {
      const t = s.slice(0, cut);
      let thrown = false;
      try { render(t); } catch { thrown = true; }
      if (thrown) { s = t; changed = true; break; }
    }
  }
  console.log('minimal repro: ' + JSON.stringify(s));
}
