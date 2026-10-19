// CDP browser test: PROVE the on-demand claim in a real browser.
//
// The Node test proves the plumbing; this proves the actual behavior:
//   * a doc with mermaid fetches the entry + ONLY the chunks for the kinds it uses
//   * NOT all 106 chunks
//   * a doc with no mermaid fetches ZERO /assets/mermaid/ requests
//   * the diagrams actually render to SVG
//
// Drives headless Edge over the DevTools protocol (native WebSocket, no deps).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) { console.log('Edge not found — skipping browser test'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'mdl-cdp-'));
const profile = join(dir, 'profile');
const withMm = join(dir, 'with.md');
const noMm = join(dir, 'without.md');
writeFileSync(withMm, [
  '# 图表文档', '',
  '```mermaid', 'graph TD', '  A[开始] --> B[结束]', '```', '',
  '```mermaid', 'sequenceDiagram', '  Alice->>Bob: 你好', '```', '',
  '```mermaid', 'graph TD', '  A[ --> B', '```', '',
  '普通文字。',
].join('\n'));
writeFileSync(noMm, '# 无图表\n\n```js\nconst a = 1;\n```\n');

const PORT = 18501, PORT_B = 18502, CDP = 19222;
// MDLIGHT_LAUNCHER runs this suite against the packaged single-file exe too:
//   MDLIGHT_LAUNCHER=dist/mdlight.exe node test/mermaid-browser.mjs
const LAUNCHER = process.env.MDLIGHT_LAUNCHER;
const launch = (doc, port) => LAUNCHER
  ? spawn(join(root, LAUNCHER), [doc, '--port', String(port), '--no-window'],
      { cwd: root, stdio: 'ignore', windowsHide: true })
  : spawn(process.execPath, [join(root, 'mdlight.mjs'), doc, '--port', String(port), '--no-window'],
      { cwd: root, stdio: 'ignore', windowsHide: true });
const srv = launch(withMm, PORT);
const srvB = launch(noMm, PORT_B);
// the exe unpacks its embedded launcher to %TEMP% on start — allow extra time
await sleep(LAUNCHER ? 4000 : 1500);

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + CDP, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
await sleep(2500);

// ---- minimal CDP client ----------------------------------------------------
async function cdpTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json();
      const page = list.find(t => t.type === 'page');
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
    ws.addEventListener('error', (e) => rej(new Error('ws error')));
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
    close() { try { ws.close(); } catch (e) {} },
  };
}

let client;
try {
  const wsUrl = await cdpTarget();
  client = makeClient(wsUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Network.enable');
  await client.send('Runtime.enable');

  // collect mermaid asset requests
  let mmRequests = [];
  client.on((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const u = msg.params.request.url;
      if (u.includes('/assets/mermaid/')) mmRequests.push(u.split('/assets/mermaid/')[1]);
    }
  });

  async function visit(url, waitMs) {
    mmRequests = [];
    await client.send('Page.navigate', { url });
    await sleep(waitMs);
  }
  async function evaluate(expr) {
    const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  }

  console.log('\n[1] 含 2 种图表的文档：真实浏览器');
  await visit('http://127.0.0.1:' + PORT + '/', 6000);

  const entryHit = mmRequests.includes('mermaid-entry.js');
  ok(entryHit, '页面拉取了 mermaid-entry.js', mmRequests.length ? '' : '(no mermaid requests at all)');

  const kindsHit = mmRequests.filter(f => f !== 'mermaid-entry.js' && f !== 'kinds.json');
  const totalChunks = 106;
  ok(kindsHit.length > 0, '拉取了图表 chunk', kindsHit.length + ' 个');
  ok(kindsHit.length < totalChunks, '★ 未拉取全部 ' + totalChunks + ' 个 chunk（按需生效）', '实际 ' + kindsHit.length + ' 个');
  ok(kindsHit.some(f => /flowDiagram/.test(f)), '拉取了 flowchart chunk');
  ok(kindsHit.some(f => /sequenceDiagram/.test(f)), '拉取了 sequence chunk');
  ok(!kindsHit.some(f => /pieDiagram/.test(f)), '★ 未拉取未使用的 pie chunk');
  ok(!kindsHit.some(f => /c4Diagram/.test(f)), '★ 未拉取未使用的 c4 chunk');
  ok(!kindsHit.some(f => /architectureDiagram/.test(f)), '★ 未拉取未使用的 architecture chunk');
  console.log('    实际拉取: ' + mmRequests.length + ' 个文件');

  const svgCount = await evaluate("document.querySelectorAll('x-mermaid svg').length");
  ok(svgCount === 2, '★ 2 个图表渲染成 SVG', 'got ' + svgCount);
  const okStates = await evaluate("document.querySelectorAll('x-mermaid[data-mm-state=\"ok\"]').length");
  ok(okStates === 2, '2 个标记为渲染成功', 'got ' + okStates);
  const hasSvgText = await evaluate("(document.querySelector('x-mermaid svg')||{outerHTML:''}).outerHTML.includes('<svg')");
  ok(hasSvgText, 'SVG 内容真实存在');

  // The broken diagram must show OUR error card with the parse message, and
  // mermaid must NOT also append its own "Syntax error" bomb SVG to the page
  // (config: suppressErrorRendering — otherwise the page ends with a stray bomb).
  const errStates = await evaluate("document.querySelectorAll('x-mermaid[data-mm-state=\"error\"]').length");
  ok(errStates === 1, '★ 错误图表显示错误卡片', 'got ' + errStates);
  const errMsg = await evaluate("(document.querySelector('.mdl-mermaid-error-msg')||{textContent:''}).textContent");
  ok(/Parse error/i.test(errMsg || ''), '错误卡片含具体解析报错', JSON.stringify((errMsg || '').slice(0, 60)));
  const strayBomb = await evaluate("Array.from(document.querySelectorAll('svg')).filter(s=>!s.closest('x-mermaid')).length");
  ok(strayBomb === 0, '★ 没有 mermaid 追加的游离报错 SVG（bomb）', 'got ' + strayBomb);

  const statText = await evaluate("document.getElementById('mdl-stat').textContent");
  ok(/3 图表/.test(statText || ''), '状态栏显示图表数', JSON.stringify(statText));

  console.log('\n[2] 无图表的文档：零 mermaid 请求');
  await visit('http://127.0.0.1:' + PORT_B + '/', 3000);
  ok(mmRequests.length === 0, '★ 完全不请求 /assets/mermaid/*', JSON.stringify(mmRequests));
  const bSvg = await evaluate("document.querySelectorAll('x-mermaid').length");
  ok(bSvg === 0, '页面没有图表占位', 'got ' + bSvg);

  console.log('\n[3] 主题切换后重渲染');
  await visit('http://127.0.0.1:' + PORT + '/', 5000);
  const beforeTheme = await evaluate("document.body.dataset.theme");
  await evaluate("document.getElementById('mdl-btn-theme').click()");
  await sleep(2500);
  const afterTheme = await evaluate("document.body.dataset.theme");
  ok(beforeTheme !== afterTheme, '主题已切换', beforeTheme + ' → ' + afterTheme);
  const reSvg = await evaluate("document.querySelectorAll('x-mermaid svg').length");
  ok(reSvg === 2, "★ 切换主题后图表仍渲染（错误图表仍是卡片）", "got " + reSvg);
} catch (e) {
  fail++;
  console.log('  ✗ 浏览器测试异常: ' + (e && e.message));
} finally {
  try { client && client.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  try { srvB.kill(); } catch (e) {}
  await sleep(600);
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
