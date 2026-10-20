// Risk scan before adding ^x^ / ~x~ / ++x++ / ==x== inline rules:
// count prose occurrences that a naive rule would misinterpret.
// usage: node test/_probe-risksyntax.mjs <dir...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const roots = process.argv.slice(2);
if (!roots.length) { console.error('usage: node test/_probe-risksyntax.mjs <dir...>'); process.exit(2); }

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

// strip fenced code, inline code, math spans, and html tags so we scan prose only
function proseOf(src) {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

const tally = {
  subTilde: [],      // ~...~ single tilde pair
  subTildeDigit: [], // digit ~ ... ~ digit  (numeric range — MUST NOT become <sub>)
  markEq: [],        // ==...==
  markEqDigit: [],   // a == b comparisons
  insPlus: [],       // ++...++
  supCaret: [],      // ^...^
};

const files = roots.flatMap(r => { try { return statSync(r).isDirectory() ? walk(r) : [r]; } catch { return []; } });

for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const prose = proseOf(src);
  const push = (k, m) => tally[k].push({ file: relative(process.cwd(), f), ctx: m[0].slice(0, 60) });

  for (const m of prose.matchAll(/(?<!~)~([^~\n]{1,40}?)(?<!~)~(?!~)/g)) push('subTilde', m);
  for (const m of prose.matchAll(/(?<!~)~(\s?\d[\d.,]*\s?)~(?=\s?\d)/g)) push('subTildeDigit', m);
  for (const m of prose.matchAll(/(?<![=])==([^=\n]{1,40}?)(?<![=])==(?!=)/g)) push('markEq', m);
  for (const m of prose.matchAll(/(?<![=])==(?!=)/g)) push('markEqDigit', m);
  for (const m of prose.matchAll(/(?<![+])\+\+([^+\n]{1,40}?)(?<![+])\+\+(?![+])/g)) push('insPlus', m);
  for (const m of prose.matchAll(/(?<![\\^])\^([^\^\n]{1,40}?)\^(?!\^)/g)) push('supCaret', m);
}

for (const [k, arr] of Object.entries(tally)) {
  console.log(`=== ${k}: ${arr.length} occurrence(s) in prose ===`);
  for (const a of arr.slice(0, 8)) console.log(`    ${JSON.stringify(a.ctx)}  @ ${a.file.replace(/\\/g, '/')}`);
  if (arr.length > 8) console.log(`    … ${arr.length - 8} more`);
}
