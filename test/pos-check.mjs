// verifies cross-session read-position memory:
//   scroll → saved ratio in localStorage
//   reload → restored to that ratio
// Drives headless Edge over CDP (native WebSocket, no deps).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) { console.log('Edge 未找到 — 跳过'); process.exit(0); }

const fakeApp = mkdtempSync(join(tmpdir(), 'mdl-pos-'));
// tall document so there is plenty of scroll room
const dir = mkdtempSync(join(tmpdir(), 'mdl-pos-doc-'));
const docPath = join(dir, 'pos.md');
const parts = ['# 位置记忆测试'];
for (let i = 0; i < 200; i++) parts.push('## 段落 ' + i + '\n\n' + '内容 '.repeat(40));
writeFileSync(docPath, parts.join('\n'));
const PORT = 20240, CDP = 19266;

const server = spawn(EXE, [docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, MDLIGHT_CONFIG_DIR: fakeApp } });
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
    } catch (e) { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('CDP endpoint never appeared');
}
function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
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
  const BASE = 'http://127.0.0.1:' + PORT;
  console.log('\n[0] 首次打开：滚动并保存位置');
  client = makeClient(await cdpTarget());
  await client.ready;
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: BASE + '/' });
  await sleep(4000);
  const ev = async (expr) => {
    const r = await client.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result && r.result.value;
  };
  // scroll to ~40% down, then wait for the debounced save
  await ev('window.scrollTo(0, document.body.scrollHeight * 0.4); true');
  await sleep(600); // > 300ms debounce
  const ratio = await ev("(function(){var h=document.body.scrollHeight-window.innerHeight;return +(window.scrollY/h).toFixed(2);})()");
  const saved = await ev("localStorage.getItem('mdl-pos-' + (window.__MDL__ ? window.__MDL__.filepath : location.pathname))");
  ok(ratio > 0.3 && ratio < 0.5, '滚动到约 40% (' + ratio + ')', 'got ' + ratio);
  ok(!!saved, 'localStorage 已保存位置', saved);

  console.log('\n[1] 重新打开：位置恢复');
  await client.send('Page.navigate', { url: BASE + '/' });
  await sleep(4500);
  const restored = await ev("(function(){var h=document.body.scrollHeight-window.innerHeight;return +(window.scrollY/h).toFixed(2);})()");
  ok(Math.abs(restored - ratio) < 0.05,
    '重载后恢复到上次位置 (' + restored + ' vs ' + ratio + ')', 'got ' + restored);
} catch (e) {
  fail++;
  console.log('  ✗ 测试异常: ' + (e && e.stack || e));
} finally {
  try { client && client.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  try { server.kill(); } catch (e) { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  try { rmSync(fakeApp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
console.log('\n' + pass + ' ✓ checks passed, ' + fail + ' failures');
process.exit(fail ? 1 : 0);
