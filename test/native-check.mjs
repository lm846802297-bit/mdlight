// End-to-end test for the NATIVE host (dist/native/mdlight.exe).
//
// The native host has no Node renderer, so the page renders client-side with the
// browser build of core/renderer.mjs. That means the parts worth proving are
// different from the Node suite:
//   * does the client renderer actually produce the same markup?
//   * does the embedded asset pack serve everything the page needs?
//   * does the built-in editor's sha256 conflict check still work?
//   * does file watching still trigger a live reload?
//   * does a native export open without any server?
//
// Drives headless Edge over CDP (native WebSocket, no dependencies).
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { exePath } from './_stage-exe.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = exePath(); // staged outside the sandboxed checkout — see _stage-exe.mjs

let pass = 0, fail = 0;
const ok = (c, l, e) => {
  if (c) { pass++; console.log('  ✓ ' + l); }
  else { fail++; console.log('  ✗ ' + l + (e ? '  → ' + e : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXE)) {
  console.log('dist/native/mdlight.exe 不存在 — 先运行 node tools/build-native.mjs');
  process.exit(0);
}

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) { console.log('Edge 未找到 — 跳过'); process.exit(0); }

// ---------------------------------------------------------------------------
// fixture: one document exercising every rendering path the host must support
const dir = mkdtempSync(join(tmpdir(), 'mdl-native-'));
const docPath = join(dir, 'native.md');
const outHtml = join(dir, 'native.html');
const PORT = 20170, CDP = 19260;

const FIXTURE = [
  '# 原生宿主测试',
  '',
  '普通段落，含 **粗体** 与 `行内代码`。',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '$$ E = mc^2 $$',
  '',
  '```mermaid',
  'graph TD',
  '  A[开始] --> B[结束]',
  '```',
  '',
].join('\n');
writeFileSync(docPath, FIXTURE);

// a 1x1 PNG so the export's image inlining has something to do
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
writeFileSync(join(dir, 'dot.png'), PNG);

const server = spawn(EXE, [docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true });
await sleep(2500);

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(dir, 'profile'), '--remote-debugging-port=' + CDP, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
await sleep(2500);

// ---- minimal CDP client ----------------------------------------------------
async function cdpTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('CDP endpoint never appeared');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  return {
    ready,
    send(method, params) {
      const mid = ++id;
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    },
    on(fn) { listeners.push(fn); },
    close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
}

const BASE = 'http://127.0.0.1:' + PORT;
let client;
const exceptions = [];

try {
  // ---- [0] plain HTTP: the embedded pack is complete --------------------
  console.log('\n[0] 内嵌资源包');
  const pageRes = await fetch(BASE + '/');
  const pageHtml = await pageRes.text();
  ok(pageRes.status === 200, '页面 200');
  ok(/clientRender: true/.test(pageHtml), '页面声明 clientRender: true');
  ok(/src="\/assets\/renderer.js"/.test(pageHtml), '页面引用 renderer.js');

  for (const [p, expectMin] of [
    ['/assets/renderer.js', 100000],
    ['/assets/app.js', 5000],
    ['/assets/app.css', 3000],
    ['/assets/katex.css', 5000],
    ['/assets/hljs.css', 500],
    ['/assets/fonts/KaTeX_Main-Regular.woff2', 1000],
  ]) {
    const r = await fetch(BASE + p);
    const len = Number(r.headers.get('content-length') || 0);
    ok(r.status === 200 && len >= expectMin,
      '内嵌资源 ' + p + ' (' + len + 'B)', 'status ' + r.status);
  }
  const mm = await fetch(BASE + '/assets/mermaid/kinds.json');
  ok(mm.status === 200, 'mermaid kinds.json 可读');
  const kinds = await mm.json();
  ok(Object.keys(kinds.kinds || {}).length >= 37, 'mermaid 37 种图表已打包',
    Object.keys(kinds.kinds || {}).length + ' 种');
  const traversal = await fetch(BASE + '/assets/mermaid/..%2F..%2Fpackage.json');
  ok(traversal.status === 400 || traversal.status === 404, '目录穿越被拒绝',
    'status ' + traversal.status);

  // ---- [1] client-side rendering in a real browser ---------------------
  const wsUrl = await cdpTarget();
  client = makeClient(wsUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  client.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.text + ' ' +
        ((msg.params.exceptionDetails.exception || {}).description || ''));
    }
  });

  const evaluate = async (expr) => {
    const r = await client.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  };

  console.log('\n[1] 客户端渲染（真实浏览器）');
  await client.send('Page.navigate', { url: BASE + '/' });
  await sleep(6000);

  ok((await evaluate("document.querySelectorAll('#mdl-content h1').length")) === 1,
    '标题已渲染');
  ok(/原生宿主测试/.test(await evaluate("(document.querySelector('#mdl-content h1')||{textContent:''}).textContent")),
    '标题文字正确');
  ok((await evaluate("document.querySelectorAll('#mdl-content table tbody tr').length")) === 1,
    '表格已渲染');
  ok((await evaluate("document.querySelectorAll('#mdl-content .hljs-keyword').length")) >= 1,
    '★ 代码高亮生效（不是裸 <code>）');
  const eqs = await evaluate("document.querySelectorAll('#mdl-content x-equation').length");
  ok(eqs >= 1, '★ 公式已渲染（KaTeX 在浏览器端跑通）', 'got ' + eqs);
  ok((await evaluate("document.querySelectorAll('#mdl-content .katex').length")) >= 1,
    'KaTeX 输出真实存在');
  const svgs = await evaluate("document.querySelectorAll('#mdl-content x-mermaid svg').length");
  ok(svgs === 1, '★ mermaid 图表渲染成 SVG', 'got ' + svgs);
  ok((await evaluate("document.querySelectorAll('#mdl-toc a').length")) >= 1,
    '目录已从渲染后的 DOM 生成');
  const stat = await evaluate("document.getElementById('mdl-stat').textContent");
  ok(/公式/.test(stat || '') && /图表/.test(stat || ''), '状态栏统计正确', JSON.stringify(stat));
  ok(/native\.md/.test(await evaluate("document.getElementById('mdl-file').textContent")),
    '顶栏文件名正确');
  ok(exceptions.length === 0, '★ 页面无未捕获异常',
    exceptions.slice(0, 2).join(' | '));

  // ---- [2] built-in source editor contract ----------------------------
  console.log('\n[2] 内置编辑器接口');
  const src = await (await fetch(BASE + '/api/source')).json();
  ok(src.ok && typeof src.sha === 'string' && src.sha.length === 64,
    'GET /api/source 返回 64 位 sha');
  const saved = await (await fetch(BASE + '/api/save', {
    method: 'POST',
    body: JSON.stringify({ source: FIXTURE + '追加一行。\n', base: src.sha }),
  })).json();
  ok(saved.ok && saved.sha !== src.sha, 'POST /api/save 成功且返回新 sha');
  ok(readFileSync(docPath, 'utf8').includes('追加一行'),
    '磁盘上的文件确实被写入');

  const stale = await fetch(BASE + '/api/save', {
    method: 'POST',
    body: JSON.stringify({ source: 'clobbered', base: src.sha }),
  });
  ok(stale.status === 409, '★ 陈旧 sha 返回 409（不静默覆盖）', 'status ' + stale.status);
  const forced = await (await fetch(BASE + '/api/save', {
    method: 'POST',
    body: JSON.stringify({ source: FIXTURE + '强制覆盖。\n', base: src.sha, force: true }),
  })).json();
  ok(forced.ok, 'force: true 可以覆盖');
  ok(readFileSync(docPath, 'utf8').includes('强制覆盖'), '强制覆盖已落盘');

  // ---- [3] live reload over SSE ---------------------------------------
  console.log('\n[3] 热重载');
  await sleep(1200);  // let the save above settle
  writeFileSync(docPath, FIXTURE + '热重载标记文字。\n');
  await sleep(2500);
  const reloaded = await evaluate("document.getElementById('mdl-content').textContent");
  ok(/热重载标记文字/.test(reloaded || ''), '★ 文件变化后页面自动重载',
    JSON.stringify((reloaded || '').slice(-40)));
  ok((await evaluate("document.querySelectorAll('#mdl-content h1').length")) === 1,
    '重载后结构仍然正确');

  // ---- [4] export opens with no server at all -------------------------
  console.log('\n[4] 原生导出');
  writeFileSync(docPath, FIXTURE + '![点](./dot.png)\n');
  const exp = await (await fetch(BASE + '/api/export')).json();
  ok(exp.ok, 'POST /api/export 成功', exp.error || '');
  ok(existsSync(outHtml), '导出文件已生成', outHtml);
  const html = readFileSync(outHtml, 'utf8');
  ok(statSync(outHtml).size > 400 * 1024, '导出体积合理 (' +
    (statSync(outHtml).size / 1024).toFixed(0) + ' KB)');
  ok(/window\.__MDL_SRC__/.test(html), '★ 导出件内嵌 markdown 源码');
  ok(/MDLRenderer/.test(html), '★ 导出件内嵌浏览器渲染器');
  ok(/data-static/.test(html), '导出件标记为静态');
  ok(!/<script src="\/assets\//.test(html), '★ 无外部 script 引用');
  ok(!/<link rel="stylesheet" href="\/assets\//.test(html), '★ 无外部 stylesheet 引用');
  ok(/data:image\/png;base64,/.test(html), '★ 图片已内联为 data URI');
  ok(/data:font\/woff2;base64,/.test(html), '★ KaTeX 字体已内联');

  // the exported file must actually render from file://
  await client.send('Page.navigate', { url: 'file:///' + outHtml.replace(/\\/g, '/') });
  await sleep(6000);
  const fEq = await evaluate("document.querySelectorAll('x-equation').length");
  const fSvg = await evaluate("document.querySelectorAll('x-mermaid svg').length");
  const fH1 = await evaluate("(document.querySelector('h1')||{textContent:''}).textContent");
  ok(/原生宿主测试/.test(fH1 || ''), '★ 导出件从 file:// 打开能渲染（无需服务）');
  ok(fEq >= 1, '导出件公式正常', 'got ' + fEq);
  ok(fSvg === 0, '导出件不含 mermaid 引擎（图表显示源码）', 'got ' + fSvg);
  ok(exceptions.length === 0, '导出件无未捕获异常',
    exceptions.slice(0, 2).join(' | '));

  // ---- [5] Ctrl+O route exists in headless mode -------------------------
  // The real dialog needs the window (verified separately); --no-window must
  // still answer, so the page falls back to its file input instead of hanging.
  console.log('\n[5] Ctrl+O 路由');
  const pk = await (await fetch(BASE + '/api/pick-file', { method: 'POST' })).json();
  ok(pk.ok === false && pk.error === 'no-window',
    '★ 无窗口模式 /api/pick-file 明确回 no-window（页面据此走文件输入兜底）', JSON.stringify(pk));
} catch (e) {
  fail++;
  console.log('  ✗ 测试异常: ' + (e && e.stack || e));
} finally {
  try { client && client.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  try { server.kill(); } catch (e) { /* ignore */ }
  await sleep(600);
  try { execFileSync('taskkill', ['/F', '/IM', 'mdlight.exe'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
