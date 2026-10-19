// Build the native (C# + WebView2) mdlight.exe.
//
// Why a separate host at all: a Node bundle ships node.exe verbatim
// (~89 MB of V8) because Node cannot be trimmed. This host is ~1 MB of IL on
// top of the system WebView2 runtime.
//
// Steps
//   1. bundle core/renderer.mjs for the BROWSER (it has zero Node deps, so the
//      same source renders on the client — output is verified identical)
//   2. pack every asset (UI, KaTeX + fonts, highlight.js css, mermaid chunks)
//      into ONE binary blob with a tab-separated index
//   3. compile native/*.cs with the in-box csc.exe and embed the blob
//
// Zero installs: csc.exe ships with Windows. The only build-time download is
// the WebView2 SDK NuGet package (see tools/fetch-webview2.mjs).

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(root, 'build', 'native');
const outDir = join(root, 'dist', 'native');
const sdkDir = join(root, 'vendor', 'webview2');

const read = (p) => readFileSync(p);
const exists = (p) => existsSync(p);

// ---------------------------------------------------------------------------
// 1. browser renderer bundle

async function bundleRenderer() {
  // IIFE + global, NOT ESM: exported single files are opened from file://,
  // where `import` is blocked by CORS. A classic script works in both places.
  await build({
    entryPoints: [join(root, 'core', 'renderer.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'MDLRenderer',
    platform: 'browser',
    target: 'chrome110',
    minify: true,
    legalComments: 'none',
    outfile: join(buildDir, 'renderer.js'),
  });
  const size = statSync(join(buildDir, 'renderer.js')).size;
  console.log(`  renderer.js (browser)   ${(size / 1024).toFixed(0)} KB`);
  return join(buildDir, 'renderer.js');
}

// ---------------------------------------------------------------------------
// 2. asset pack
//    MAGIC(8) | u32 indexLen | index (utf8, "path\toffset\tlength\n"*) | payload

function packAssets(rendererPath) {
  const files = new Map(); // served path -> absolute path

  const add = (served, abs) => {
    if (!exists(abs)) return false;
    files.set(served, abs);
    return true;
  };

  add('index.html', join(root, 'ui', 'index.html'));
  add('app.js', join(root, 'ui', 'app.js'));
  add('mdserial.js', join(root, 'ui', 'mdserial.js'));
  add('wysiwyg.js', join(root, 'ui', 'wysiwyg.js'));
  add('i18n.js', join(root, 'ui', 'i18n.js'));
  add('app.css', join(root, 'ui', 'app.css'));
  add('renderer.js', rendererPath);
  // Off-thread renderer worker: keeps the main thread responsive while KaTeX
  // renders thousands of formulas on a big document. Loaded by
  // new Worker('/assets/renderer-worker.js') in app.js; it importScripts the
  // renderer.js above, so both ship.
  add('renderer-worker.js', join(root, 'ui', 'renderer-worker.js'));

  // KaTeX: CSS + the woff2 fonts it references (served side by side, so the
  // css keeps its relative `url(fonts/...)` and the browser caches per file)
  const katex = join(root, 'node_modules', 'katex', 'dist');
  add('katex.min.css', join(katex, 'katex.min.css'));
  const fontDir = join(katex, 'fonts');
  if (exists(fontDir)) {
    for (const f of readdirSync(fontDir)) {
      if (f.endsWith('.woff2')) add('fonts/' + f, join(fontDir, f));
    }
  }

  add('hljs-github.css', join(root, 'node_modules', 'highlight.js', 'styles', 'github.css'));

  // mermaid on-demand chunks (built by tools/build-mermaid.mjs). Optional: the
  // host still works without them, diagrams just show their source.
  const mmDir = join(root, 'dist', 'mermaid');
  let mmCount = 0;
  if (exists(mmDir)) {
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          const rel = relative(mmDir, p).split(sep).join('/');
          files.set('mermaid/' + rel, p);
          mmCount++;
        }
      }
    };
    walk(mmDir);
  }

  // build payload + index
  const chunks = [];
  const indexLines = [];
  let offset = 0;
  for (const [served, abs] of files) {
    const buf = read(abs);
    chunks.push(buf);
    indexLines.push(served + '\t' + offset + '\t' + buf.length);
    offset += buf.length;
  }
  const index = Buffer.from(indexLines.join('\n') + '\n', 'utf8');
  const head = Buffer.alloc(12);
  head.write('MDLPACK1', 0, 'ascii');
  head.writeUInt32LE(index.length, 8);
  const pack = Buffer.concat([head, index, ...chunks]);
  writeFileSync(join(buildDir, 'pack.bin'), pack);

  console.log(`  pack.bin                ${(pack.length / 1024 / 1024).toFixed(2)} MB  (${files.size} 个文件, mermaid ${mmCount})`);
  return pack.length;
}

