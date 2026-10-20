#!/usr/bin/env node
// mdlight — a lightweight, offline, zero-telemetry local Markdown viewer.
// CLI entry + HTTP server + SSE live reload + single-file export.
// MIT licensed. All code written from scratch; no third-party closed-source code.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, watch as fsWatch, mkdirSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { extname, join, dirname, resolve, basename, relative, isAbsolute, sep } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render } from './core/renderer.mjs';

// ---------------------------------------------------------------------------
// CLI
const argv = process.argv.slice(2);
let fileArg = null;
let portArg = 0;         // 0 = random free port
let exportMode = false;  // --export
let exportPath = null;   // optional output path/dir
let noWindow = false;
let wantHelp = false;
let wantVersion = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port' || a === '-p') portArg = parseInt(argv[++i], 10) || 0;
  else if (a === '--export') {
    exportMode = true;
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) { exportPath = next; i++; }
  }
  else if (a === '--no-window') noWindow = true;
  else if (a === '--help' || a === '-h') wantHelp = true;
  else if (a === '--version' || a === '-v') wantVersion = true;
  else if (!fileArg && !a.startsWith('-')) fileArg = a;
}

const VERSION = '0.9.8';

if (wantHelp || (!fileArg && !wantVersion)) {
  console.log(`mdlight ${VERSION} — 轻量流畅的 Markdown 阅读与转换器（全格式数学·PDF/LaTeX互换）

用法:
  mdlight <file.md>                     预览（自动弹出无边框窗口）
  mdlight <file.md> --export [out.html] 导出单文件 HTML（缺省同名 .html）
  mdlight <file.md> -p 8080             固定端口（默认随机空闲端口）
  mdlight <file.md> --no-window         不开窗口（脚本/CI 用）

开箱即用（免安装 Node 的 mdlight.exe）:
  双击 mdlight.exe          弹出文件选择框，选中 .md 即开
  把 .md 拖到 mdlight.exe   直接打开该文件
  mdlight.exe 命令行用法与上面完全一致

环境变量:
  MD_EDITOR   外部编辑器模板，例如:  set MD_EDITOR=code --goto "{file}:{line}"
              {file} 和 {line} 会被替换成当前文件与光标行（F2 / ✎ 按钮）
              未设置时依次尝试 code → code-insiders → subl → notepad++ → notepad
              若都找不到，点 ✍ 进入直接编辑，再点工具栏“源码”切到源码视图

特性: 保存即热重载 · TOC · 亮/暗/羊皮纸主题 · 公式错误卡片（显示具体报错）
       代码块离线高亮 · 中文公式自动 \\text{} 包裹 · \\newcommand 宏 · 直接编辑（所见即所得，含源码视图）
      · mermaid 图表按需加载（文档无图表则零额外下载）· 零遥测零联网`);
  process.exit(wantHelp || fileArg ? 0 : 1);
}
if (wantVersion) { console.log(VERSION); process.exit(0); }

// ---------------------------------------------------------------------------
// file resolution
const cwd = process.cwd();

let mdPath = resolve(cwd, fileArg);
if (!existsSync(mdPath)) {
  console.error('找不到文件: ' + mdPath);
  process.exit(1);
}
if (statSync(mdPath).isDirectory()) {
  const cand = ['README.md', 'readme.md', 'index.md']
    .map(f => join(mdPath, f)).find(existsSync);
  if (!cand) {
    console.error('目录里没有 README.md / index.md: ' + mdPath);
    process.exit(1);
  }
  mdPath = cand;
}

