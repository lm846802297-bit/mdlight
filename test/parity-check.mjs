// Parity test: the Node build renders markdown on the SERVER, the native build
// renders it in the BROWSER. Both feed the same core/renderer.mjs, but through
// different pipelines (esbuild IIFE vs native ESM import, KaTeX on Node vs in
// WebView2). This test proves the resulting DOM is identical.
//
// Both pages are read through the same headless browser, so serialisation
// differences cannot create false results.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(root, 'dist', 'native', 'mdlight.exe');

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

const dir = mkdtempSync(join(tmpdir(), 'mdl-parity-'));
const docPath = join(dir, 'parity.md');
const NODE_PORT = 20180, EXE_PORT = 20181, CDP = 19261;

// deliberately exercises every renderer branch that could differ between the
// two pipelines: macro, CJK wrap, error card, wikilink, callout, table, fence
writeFileSync(docPath, [
  '# 渲染一致性',
  '',
  '正文含 **粗体**、`行内代码`、[链接](https://example.com) 与 [[wikilink]]。',
  '',
  '## 公式',
  '',
  '行内解 $x^2$ 与 AI 方言 \\(y^3\\)。',
  '',
  '$$ \\int_0^1 x^2 \\, dx = \\frac{1}{3} $$',
  '',
  '中文夹心 $中文$ 应自动包 \\text。',
  '',
  '$$ \\undefinedmacro $$',
  '',
  '## 代码',
  '',
  '```js',
  'const price = 1 + 2;',
  '```',
  '',
  '```',
  'plain fence $not math$',
  '```',
  '',
  '## 表格与列表',
  '',
  '| 左 | 右 |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '> [!note] Callout 标题',
  '> Callout 正文',
  '',
  '```mermaid',
  'graph TD',
  '  A[开始] --> B[结束]',
  '```',
  '',
].join('\n'));

// Isolate config for BOTH hosts: a real theme (e.g. "nord") would otherwise be
// applied client-side on the native side but ignored by the Node server-side
// render, making the comparison fail for reasons that have nothing to do with
// the renderer.
const cfgDir = join(dir, 'cfg');
mkdirSync(cfgDir, { recursive: true });
const nodeEnv = { ...process.env, MDLIGHT_CONFIG_DIR: cfgDir };

const nodeSrv = spawn(process.execPath, [join(root, 'mdlight.mjs'), docPath,
  '--port', String(NODE_PORT), '--no-window'], { cwd: root, stdio: 'ignore', windowsHide: true, env: nodeEnv });
const exeSrv = spawn(EXE, [docPath, '--port', String(EXE_PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true, env: nodeEnv });
await sleep(2500);

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(dir, 'profile'), '--remote-debugging-port=' + CDP, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
await sleep(2500);

async function cdpTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up */ }
    await sleep(300);
  }
  throw new Error('CDP endpoint never appeared');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
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
    close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
}

let client;
try {
  client = makeClient(await cdpTarget());
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const evaluate = async (expr) => {
    const r = await client.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  };

  const grab = async (port) => {
    await client.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });
    // wait for the renderer to finish (mermaid renders asynchronously)
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const ready = await evaluate(
        "!!document.querySelector('#mdl-content h1') && " +
        "document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === " +
        "document.querySelectorAll('#mdl-content x-mermaid').length");
      if (ready) break;
    }
    return {
      body: await evaluate("document.getElementById('mdl-content').innerHTML"),
      toc: await evaluate("document.getElementById('mdl-toc').innerHTML"),
      stat: await evaluate("document.getElementById('mdl-stat').textContent"),
    };
  };

  console.log('\n[1] 服务端渲染 vs 浏览器渲染');
  const a = await grab(NODE_PORT);
  const b = await grab(EXE_PORT);

  ok(!!a.body && a.body.includes('渲染一致性'), 'Node 端有渲染结果');
  ok(!!b.body && b.body.includes('渲染一致性'), '原生端有渲染结果');

  const num = (s, re) => (s.match(re) || []).length;

  ok(num(a.body, /class="katex"/g) === num(b.body, /class="katex"/g),
    'KaTeX 输出数量一致',
    num(a.body, /class="katex"/g) + ' vs ' + num(b.body, /class="katex"/g));
  ok(num(a.body, /mdl-math-error/g) === num(b.body, /mdl-math-error/g),
    '错误卡片数量一致');
  ok(num(a.body, /hljs-keyword/g) === num(b.body, /hljs-keyword/g),
    '代码高亮标记一致');
  ok(num(a.body, /<table>/g) === num(b.body, /<table>/g), '表格一致');
  ok(num(a.body, /mdl-callout/g) === num(b.body, /mdl-callout/g), 'Callout 一致');
  ok(num(a.body, /x-mermaid/g) === num(b.body, /x-mermaid/g), 'mermaid 占位一致');
  ok(num(a.body, /<svg/g) === num(b.body, /<svg/g),
    'mermaid 渲染结果数量一致', num(a.body, /<svg/g) + ' vs ' + num(b.body, /<svg/g));

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  ok(norm(a.body) === norm(b.body), '★ 两边 #mdl-content 结构完全一致',
    norm(a.body) === norm(b.body) ? '' :
      'first diff @ ' + (() => {
        const x = norm(a.body), y = norm(b.body);
        let i = 0;
        while (i < x.length && i < y.length && x[i] === y[i]) i++;
        return i + '\n    node: …' + x.slice(Math.max(0, i - 60), i + 90) +
               '\n    native: …' + y.slice(Math.max(0, i - 60), i + 90);
      })());

  ok(norm(a.toc) === norm(b.toc), '★ 两边 TOC 完全一致',
    norm(a.toc) === norm(b.toc) ? '' :
      '\n    node: ' + norm(a.toc).slice(0, 300) + '\n    native: ' + norm(b.toc).slice(0, 300));
  ok(norm(a.stat) === norm(b.stat), '状态栏统计一致',
    JSON.stringify(a.stat) + ' vs ' + JSON.stringify(b.stat));
} catch (e) {
  fail++;
  console.log('  ✗ 测试异常: ' + (e && e.stack || e));
} finally {
  try { client && client.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  try { nodeSrv.kill(); } catch (e) { /* ignore */ }
  try { exeSrv.kill(); } catch (e) { /* ignore */ }
  await sleep(600);
  try { execFileSync('taskkill', ['/F', '/IM', 'mdlight.exe'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
