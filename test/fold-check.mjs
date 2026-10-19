// verifies in-body heading fold: clicking h1-h3 collapses the
// content between it and the next heading of the same-or-higher level.
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
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!EDGE) { console.log('Edge 未找到'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'mdl-fold-'));
const docPath = join(dir, 'fold.md');
writeFileSync(docPath, [
  '# 一', '', '内容一', '', '## 二', '', '内容二', '', '### 三', '', '内容三', '', '# 四', '', '内容四',
].join('\n'));
const PORT = 20250, CDP = 19267;

const server = spawn(EXE, [docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true });
await sleep(2500);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + join(dir, 'prof'), '--remote-debugging-port=' + CDP, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
await sleep(2500);

async function cdpTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json();
      const p = l.find((t) => t.type === 'page');
      if (p && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  throw new Error('CDP never appeared');
}
function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
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
    close() { try { ws.close(); } catch (e) {} },
  };
}

let client;
try {
  const BASE = 'http://127.0.0.1:' + PORT;
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

  console.log('\n[0] 折叠前结构');
  const h1count = await ev("document.querySelectorAll('#mdl-content h1').length");
  const visibleBefore = await ev("Array.from(document.querySelectorAll('#mdl-content p')).filter(p=>p.offsetParent!==null).length");
  ok(h1count === 2, '2 个 h1', 'got ' + h1count);
  ok(visibleBefore === 4, '折叠前 4 个段落都可见', 'got ' + visibleBefore);

  console.log('\n[1] 点击第一个 h1 → 折叠到第二个 h1 之前的所有内容');
  console.log('  [debug] h1 outerHTML: ' + await ev("document.querySelectorAll('#mdl-content h1')[0].outerHTML"));
  console.log('  [debug] h1 nextEl: ' + await ev("document.querySelectorAll('#mdl-content h1')[0].nextElementSibling.outerHTML"));
  await ev("(function(){var h=document.querySelectorAll('#mdl-content h1')[0]; h.click(); return h.classList.contains('mdl-folded');})()");
  const foldedCls = await ev("document.querySelectorAll('#mdl-content h1')[0].classList.contains('mdl-folded')");
  const visibleAfter = await ev("Array.from(document.querySelectorAll('#mdl-content p')).filter(p=>p.offsetParent!==null).length");
  ok(foldedCls, 'h1 标记为 mdl-folded');
  ok(visibleAfter === 1, '折叠后只剩第 4 段的段落可见 (' + visibleAfter + ')', 'got ' + visibleAfter);

  console.log('\n[2] 再点一次 → 展开');
  await ev("(function(){var h=document.querySelectorAll('#mdl-content h1')[0]; h.click(); return !h.classList.contains('mdl-folded');})()");
  const visibleRe = await ev("Array.from(document.querySelectorAll('#mdl-content p')).filter(p=>p.offsetParent!==null).length");
  ok(visibleRe === 4, '再点恢复 4 个段落可见', 'got ' + visibleRe);

  console.log('\n[3] 折叠 h2 时其下的 h3（子标题）及其内容一并隐藏');
  await ev("(function(){var h=document.querySelectorAll('#mdl-content h2')[0]; h.click(); return h.classList.contains('mdl-folded');})()");
  const h3visible = await ev("document.querySelectorAll('#mdl-content h3')[0].offsetParent !== null");
  ok(!h3visible, '折叠 h2 后其下的 h3 标题也隐藏（属于 h2 内容）', 'h3 仍可见');
  await ev("(function(){var h=document.querySelectorAll('#mdl-content h2')[0]; h.click(); return !h.classList.contains('mdl-folded');})()");
  const h3back = await ev("document.querySelectorAll('#mdl-content h3')[0].offsetParent !== null");
  ok(h3back, '再点 h2 展开后 h3 恢复可见');
} catch (e) {
  fail++;
  console.log('  ✗ 测试异常: ' + (e && e.stack || e));
} finally {
  try { client && client.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server.kill(); } catch (e) {}
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\n' + pass + ' ✓ checks passed, ' + fail + ' failures');
process.exit(fail ? 1 : 0);