// ---------------------------------------------------------------------------
// paths
const __dirname = dirname(fileURLToPath(import.meta.url));
// ---------------------------------------------------------------------------
// embedded-asset layer: read ui/ assets/ fonts and the on-demand mermaid
// bundle from disk (project root, or <dist>/ after build.mjs path rewriting).
function readAsset(key, asText) {
  let p = null;
  if (key.startsWith('ui/'))
    p = join(__dirname, 'ui', key.slice(3));
  else if (key === 'assets/katex.min.css')
    p = join(__dirname, 'node_modules', 'katex', 'dist', 'katex.min.css');
  else if (key.startsWith('assets/fonts/')) {
    // build.mjs rewrites this exact expression to __here('assets/fonts') so the
    // shipped dist resolves fonts from <dist>/assets/fonts (keep it verbatim).
    const fontsDir = join(__dirname, 'node_modules', 'katex', 'dist', 'fonts');
    p = join(fontsDir, key.slice('assets/fonts/'.length));
  }
  else if (key === 'assets/hljs-github.css')
    p = join(__dirname, 'node_modules', 'highlight.js', 'styles', 'github.css');
  else if (key.startsWith('mermaid/'))
    p = join(MERMAID_DIR, key.slice('mermaid/'.length));
  if (!p || !existsSync(p) || !statSync(p).isFile()) return null;
  const buf = readFileSync(p);
  return asText ? buf.toString('utf8') : buf;
}

const UI_DIR = join(__dirname, 'ui');

// mermaid on-demand bundle (tools/build-mermaid.mjs).
// Layout differs between dev (<root>/dist/mermaid) and the shipped dist
// (<dist>/mermaid), so probe both.
const MERMAID_DIR = [
  join(__dirname, 'dist', 'mermaid'),
  join(__dirname, 'mermaid'),
].find((d) => existsSync(join(d, 'kinds.json'))) || join(__dirname, 'dist', 'mermaid');
let mermaidKinds = null;
function getMermaidKinds() {
  if (mermaidKinds) return mermaidKinds;
  const raw = readAsset('mermaid/kinds.json', true);
  if (raw) { try { mermaidKinds = JSON.parse(raw); return mermaidKinds; } catch { /* bad json */ } }
  mermaidKinds = { kinds: {}, entry: 'mermaid-entry.js' };
  return mermaidKinds;
}

// ---------------------------------------------------------------------------
// asset pipeline: KaTeX CSS + fonts inlined as base64 (fully offline, fix #4)
let katexCssCache = null;
function getKatexCss() {
  if (katexCssCache) return katexCssCache;
  let css = readAsset('assets/katex.min.css', true);
  if (css == null) css = readFileSync(join(__dirname, 'node_modules', 'katex', 'dist', 'katex.min.css'), 'utf8');
  // inline woff2 only (the format every modern browser prefers); woff/ttf
  // fallbacks stay as relative URLs and are simply unused.
  css = css.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (m, rel) => {
    const b = readAsset('assets/fonts/' + rel.replace(/^fonts\/?/, ''));
    if (b == null) return m;
    return 'url(data:font/woff2;base64,' + b.toString('base64') + ') format("woff2")';
  });
  katexCssCache = css;
  return css;
}
function getHljsCss() {
  return readAsset('assets/hljs-github.css', true)
    ?? readFileSync(join(__dirname, 'node_modules', 'highlight.js', 'styles', 'github.css'), 'utf8');
}
function getCustomCss() {
  // %APPDATA%\mdlight\custom.css first, then custom.css beside the document
  const cands = [
    process.env.APPDATA && join(process.env.APPDATA, 'mdlight', 'custom.css'),
    join(dirname(mdPath), 'custom.css'),
  ].filter(Boolean);
  for (const c of cands) {
    if (existsSync(c)) return readFileSync(c, 'utf8');
  }
  return '/* put your overrides in %APPDATA%\\mdlight\\custom.css or beside the .md */';
}