// ---------------------------------------------------------------------------
// 3. compile

function findCsc() {
  const c = [
    'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe',
  ].find(exists);
  if (!c) throw new Error('找不到 csc.exe（.NET Framework 应随 Windows 提供）');
  return c;
}

function compile() {
  const csc = findCsc();
  const fw = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319';
  const coreDll = join(sdkDir, 'Microsoft.Web.WebView2.Core.dll');
  const winDll = join(sdkDir, 'Microsoft.Web.WebView2.WinForms.dll');
  if (!exists(coreDll) || !exists(winDll)) {
    throw new Error('缺少 WebView2 SDK，先运行: node tools/fetch-webview2.mjs');
  }
  const srcDir = join(root, 'native');
  const srcs = readdirSync(srcDir).filter((f) => f.endsWith('.cs')).sort();
  if (!srcs.length) throw new Error('native/*.cs 不存在');

  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'mdlight.exe');
  const args = [
    '-nologo', '-target:winexe', '-platform:x64', '-optimize+',
    '-win32icon:' + join(root, 'assets', 'mdlight.ico').replace(/\//g, '\\'),
    '-out:' + out.replace(/\//g, '\\'),
    '-r:' + fw + '/System.dll',
    '-r:' + fw + '/System.Core.dll',
    '-r:' + fw + '/System.Drawing.dll',
    '-r:' + fw + '/System.Windows.Forms.dll',
    '-r:' + fw + '/System.Web.Extensions.dll',
    '-r:' + coreDll.replace(/\//g, '\\'),
    '-r:' + winDll.replace(/\//g, '\\'),
    // DLLs are embedded as well so the exe is genuinely self-contained
    '-resource:' + join(buildDir, 'pack.bin').replace(/\//g, '\\') + ',mdl.pack',
    '-resource:' + coreDll.replace(/\//g, '\\') + ',mdl.dll.Core',
    '-resource:' + winDll.replace(/\//g, '\\') + ',mdl.dll.WinForms',
    '-resource:' + join(sdkDir, 'WebView2Loader.dll').replace(/\//g, '\\') + ',mdl.dll.Loader',
  ].concat(srcs.map((f) => join(srcDir, f).replace(/\//g, '\\')));

  try {
    execFileSync(csc, args, { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    console.error(msg.slice(0, 4000));
    throw new Error('csc 编译失败');
  }
  const size = statSync(out).size;
  console.log(`  mdlight.exe             ${(size / 1024 / 1024).toFixed(2)} MB`);
  return out;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('构建 native 宿主 (C# + WebView2)');
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  // csc resolves the exe-relative DLLs at compile time; keep a copy beside it
  const renderer = await bundleRenderer();
  packAssets(renderer);
  // app icon: regenerate it if it is missing (needs Pillow; see tools/make-icon.py)
  const ico = join(root, 'assets', 'mdlight.ico');
  if (!existsSync(ico)) {
    console.log('生成图标 (python tools/make-icon.py) …');
    execFileSync(process.env.MDLIGHT_PYTHON || 'python', [join(root, 'tools', 'make-icon.py')], { stdio: 'inherit' });
    if (!existsSync(ico)) throw new Error('图标生成失败: assets/mdlight.ico 缺失');
  }
  const exePath = compile();
  // also place a copy at the project root so it is easy to find / drag a .md onto
  const rootExe = join(root, 'mdlight.exe');
  copyFileSync(exePath, rootExe);
  console.log('完成: dist/native/mdlight.exe（全部资源内嵌，单文件自足）');
  console.log(`     另已复制到项目根目录: mdlight.exe`);
}

main().catch((e) => {
  console.error('构建失败:', e.message);
  process.exit(1);
});
