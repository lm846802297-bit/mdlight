// Aggregate every mdl-math-error in a directory tree by message, with example sources.
// usage: node test/_probe-errclass.mjs <dir> [maxExamplesPerClass]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { render } from '../core/renderer.mjs';

const root = process.argv[2];
const MAXEX = Number(process.argv[3] || 4);
if (!root) { console.error('usage: node test/_probe-errclass.mjs <dir> [maxExamples]'); process.exit(2); }

function walk(dir, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, out); }
    else if (extname(e.name).toLowerCase() === '.md') out.push(p);
  }
  return out;
}

const files = walk(root);
const classes = new Map();   // msgKey -> { count, files:Set, examples:[] }
const throws = [];

for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  let html;
  try { html = render(src).html; } catch (e) {
    throws.push({ file: relative(root, f), msg: e.message });
    continue;
  }
  const re = /<div class="mdl-math-error">[\s\S]*?<span class="mdl-math-error-msg">([\s\S]*?)<\/span>[\s\S]*?<pre class="mdl-math-error-src">([\s\S]*?)<\/pre>/g;
  let m;
  while ((m = re.exec(html))) {
    const msg = m[1].trim();
    const bad = m[2].trim();
    // normalise: collapse the utilde-marked slice and positions so equal bug classes merge
    const key = msg.replace(/at position \d+/g, 'at position N').replace(/[\u0332]/g, '');
    if (!classes.has(key)) classes.set(key, { count: 0, files: new Set(), examples: [] });
    const c = classes.get(key);
    c.count++; c.files.add(relative(root, f));
    if (c.examples.length < MAXEX && !c.examples.some(e => e.src === bad)) c.examples.push({ src: bad, file: relative(root, f) });
  }
}

const rows = [...classes.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`# ${files.length} .md files scanned under ${root}`);
console.log(`# ${rows.reduce((s, r) => s + r[1].count, 0)} error cards in ${rows.length} classes; ${throws.length} render-throws\n`);
for (const [key, c] of rows) {
  console.log(`## [${c.count}] ${key}   (in ${c.files.size} file(s))`);
  console.log(`     files: ${[...c.files].slice(0, 3).map(f => f.replace(/\\/g, '/')).join(' | ')}`);
  for (const ex of c.examples) console.log(`     src: ${JSON.stringify(ex.src).slice(0, 200)}\n          @ ${ex.file}`);
  console.log('');
}
if (throws.length) {
  console.log('## RENDER-THROW');
  for (const t of throws) console.log(`   ${t.file}\n     ${t.msg}`);
}
