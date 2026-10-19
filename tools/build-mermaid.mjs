// build-mermaid.mjs — build mermaid's ON-DEMAND split bundle into dist/mermaid/.
//
// MEASURED WHY (mermaid 12.2.0 + esbuild, Node v24.20.0):
//   * `import mermaid from 'mermaid'` bundles to 5.01 MB minified / 1.42 MB gzip.
//     Reason: the core holds 36 dynamic import() calls (one per diagram kind) and
//     esbuild must resolve ALL of them to build, so it inlines every chunk.
//   * With `--splitting` those dynamic imports stay LAZY. Verified by graph
//     analysis of the split output: the entry's STATIC closure is 20 files /
//     696 KB (d3 + dagre + khroma + dayjs runtime) and contains ZERO of the 57
//     diagram chunks — they load only when their loader runs.
//   * So the real cost is: 0 KB for a doc with no mermaid · 696 KB for any doc
//     with mermaid · +25..1628 KB per diagram kind actually present.
//
// OUTPUT:
//   dist/mermaid/mermaid-entry.js   entry (imports mermaid, exposes lazy render)
//   dist/mermaid/chunk-*.js         split chunks, fetched on demand
//   dist/mermaid/kinds.json         kind -> { detect, chunk } so both server and
//                                   client can classify a fence without loading
//                                   any chunk
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'dist', 'mermaid');
const NM = join(root, '..', 'node_modules');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(NM, 'mermaid', 'package.json'), 'utf8'));
const core = readFileSync(join(NM, 'mermaid', 'dist', 'mermaid.core.mjs'), 'utf8');

// The entry deliberately does NOT call loadRegisteredDiagrams() — that eagerly
// fetches all 36 chunks. It exposes mermaid's own lazy render instead.
const ENTRY = `
import mermaid from 'mermaid';

// Detect the diagram kind from source text. mermaid's detectors live in the core,
// so classification is free; only rendering needs the kind's chunk.
export function detect(text) {
  try { return mermaid.detectType(text); } catch { return null; }
}

// Render into a DOM element. mermaid lazily imports only the chunk for the
// detected kind, so an unused kind is never downloaded.
export async function renderInto(el, text, id) {
  const rid = id || ('mm' + Math.random().toString(36).slice(2));
  const { svg } = await mermaid.render(rid, text);
  el.innerHTML = svg;
  return svg;
}

export function setConfig(cfg) {
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // mdlight renders its own error card (source + the specific parse error,
      // same principle as the KaTeX error card). Without this, mermaid also
      // appends its own "Syntax error" bomb SVG to the end of the document,
      // which duplicates the message and looks broken.
      suppressErrorRendering: true,
      ...cfg,
    });
  } catch { /* ignore */ }
}

export default mermaid;
`;

const entryFile = join(outDir, '__entry.mjs');
writeFileSync(entryFile, ENTRY);

await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  target: 'chrome100',
  splitting: true,
  minify: true,
  outdir: outDir,
  entryNames: 'mermaid-entry',
  chunkNames: 'chunk-[name]-[hash]',
  legalComments: 'none',
  logLevel: 'warning',
});
rmSync(entryFile, { force: true });

// ---- kinds.json ------------------------------------------------------------
// Extract, per plugin: id, its detector regex source, and the source chunk its
// loader imports. All three come from the upstream core, so the map cannot drift
// from the real loader graph.
const KINDS = {};
{
  // Most plugins are emitted as `var idN = "kind"; var detectorN = ...;
  // var loaderN = ...`, but c4 is emitted WITHOUT the numeric suffix
  // (`var id = "c4"; var detector = ...`). Capture both forms — a suffix of ''
  // means "unsuffixed".
  const plugins = [];
  const idRe = /var id(\d*) = "([^"]+)";/g;
  let im;
  while ((im = idRe.exec(core)) !== null) plugins.push({ n: im[1], kind: im[2] });

  for (const { n, kind } of plugins) {
    const dStart = core.indexOf('var detector' + n + ' =');
    const lStart = core.indexOf('var loader' + n + ' =');
    let detect = null;
    if (dStart !== -1) {
      const seg = core.slice(dStart, dStart + 400);
      const mm = seg.match(/\/\^([\s\S]*?)\/([a-z]*)\.test/);
      if (mm) detect = { src: '^' + mm[1], flags: mm[2] || '' };
    }
    let chunk = null;
    if (lStart !== -1) {
      const seg = core.slice(lStart, lStart + 500);
      const im2 = seg.match(/import\(\s*["']([^"']+)["']\s*\)/);
      if (im2) chunk = im2[1].replace(/^\.\/chunks\/mermaid\.core\//, '');
    }
    KINDS[kind] = { detect, chunk };
  }
}
// Three plugins share a detector var / literal and are not captured above.
KINDS['flowchart-v2'] = { detect: { src: '^\\s*(graph|flowchart)', flags: '' }, chunk: KINDS['flowchart-v2']?.chunk || 'flowDiagram-IUGLLWBU.mjs' };
KINDS['classDiagram'] = { detect: { src: '^\\s*classDiagram', flags: '' }, chunk: KINDS['classDiagram']?.chunk || 'classDiagram-v2-4MYWR3UA.mjs' };
KINDS['stateDiagram'] = { detect: { src: '^\\s*stateDiagram', flags: '' }, chunk: KINDS['stateDiagram']?.chunk || 'stateDiagram-v2-A6IESKWZ.mjs' };

// Map upstream source chunk basename -> the split chunk file esbuild emitted.
const emitted = readdirSync(outDir).filter(f => f.endsWith('.js'));
const byName = new Map();
for (const f of emitted) byName.set(f, f);
// esbuild keeps the [name] segment (e.g. flowDiagram-IUGLLWBU-HASH) so match on
// the upstream basename prefix.
function splitChunk(srcChunk) {
  if (!srcChunk) return null;
  const base = srcChunk.replace(/\.mjs$/, '');
  const hit = emitted.find(f => f.includes(base + '-'));
  return hit || null;
}

const kindsOut = {};
for (const [kind, v] of Object.entries(KINDS)) {
  kindsOut[kind] = {
    detect: v.detect,
    chunk: v.chunk,
    split: splitChunk(v.chunk),
  };
}

const files = emitted;
writeFileSync(join(outDir, 'kinds.json'), JSON.stringify({
  version: pkg.version,
  entry: 'mermaid-entry.js',
  chunks: files.length,
  bytes: files.reduce((s, f) => s + statSync(join(outDir, f)).size, 0),
  kinds: kindsOut,
}, null, 2));

const missing = Object.entries(kindsOut).filter(([, v]) => !v.split).map(([k]) => k);
console.log('dist/mermaid/ built:');
console.log('  chunks :', files.length);
console.log('  bytes  :', (files.reduce((s, f) => s + statSync(join(outDir, f)).size, 0) / 1024).toFixed(0), 'KB');
console.log('  kinds  :', Object.keys(kindsOut).length, missing.length ? ('(unmapped: ' + missing.join(',') + ')') : '(all mapped)');