// ---------------------------------------------------------------------------
// user preferences — same file the native host writes, so both entry points
// share one set of settings (%APPDATA%\\mdlight\\config.json).
function configDir() {
  // MDLIGHT_CONFIG_DIR is the FINAL directory (already carries "mdlight"),
  // matching native/Config.cs so tests can isolate both hosts the same way.
  const env = process.env.MDLIGHT_CONFIG_DIR;
  if (env) { try { return resolve(env); } catch { /* fall through */ } }
  const appData = process.env.APPDATA;
  return appData ? join(appData, 'mdlight') : join(__dirname, '.mdlight');
}
function configPath() { return join(configDir(), 'config.json'); }
function readConfig() {
  try {
    const o = JSON.parse(readFileSync(configPath(), 'utf8'));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch { return {}; }
}
function writeConfig(patch) {
  const merged = Object.assign({}, readConfig(), (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {});
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const tmp = configPath() + '.tmp';
  // atomic swap: a crash mid-write must never truncate the real config.
  // Do NOT swallow the exception — let it propagate so /api/config POST
  // returns {ok:false} instead of a false success.
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  renameSync(tmp, configPath());
  return merged;
}
// Collect a request body with a hard cap; cb(null) means "too large".
function readBody(req, cb) {
  const chunks = [];
  let size = 0, over = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > 64 * 1024 * 1024) { over = true; try { req.destroy(); } catch { /* ignore */ } return; }
    chunks.push(c);
  });
  req.on('end', () => { if (!over) cb(Buffer.concat(chunks)); });
  req.on('error', () => { /* client vanished */ });
}
// Write a file inside the document directory only. Resolves the target and
// rejects anything that escapes <docdir> (percent-encoded ".." included).
function writeInsideDocDir(relDir, name, data) {
  const root = resolve(dirname(mdPath));
  const dir = resolve(root, relDir);
  if (dir !== root && !dir.startsWith(root + sep)) return null;
  const target = resolve(dir, name);
  if (!target.startsWith(dir + sep)) return null;
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, data);
  return target;
}
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

