// verifies that ui/app.js reads %APPDATA%\mdlight\config.json through
// /api/config and applies font / font-size / theme / code-wrap / code-lineno.
// Drives headless Edge over CDP (native WebSocket, no deps) — same harness
// shape as native-check.mjs.
import { spawn } from 'node:child_process';
import {
  existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

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

// isolated APPDATA so we never touch the real user config
const fakeApp = mkdtempSync(join(tmpdir(), 'mdl-cfg-'));
const cfgPath = join(fakeApp, 'config.json'); // MDLIGHT_CONFIG_DIR is the final dir
writeFileSync(cfgPath, JSON.stringify({
  font: 'Georgia', fontSize: 18, theme: 'sepia', codeWrap: true, codeLineno: true,
  rememberPosition: false, hardBreaks: true,
}));

const dir = mkdtempSync(join(tmpdir(), 'mdl-cfg-doc-'));
const docPath = join(dir, 'cfg.md');
writeFileSync(docPath, '# 配置测试\n\n正文段落。\n\n```js\nconst a = 1;\n```\n');
const PORT = 20230, CDP = 19265;

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
  console.log('\n[0] /api/config 读回');
  const g = await (await fetch('http://127.0.0.1:' + PORT + '/api/config')).json();
  ok(g.font === 'Georgia', 'config.font = Georgia', JSON.stringify(g));
  ok(g.fontSize === 18, 'config.fontSize = 18 (number)', JSON.stringify(g.fontSize));
  ok(g.codeLineno === true, 'config.codeLineno = true (bool)', JSON.stringify(g.codeLineno));

  console.log('\n[1] 页面应用配置');
  client = makeClient(await cdpTarget());
  await client.ready;
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(4000);

  const ev = async (expr) => {
    const r = await client.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result && r.result.value;
  };

  ok(await ev("document.documentElement.style.getPropertyValue('--mdl-font')")
    .then((v) => v && v.indexOf('Georgia') >= 0),
  '正文字体已切到 Georgia',
    await ev("document.documentElement.style.getPropertyValue('--mdl-font')"));
  ok(await ev("document.documentElement.style.getPropertyValue('--mdl-font-size')") === '18px',
    '正文字号已切到 18px',
    await ev("document.documentElement.style.getPropertyValue('--mdl-font-size')"));
  ok(await ev("document.body.dataset.theme") === 'sepia',
    '主题已切到 sepia', await ev("document.body.dataset.theme"));
  ok(await ev("document.body.classList.contains('mdl-code-wrap')"),
    '代码块自动换行生效');
  ok(await ev("document.body.classList.contains('mdl-code-lineno')"),
    '代码块行号生效');
  ok(await ev("document.body.dataset.noRemember === '1'"),
    'rememberPosition=false 已标记');

  console.log('\n[2] 正文渲染未破坏');
  ok(await ev("(document.querySelector('h1')||{}).textContent") === '配置测试',
    '标题正常');
  ok(await ev("document.querySelectorAll('pre code').length") === 1,
    '代码块正常');
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
