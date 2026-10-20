// For one .md file: list every mdl-math-error with the raw source line it came from.
// usage: node test/_probe-errline.mjs <file.md> [msgFilter] [max]
import { readFileSync } from 'node:fs';
import { render } from '../core/renderer.mjs';

const file = process.argv[2];
const filter = process.argv[3] || '';
const max = Number(process.argv[4] || 12);
if (!file) { console.error('usage: node test/_probe-errline.mjs <file.md> [msgFilter] [max]'); process.exit(2); }

const src = readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);
let html;
try { html = render(src).html; } catch (e) {
  console.log('RENDER-THROW: ' + e.message);
  process.exit(0);
}

const re = /<div class="mdl-math-error">[\s\S]*?<span class="mdl-math-error-msg">([\s\S]*?)<\/span>[\s\S]*?<pre class="mdl-math-error-src">([\s\S]*?)<\/pre>/g;
const lineRe = /data-mdl-line="(\d+)"/g;

// precompute positions of every data-mdl-line marker
const marks = [];
let lm;
while ((lm = lineRe.exec(html))) marks.push({ pos: lm.index, line: Number(lm[1]) });

function lineForPos(pos) {
  let best = null;
  for (const m of marks) { if (m.pos < pos) best = m; else break; }
  return best ? best.line : null;
}

const seen = new Map();
let total = 0, shown = 0;
let m;
while ((m = re.exec(html))) {
  const msg = m[1].trim();
  const bad = m[2].trim();
  if (filter && !msg.includes(filter)) continue;
  total++;
  const ln = lineForPos(m.index);
  const key = msg.replace(/at position \d+/g, 'at position N').replace(/\u0332/g, '');
  if (!seen.has(key)) seen.set(key, { n: 0, first: ln });
  seen.get(key).n++;
  if (shown < max) {
    shown++;
    console.log(`--- [line ${ln}] ${msg}`);
    console.log(`    katex-input: ${JSON.stringify(bad).slice(0, 240)}`);
    if (ln && lines[ln - 1] != null) console.log(`    raw[${ln}]: ${lines[ln - 1].slice(0, 240)}`);
    console.log('');
  }
}
console.log(`# ${total} card(s) matched${filter ? ` filter=${JSON.stringify(filter)}` : ''}`);
for (const [k, v] of [...seen.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`   [${v.n}] first@line ${v.first}  ${k}`);
