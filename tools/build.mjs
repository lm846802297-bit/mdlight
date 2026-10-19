// mdlight build: bundle everything (markdown-it/KaTeX/hljs/mhchem + core +
// CLI) into dist/mdlight.mjs — a single-file launcher + assets/ + ui/.
// The mermaid bundle (dist/mermaid/) is built separately by build-mermaid.mjs
// because it must stay SPLIT — see that file for why.
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
mkdirSync(dist, { recursive: true });

// 1) bundle the JS
await build({
  entryPoints: [join(root, '..', 'mdlight.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: join(dist, 'mdlight.mjs'),
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  banner: { js: '// mdlight 0.7.1 — MIT. Bundled with esbuild from open-source components (markdown-it, KaTeX, highlight.js — all MIT).' },
  logLevel: 'info',
});

// 2) ship assets (katex css + fonts + hljs css) and ui/ next to the launcher
const assetsDir = join(dist, 'assets');
mkdirSync(assetsDir, { recursive: true });
const katexDist = join(root, '..', 'node_modules', 'katex', 'dist');
copyFileSync(join(katexDist, 'katex.min.css'), join(assetsDir, 'katex.min.css'));
const fontsDir = join(assetsDir, 'fonts');
mkdirSync(fontsDir, { recursive: true });
for (const f of readdirSync(join(katexDist, 'fonts'))) {
  if (f.endsWith('.woff2')) copyFileSync(join(katexDist, 'fonts', f), join(fontsDir, f));
}
const hljsStyles = join(root, '..', 'node_modules', 'highlight.js', 'styles');
copyFileSync(join(hljsStyles, 'github.css'), join(assetsDir, 'hljs-github.css'));
const uiDist = join(dist, 'ui');
mkdirSync(uiDist, { recursive: true });
for (const f of ['index.html', 'app.js', 'mdserial.js', 'wysiwyg.js', 'i18n.js', 'app.css']) {
  copyFileSync(join(root, '..', 'ui', f), join(uiDist, f));
}

// 3) post-process: asset paths must resolve in BOTH layouts:
//    - dev:   <proj>/dist/mdlight.mjs with <proj>/node_modules present
//    - dist:  anywhere/mdlight.mjs with assets/ + ui/ siblings
//    The bundle keeps __dirname (esbuild ESM shim); we swap lookups to a
//    __here() helper that probes assets/ sibling first, node_modules second.
let code = readFileSync(join(dist, 'mdlight.mjs'), 'utf8');

const PRELUDE = `#!/usr/bin/env node
// mdlight 0.7.1 — MIT. Bundled with esbuild from open-source components
// (markdown-it, KaTeX, highlight.js — all MIT).
import { createRequire as __cr } from 'node:module';
const __require = __cr(import.meta.url);
const __nodePath = __require('node:path');
const __nodeFs = __require('node:fs');
const __nodeUrl = __require('node:url');
const __bundleDir = __nodePath.dirname(__nodeUrl.fileURLToPath(import.meta.url));
function __here(rel) {
  const cands = [
    __nodePath.join(__bundleDir, rel),
    __nodePath.join(__bundleDir, 'node_modules', 'katex', 'dist', rel.replace(/^assets\\//, '')),
    __nodePath.join(__bundleDir, 'node_modules', 'highlight.js', 'styles', rel.replace(/^assets\\/hljs-/, '')),
  ];
  for (const c of cands) if (__nodeFs.existsSync(c)) return c;
  return cands[0];
}
`;

code = code.replace(
  /join\(__dirname,\s*["']node_modules["'],\s*["']katex["'],\s*["']dist["'],\s*["']katex\.min\.css["']\)/g,
  "__here('assets/katex.min.css')"
);
code = code.replace(
  /join\(__dirname,\s*["']node_modules["'],\s*["']katex["'],\s*["']dist["'],\s*["']fonts["']\)/g,
  "__here('assets/fonts')"
);
code = code.replace(
  /join\(__dirname,\s*["']node_modules["'],\s*["']highlight\.js["'],\s*["']styles["'],\s*["']github\.css["']\)/g,
  "__here('assets/hljs-github.css')"
);

// UI dir: source uses join(__dirname, 'ui'). In dist layout that's dist/ui
// (shipped). In dev layout (project root run via node mdlight.mjs) __dirname
// is the project root, so root/ui. Both fine — leave as is.

code = code.replace(/^#!.*\n?/, '');
writeFileSync(join(dist, 'mdlight.mjs'), PRELUDE + code);

// 4) mermaid is NOT bundled here: it must stay split so a document without a
//    ```mermaid fence downloads nothing. build-mermaid.mjs writes dist/mermaid/
//    (entry + 106 lazy chunks + kinds.json). Skipped if mermaid is absent.
let mermaidNote = 'mermaid:   not installed — 跳过（mdlight 仍完全可用）';
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(root, 'build-mermaid.mjs')], { stdio: 'pipe' });
  const mj = JSON.parse(readFileSync(join(dist, 'mermaid', 'kinds.json'), 'utf8'));
  mermaidNote = 'dist/mermaid/      mermaid ' + mj.version + ' 按需包：' + mj.chunks
    + ' 个 chunk / ' + (mj.bytes / 1024 / 1024).toFixed(1) + ' MB（只在文档含图表时按需取用）';
} catch (e) {
  console.warn('  ! mermaid build skipped: ' + (e && e.message));
}

console.log('dist/ ready:');
console.log('  dist/mdlight.mjs   single-file launcher');
console.log('  dist/assets/       katex css + 20 fonts + hljs css');
console.log('  dist/ui/           index.html / app.js / app.css');
console.log('  ' + mermaidNote);
console.log('run: node dist/mdlight.mjs file.md');
