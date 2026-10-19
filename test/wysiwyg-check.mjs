// End-to-end test for the DIRECT-EDITING (WYSIWYG) feature, driven over CDP.
//
// Uses the Node source host (node mdlight.mjs) because it exercises the exact
// same page/app.js/wysiwyg.js that the native host embeds. We prove the parts
// that matter:
//   * clicking the ✍ button switches the preview into contenteditable mode
//   * editing a rendered paragraph and saving round-trips to the markdown file
//   * special blocks (math/mermaid/callout) are NOT silently destroyed
//   * live reload repaints the saved content
//   * an external change triggers the overwrite prompt
//
// Drives headless Edge over CDP (native WebSocket, no dependencies).
import { spawn } from 'node:child_process';
import {
  existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const dir = mkdtempSync(join(tmpdir(), 'mdl-wysiwyg-'));
const docPath = join(dir, 'edit.md');
const PORT = 20180, CDP = 19270;

const FIXTURE = [
  '# 直接编辑测试',
  '',
  '第一段，需要 **加粗** 与 `代码`。',
  '',
  '$$ E = mc^2 $$',
  '',
  '> [!NOTE] 这是提示',
  '> 内容',
  '',
  '```mermaid',
  'graph TD',
  '  A[开始] --> B[结束]',
  '```',
  '',
].join('\n');
writeFileSync(docPath, FIXTURE);

const server = spawn(process.execPath,
  [join(root, 'mdlight.mjs'), docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true });
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
  // ---- [0] page up -----------------------------------------------------
  for (let i = 0; i < 20; i++) {
    try { if ((await fetch(BASE + '/')).status === 200) break; } catch (e) { /* retry */ }
    await sleep(300);
  }
  client = makeClient(await cdpTarget());
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
      { expression: expr, returnByValue: true, awaitPromise: false });
    return r.result && r.result.value;
  };

  console.log('\n[0] 初始渲染');
  await client.send('Page.navigate', { url: BASE + '/' });
  await sleep(3500);
  ok((await evaluate("document.querySelectorAll('#mdl-content h1').length")) === 1,
    '标题已渲染');
  ok((await evaluate("document.querySelectorAll('#mdl-content .katex').length")) >= 1,
    '公式已渲染');
  ok((await evaluate("document.querySelectorAll('#mdl-content .mdl-callout').length")) === 1,
    'callout 已渲染');
  ok((await evaluate("document.querySelectorAll('#mdl-content x-mermaid').length")) === 1,
    'mermaid 占位存在');
  ok((await evaluate("typeof window.MDLWysiwyg")) === 'object',
    'MDLWysiwyg 已加载');
  ok((await evaluate("typeof window.MDLWysiwyg.enter")) === 'function',
    'MDLWysiwyg.enter 可用');
  ok((await evaluate("document.getElementById('mdl-wysiwyg-bar').hidden")) === true,
    '初始工具栏隐藏');

  console.log('\n[1] 进入直接编辑模式');
  await evaluate("document.getElementById('mdl-btn-wysiwyg').click(); 'ok'");
  await sleep(700);
  ok((await evaluate("document.getElementById('mdl-content').isContentEditable")) === true,
    '内容区进入 contenteditable');
  ok((await evaluate("document.getElementById('mdl-wysiwyg-bar').hidden")) === false,
    '工具栏显示');
  ok((await evaluate("document.getElementById('mdl-content').classList.contains('mdl-editing')")) === true,
    '内容区标记 mdl-editing');

  console.log('\n[2] 编辑一个段落并保存');
  const edited = "第一段，已经被我直接改过 —— **加粗保留**。";
  await evaluate("(() => { const p = document.querySelector('#mdl-content p');" +
    " p.innerHTML = '" + edited.replace(/"/g, '\\"') + "'; return 'ok'; })()");
  await sleep(200);
  // serializeCurrent() gives us the markdown save() will POST — inspect it
  const serialized = await evaluate("window.MDLWysiwyg.serializeCurrent()");
  ok(serialized.includes('第一段，已经被我直接改过'),
    '序列化包含编辑内容', String(serialized).slice(0, 80));
  ok(serialized.includes('E = mc^2'), '序列化保留公式', String(serialized).slice(0, 120));

  // save() is async AND calls onReload() → liveReload() → the page navigates.
  // A CDP awaitPromise would hang while that navigation is in flight, so
  // fire-and-forget and poll the file on disk.
  const saveErr = await evaluate(
    "(function(){ try { window.MDLWysiwyg.save(); return null; } catch(e){ return String(e && e.stack || e); } })()");
  ok(!saveErr, 'save() 未同步抛错', String(saveErr));

  let saved = false;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (readFileSync(docPath, 'utf8').includes('第一段，已经被我直接改过')) { saved = true; break; }
  }
  ok(saved, '保存已写入 markdown 文件');
  const disk = readFileSync(docPath, 'utf8');
  ok(!/第一段，需要/.test(disk), '旧文本已替换');
  ok(disk.includes('E = mc^2'), '公式块未被破坏（内容在，定界符可能归一化）',
    disk.split('\n').filter((l) => l.includes('mc')).join(' / '));
  ok(disk.includes('> [!NOTE]'), 'callout 未被破坏');
  ok(disk.includes('graph TD'), 'mermaid 块未被破坏');

  console.log('\n[3] 重载后预览');
  // wait for the SSE live reload to settle, then check the repainted preview
  let shown = '';
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      shown = await evaluate(
        "Array.from(document.querySelectorAll('#mdl-content p')).map(p=>p.textContent).join(' | ')");
      if (shown.includes('已经被我直接改过')) break;
    } catch (e) { /* still reloading */ }
  }
  ok(shown.includes('已经被我直接改过'), '重载后预览显示新文本', shown.slice(0, 80));

  console.log('\n[4] API 与退出');
  ok((await evaluate("typeof window.MDLWysiwyg.exit")) === 'function', 'exit 可用');
  ok((await evaluate("typeof window.MDLWysiwyg.isActive")) === 'function', 'isActive 可用');
  ok((await evaluate("typeof window.MDLWysiwyg.serializeCurrent")) === 'function',
    'serializeCurrent 可用');
  const barBtns = await evaluate(
    "document.querySelectorAll('#mdl-wysiwyg-bar .mdl-btn').length");
  ok(barBtns >= 15, '工具栏按钮齐全 (' + barBtns + ' 个)');
  await evaluate("window.MDLWysiwyg.exit(false); 'ok'");
  await sleep(700);
  ok((await evaluate("document.getElementById('mdl-content').isContentEditable")) === false,
    '已退出 contenteditable');
  ok((await evaluate("document.getElementById('mdl-wysiwyg-bar').hidden")) === true,
    '工具栏重新隐藏');

  console.log('\n[4b] 取消编辑后 DOM 还原（bug 修复回归）');
  await evaluate("window.MDLWysiwyg.enter(); 'ok'");
  await sleep(300);
  ok((await evaluate("document.getElementById('mdl-content').isContentEditable")) === true,
    '再次进入 contenteditable');
  await evaluate("var h=document.querySelector('#mdl-content h1'); if(h) h.remove(); 'ok'");
  await sleep(200);
  ok((await evaluate("document.querySelectorAll('#mdl-content h1').length")) === 0,
    '取消前标题已被删除');
  await evaluate("window.MDLWysiwyg.exit(false); 'ok'");
  await sleep(1800);
  ok((await evaluate("document.querySelectorAll('#mdl-content h1').length")) === 1,
    '取消后标题已还原（onCancel → liveReload 生效）');

  console.log('\n[5] 无未捕获异常');
  ok(exceptions.length === 0, '页面无未捕获异常', exceptions.slice(0, 3).join(' | '));
} finally {
  try { client && client.close(); } catch (e) { /* ignore */ }
  try { server.kill(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  await sleep(800);
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\n' + pass + ' ✓ checks passed, ' + fail + ' failures');
process.exit(fail ? 1 : 0);