// ---------------------------------------------------------------------------
// SSE live reload: watch the *directory* (editor atomic saves rename files,
// which would break a file-handle watcher) and filter by basename.
const clients = new Set();
let reloadTimer = null;
let _watcher = null;
function broadcastReload() {
  const msg = 'data: reload\n\n';
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}
function startWatcher() {
  if (_watcher) { try { _watcher.close(); } catch { /* ignore */ } _watcher = null; }
  const dir = dirname(mdPath);
  const base = basename(mdPath).toLowerCase();
  try {
    const w = fsWatch(dir, { persistent: false }, (_event, filename) => {
      const f = filename ? basename(String(filename)).toLowerCase() : '';
      // reload on the md file itself, or a sibling custom.css override
      if (f && f !== base && f !== 'custom.css') return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(broadcastReload, 150);
    });
    w.on('error', () => { try { w.close(); } catch { /* ignore */ } });
    _watcher = w;
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// page template
function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}
function sha256(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}
function buildPage(opts) {
  const tpl = readAsset('ui/index.html', true)
    ?? readFileSync(join(UI_DIR, 'index.html'), 'utf8');
  // NB: all replacements use the function form — user content (body, css)
  // can contain $` $& $' patterns that string replacements would interpret.
  return tpl
    .replace('__TITLE_HTML__', () => escapeHtmlAttr(opts.title || 'mdlight'))
    .replace('__FILENAME_HTML__', () => escapeHtmlAttr(opts.filename || ''))
    .replace('__FILEPATH_HTML__', () => escapeHtmlAttr(opts.filepath || ''))
    .replace('__FILEPATH_JSON__', () => JSON.stringify(opts.filepath || ''))
    .replace('__VERSION__', () => VERSION)
    .replace('__BODY__', () => opts.body || '')
    .replace('__TOC_JSON__', () => JSON.stringify(opts.toc || []))
    .replace('__EQ_COUNT__', () => String(opts.eqCount || 0))
    .replace('__ERR_COUNT__', () => String(opts.errCount || 0))
    .replace('__MERMAID_COUNT__', () => String(opts.mermaidCount || 0))
    .replace('__CLIENT_RENDER__', () => (opts.clientRender ? 'true' : 'false'));
}

// ---------------------------------------------------------------------------
// external editor (fix #6b: MD_EDITOR template instead of registry probing)
function whichWin(exe) {
  try { execSync('where ' + exe, { stdio: 'ignore', windowsHide: true }); return true; }
  catch { return false; }
}
function openInEditor(line) {
  line = line || 1;
  const tpl = process.env.MD_EDITOR;
  if (tpl) {
    const cmd = tpl.replace(/\{file\}/g, mdPath).replace(/\{line\}/g, String(line));
    spawn(cmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
    return { ok: true, via: 'MD_EDITOR' };
  }
  const chain = [
    ['code', ['--goto', mdPath + ':' + line]],
    ['code-insiders', ['--goto', mdPath + ':' + line]],
    ['subl', [mdPath + ':' + line]],
    ['notepad++', ['-n' + line, mdPath]],
    ['notepad', [mdPath]],
  ];
  for (const [exe, args] of chain) {
    if (!whichWin(exe)) continue;
    spawn(exe + ' ' + args.map(a => '"' + a + '"').join(' '), { shell: true, detached: true, stdio: 'ignore' }).unref();
    return { ok: true, via: exe };
  }
  return { ok: false, error: '未找到编辑器；请设置 MD_EDITOR（见 --help）' };
}

// ---------------------------------------------------------------------------
// export: one self-contained HTML file — fonts, styles, images, and the UI
// script all inlined; no tracking params, works from file:// offline.
function exportHtml(outPath) {
  const src = readFileSync(mdPath, 'utf8');
  const { html, headings, mermaidCount } = render(src);
  let page = buildPage({
    title: basename(mdPath),
    filename: basename(mdPath),
    filepath: mdPath,
    body: html,
    toc: headings,
    eqCount: (html.match(/<x-equation\b/g) || []).length,
    errCount: (html.match(/<div class="mdl-math-error">/g) || []).length,
    mermaidCount,
  });
  const customCss = getCustomCss();
  const assets = '<style>' + getKatexCss() + '</style>\n' +
    '<style>' + getHljsCss() + '</style>\n' +
    '<style>' + readAsset('ui/app.css', true) + '</style>\n' +
    '<style class="mdl-custom">' + customCss + '</style>';
  const appJs = '<script>\n' + readAsset('ui/app.js', true) + '\n</script>';
  page = page
    .replace('data-live', () => 'data-static')
    // editing is a live-server feature: in a static export the ✍/✎ buttons
    // would open a save pipeline that has no /api/save to talk to, so hide them
    .replace('<button class="mdl-btn" id="mdl-btn-wysiwyg"',
             () => '<button class="mdl-btn" id="mdl-btn-wysiwyg" hidden')
    .replace('<button class="mdl-btn" id="mdl-btn-edit"',
             () => '<button class="mdl-btn" id="mdl-btn-edit" hidden')
    .replace('<link rel="stylesheet" href="/assets/katex.css">', () => '')
    .replace('<link rel="stylesheet" href="/assets/app.css">', () => '')
    .replace('<link rel="stylesheet" href="/assets/custom.css">', () => '')
    .replace('<!--MDL:ASSETS-->', () => assets)
    .replace('<script src="/assets/mdserial.js"></script>', () => '')
    .replace('<script src="/assets/wysiwyg.js"></script>', () => '')
    .replace('<script src="/assets/i18n.js"></script>', () => '')
    .replace('<script src="/assets/app.js"></script>', () => appJs);
  page = inlineImages(page, dirname(mdPath));
  writeFileSync(outPath, page);
  return { ok: true, path: outPath, bytes: Buffer.byteLength(page) };
}

function inlineImages(page, baseDir) {
  return page.replace(/(<img[^>]+src=")(?!data:|https?:|\/)([^"]+)(")/g, (m, pre, rel, post) => {
    const p = resolve(baseDir, rel);
    // Anti-traversal: reject anything that resolves outside the document
    // directory (same guard as the image-serving route).
    const rel2 = relative(baseDir, p);
    if (rel2 === '' || rel2.startsWith('..') || isAbsolute(rel2)) return m;
    if (!existsSync(p)) return m;
    try {
      return pre + 'data:' + mimeOf(extname(p).toLowerCase()) + ';base64,'
        + readFileSync(p).toString('base64') + post;
    } catch { return m; }
  });
}
function mimeOf(ext) {
  return {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// HTTP server (loopback only)
// the port the listener actually bound to (0 = random until listen() resolves),
// used by the /api/* origin guard below.
let boundPort = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);

  // Only our own page may drive the API. Without this, any website could POST
  // /api/save (a text/plain body is a CORS "simple request", so no preflight)
  // and overwrite the open document. Same guard as native/Server.cs.
  if (path.startsWith('/api/') || path === '/events') {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== 'http://127.0.0.1:' + boundPort) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
  }

  if (path === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (path === '/api/open-editor') {
    json(res, openInEditor(Number(url.searchParams.get('line') || 1)));
    return;
  }

  // POST /api/import-md — body {"name":"X.md","content":"...markdown..."}.
  // Writes a markdown file next to the current doc (from an imported
  // PDF/LaTeX source) and swaps to it, so "一键导入" produces an editable .md
  // immediately. Same shape/guards as the native host's HandleOpenFile drop.
  if (req.method === 'POST' && path === '/api/import-md') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 64 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const { name, content } = JSON.parse(body);
        if (!name || typeof content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'name+content required' }));
          return;
        }
        if (!/\.(md|markdown)$/i.test(name) || name.indexOf(':') >= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'name must be a .md file' }));
          return;
        }
        const target = resolve(dirname(mdPath), basename(name));
        if (target === resolve(mdPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'refusing to overwrite the open document' }));
          return;
        }
        writeFileSync(target, content, 'utf8');
        // Swap the served document to the newly imported .md and make the
        // open page reload it (mirrors native SwapDoc-on-import).
        mdPath = target;
        startWatcher();
        setTimeout(broadcastReload, 30);
        json(res, { ok: true, path: target });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // built-in source editor support: GET source with its sha256; save checks
  // the hash to detect external modification while the user was editing.
  if (path === '/api/source') {
    const src = readFileSync(mdPath, 'utf8');
    json(res, { ok: true, source: src, sha: sha256(src) });
    return;
  }
  if (req.method === 'POST' && path === '/api/save') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 64 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const { source, base, force } = JSON.parse(body);
        const cur = readFileSync(mdPath, 'utf8');
        if (!force && typeof base === 'string' && base !== sha256(cur)) {
          // file changed on disk while the user edited — ask, don't clobber
          res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, conflict: true, sha: sha256(cur) }));
          return;
        }
        // atomic write: a crash mid-write must never truncate the document
        const tmp = mdPath + '.mdlight-tmp-' + process.pid;
        writeFileSync(tmp, source);
        renameSync(tmp, mdPath);
        json(res, { ok: true, saved: true, sha: sha256(source) });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // ---- user preferences (same config.json the native host writes) --------
  // Response shapes match native/Server.cs exactly: GET returns the raw
  // config object (the page does `fetch().then(r=>r.json()).then(applyConfig)`),
  // POST returns {ok:true, config:true}.
  if (path === '/api/config') {
    if (req.method === 'POST') {
      readBody(req, (buf) => {
        try {
          let patch = {};
          if (buf && buf.length) patch = JSON.parse(buf.toString('utf8'));
          writeConfig(patch);
          json(res, { ok: true, config: true });
        } catch (e) {
          json(res, { ok: false, error: String(e && e.message || e) });
        }
      });
      return;
    }
    json(res, readConfig());
    return;
  }
  // The settings dialog is a WinForms window; the Node entry point has no UI
  // for it, so answer with a clear error instead of a bare 404.
  if (req.method === 'POST' && path === '/api/settings') {
    json(res, { ok: false, error: 'settings window is only available in mdlight.exe' });
    return;
  }
  // CSV next to the document (Excel-friendly UTF-8 BOM, like the native host)
  // ️ export as LaTeX: the page posts the converted .tex text; we write it next to the doc.
  if (req.method === 'POST' && path === '/api/export-latex') {
    let name = url.searchParams.get('name') || (basename(mdPath, extname(mdPath)) + '.tex');
    name = basename(name);
    if (!/.tex$/i.test(name) || name.indexOf(':') >= 0) {
      json(res, { ok: false, error: 'name must be a .tex file' });
      return;
    }
    const target = resolve(dirname(mdPath), name);
    if (target === resolve(mdPath)) {
      json(res, { ok: false, error: 'refusing to overwrite the document' });
      return;
    }
    readBody(req, (buf) => {
      try {
        writeFileSync(target, (buf ? buf.toString('utf8') : ''), 'utf8');
        json(res, { ok: true, path: target });
      } catch (e) {
        json(res, { ok: false, error: String(e && e.message || e) });
      }
    });
    return;
  }

  if (req.method === 'POST' && path === '/api/export-csv') {
    let name = url.searchParams.get('name') || (basename(mdPath, extname(mdPath)) + '.csv');
    name = basename(name);
    const stem = name.replace(/\.[^.]*$/, '');
    if (!/\.csv$/i.test(name) || name.indexOf(':') >= 0 ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
      json(res, { ok: false, error: 'name must be a .csv file' });
      return;
    }
    const target = resolve(dirname(mdPath), name);
    if (target === resolve(mdPath)) {
      json(res, { ok: false, error: 'refusing to overwrite the document' });
      return;
    }
    readBody(req, (buf) => {
      try {
        writeFileSync(target, '\uFEFF' + (buf ? buf.toString('utf8') : ''), 'utf8');
        json(res, { ok: true, path: target });
      } catch (e) {
        json(res, { ok: false, error: String(e && e.message || e) });
      }
    });
    return;
  }
  // raw image bytes -> <docdir>/assets/<name>
  if (req.method === 'POST' && path === '/api/upload-asset') {
    let name = url.searchParams.get('name');
    if (!name) { json(res, { ok: false, error: 'name missing' }); return; }
    name = basename(name);
    if (!IMAGE_EXT.test(name)) { json(res, { ok: false, error: 'not an image' }); return; }
    readBody(req, (buf) => {
      const target = writeInsideDocDir('assets', name, buf || Buffer.alloc(0));
      if (!target) { json(res, { ok: false, error: 'invalid name' }); return; }
      json(res, { ok: true, path: 'assets/' + name });
    });
    return;
  }

  if (path === '/assets/app.js') {
    const b = readAsset('ui/app.js');
    if (b == null) { res.writeHead(404); res.end('app.js missing'); return; }
    send(res, 'application/javascript; charset=utf-8', b);
    return;
  }
  if (path === '/assets/mdserial.js' || path === '/assets/wysiwyg.js' || path === '/assets/i18n.js') {
    const key = path.slice('/assets/'.length);
    const b = readAsset('ui/' + key);
    if (b == null) { res.writeHead(404); res.end(key + ' missing'); return; }
    send(res, 'application/javascript; charset=utf-8', b);
    return;
  }
  if (path === '/assets/app.css') {
    const b = readAsset('ui/app.css');
    if (b == null) { res.writeHead(404); res.end('app.css missing'); return; }
    send(res, 'text/css; charset=utf-8', b);
    return;
  }
  // Browser build of core/renderer.mjs — the classic <script> the page loads
  // AND the importScripts() target inside the renderer worker.
  if (path === '/assets/renderer.js') {
    try {
      const src = readAsset('ui/renderer.js', true);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(src);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 renderer.js');
    }
    return;
  }

  // Off-thread renderer worker (parity with the native host's /assets route)
  if (path === '/assets/renderer-worker.js') {
    try {
      const src = readAsset('ui/renderer-worker.js', true);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(src);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 renderer-worker.js');
    }
    return;
  }

  if (path === '/assets/katex.css') {
    send(res, 'text/css; charset=utf-8', getKatexCss());
    return;
  }
  if (path === '/assets/hljs.css') {
    send(res, 'text/css; charset=utf-8', getHljsCss());
    return;
  }
  // mermaid on-demand chunks. A document WITHOUT a mermaid fence never requests
  // any of these, so the 5 MB bundle costs nothing unless it is actually used.
  //
  // Note: the client does NOT consult kinds.json to decide what to fetch — it
  // hands the diagram source to mermaid's own detectType()/render(), which
  // dynamically imports exactly the one chunk for that kind (the same detectors
  // kinds.json was extracted from). kinds.json is exposed for tooling and test
  // assertions; it is not on the page's critical path.
  if (path === '/assets/mermaid/kinds.json') {
    send(res, 'application/json; charset=utf-8', JSON.stringify(getMermaidKinds()));
    return;
  }
  if (path.startsWith('/assets/mermaid/')) {
    const rel = path.slice('/assets/mermaid/'.length);
    // no traversal: chunk filenames only
    if (!/^[A-Za-z0-9._-]+\.js$/.test(rel)) { res.writeHead(400); res.end('bad chunk name'); return; }
    const b = readAsset('mermaid/' + rel);
    if (b == null) {
      res.writeHead(404); res.end('mermaid chunk not found: ' + rel);
    } else {
      send(res, 'application/javascript; charset=utf-8', b);
    }
    return;
  }
  // custom.css: user theming without touching the app (user theming feature).
  // Lookup order: %APPDATA%\mdlight\custom.css → custom.css beside the .md.
  if (path === '/assets/custom.css') {
    send(res, 'text/css; charset=utf-8', getCustomCss());
    return;
  }

  // relative images from the md file's directory
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path)) {
    const base = resolve(dirname(mdPath));
    const abs = resolve(base, path.replace(/^\//, ''));
    // Anti-traversal: reject anything that resolves outside the document
    // directory. Node's URL parser normalizes literal ".." but not percent-
    // encoded %2e%2e, so decodeURIComponent(url.pathname) can hand us a
    // "../../" after resolution — block it here.
    const rel = relative(base, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (existsSync(abs) && statSync(abs).isFile()) {
      send(res, mimeOf(extname(abs).toLowerCase()), readFileSync(abs));
    } else {
      res.writeHead(404); res.end('image not found');
    }
    return;
  }

  if (path === '/' || path === '/index.html') {
    try {
      const src = readFileSync(mdPath, 'utf8');
      const { html, headings, mermaidCount } = render(src);
      const page = buildPage({
        title: basename(mdPath),
        filename: basename(mdPath),
        filepath: mdPath,
        body: html,
        toc: headings,
        eqCount: (html.match(/<x-equation\b/g) || []).length,
        errCount: (html.match(/<div class="mdl-math-error">/g) || []).length,
        mermaidCount,
      });
      send(res, 'text/html; charset=utf-8', page);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('render error: ' + (e && e.stack ? e.stack : e));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

function json(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function send(res, type, body) {
  res.writeHead(200, { 'Content-Type': type });
  res.end(body);
}

// ---------------------------------------------------------------------------
// window: Edge --app (chromeless) with graceful fallbacks
function openWindow(url) {
  const edgeCandidates = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const p of edgeCandidates) {
    if (existsSync(p)) {
      spawn('"' + p + '" --app=' + url + ' --window-size=1200,860', { shell: true, detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  spawn('cmd /c start "" "' + url + '"', { shell: true, detached: true, stdio: 'ignore' }).unref();
}

// ---------------------------------------------------------------------------
// startup
function main() {
  if (exportMode) {
    let target;
    if (!exportPath) {
      target = mdPath.replace(/\.md$/i, '') + '.html';
    } else {
      const p = resolve(cwd, exportPath);
      if (existsSync(p) && statSync(p).isDirectory()) {
        target = join(p, basename(mdPath).replace(/\.md$/i, '') + '.html');
      } else {
        target = p;
      }
    }
    // Don't let --export clobber a markdown source (same guard as native
    // Program.cs: a .md/.markdown output is almost certainly a mistake).
    if (/\.md$|\.markdown$/i.test(target)) {
      console.error('导出路径不能是 .md 或 .markdown 文件');
      process.exit(1);
    }
    const r = exportHtml(target);
    console.log('已导出 → ' + r.path + ' (' + (r.bytes / 1024).toFixed(1) + ' KB，单文件、离线可开、无跟踪参数)');
    process.exit(0);
  }

  server.listen(portArg, '127.0.0.1', () => {
    const { port } = server.address();
    boundPort = port;
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('mdlight ' + VERSION + ' — ' + mdPath);
    console.log('  ' + url);
    startWatcher();
    if (!noWindow) openWindow(url);
    console.log('  （Ctrl+C 退出 · 保存文件自动热重载 · F2 跳编辑器）');
  });
}

main();
