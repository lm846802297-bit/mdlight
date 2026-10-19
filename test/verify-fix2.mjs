// verify-fix2.mjs — end-to-end check of the second-round fixes:
//   BUG11: exported (static) file hides the ✍ button (v0.7.1 regression)
//   BUG20: SSE reload does not clobber an in-progress WYSIWYG edit
// Drives headless Edge over CDP; native WebSocket, no dependencies.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const APP = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  → ' + (extra || '')));
  if (!cond) fails++;
}

async function getTarget(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP target');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, open };
}

async function evaluate(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result && r.result.result.value;
}

const PORT = 20210;
const CDP = 19330;

// --- export a static file to test BUG11 ---
writeFileSync('.fix2.md', '# 标题\n\n正文 **加粗**\n\n$ x^2 $\n');
const exportProc = spawn('node', ['mdlight.mjs', '.fix2.md', '--export', '.fix2.html', '--no-window'],
  { stdio: 'ignore' });
await sleep(2500);

console.log('[BUG11] 导出件隐藏 ✍ 按钮');
{
  const html = readFileSync('.fix2.html', 'utf8');
  ok('导出件不含 wysiwyg.js 引用', !html.includes('/assets/wysiwyg.js'), '仍引用 wysiwyg.js');
  const edge = spawn(APP, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=/tmp/fx2-static', `--remote-debugging-port=${CDP}`, 'file:///' +
    process.cwd().replace(/\\/g, '/') + '/.fix2.html'], { stdio: 'ignore' });
  const t = await getTarget(CDP);
  const c = connect(t.webSocketDebuggerUrl);
  await c.open;
  await sleep(2500);
  await c.send('Runtime.enable', {});
  const wysHidden = await evaluate(c, '!!document.getElementById("mdl-btn-wysiwyg") && document.getElementById("mdl-btn-wysiwyg").hidden');
  const editHidden = await evaluate(c, '!!document.getElementById("mdl-btn-edit") && document.getElementById("mdl-btn-edit").hidden');
  ok('✍ 按钮已隐藏', wysHidden === true, 'hidden=' + wysHidden);
  ok('F2 按钮已隐藏', editHidden === true, 'hidden=' + editHidden);
  // and the page still renders
  const h1 = await evaluate(c, '(document.querySelector("h1")||{}).textContent');
  ok('导出件仍正常渲染标题', h1 === '标题', 'h1=' + h1);
  edge.kill();
  await sleep(1000);
}

console.log('[BUG20] SSE 不覆盖 WYSIWYG 编辑态');
{
  const srv = spawn('node', ['mdlight.mjs', '.fix2.md', '--port', String(PORT), '--no-window'],
    { stdio: 'ignore' });
  const edge = spawn(APP, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=/tmp/fx2-live', `--remote-debugging-port=${CDP + 1}`, `http://127.0.0.1:${PORT}/`],
    { stdio: 'ignore' });
  await sleep(4000);
  const t = await getTarget(CDP + 1);
  const c = connect(t.webSocketDebuggerUrl);
  await c.open;
  await sleep(2000);
  await c.send('Runtime.enable', {});
  // enter WYSIWYG
  await evaluate(c, 'window.MDLWysiwyg && window.MDLWysiwyg.enter()');
  await sleep(500);
  const active = await evaluate(c, 'window.MDLWysiwyg && window.MDLWysiwyg.isActive()');
  ok('已进入 WYSIWYG 编辑态', active === true, 'active=' + active);
  // type a marker into the editable paragraph
  await evaluate(c, '(function(){var p=document.querySelector(".mdl-content p"); if(!p)return "no p"; var t=p.textContent; p.textContent="【编辑中】"+t; return "ok";})()');
  await sleep(300);
  // now trigger SSE reload by touching the file
  writeFileSync('.fix2.md', '# 标题\n\n被外部修改了\n\n$ x^2 $\n');
  await sleep(3500);
  const stillThere = await evaluate(c, 'document.querySelector(".mdl-content") && document.querySelector(".mdl-content").textContent.indexOf("【编辑中】") >= 0');
  ok('SSE reload 未覆盖正在编辑的内容', stillThere === true, 'found=' + stillThere);
  const stillActive = await evaluate(c, 'window.MDLWysiwyg && window.MDLWysiwyg.isActive()');
  ok('仍处于编辑态', stillActive === true, 'active=' + stillActive);
  await evaluate(c, 'window.MDLWysiwyg && window.MDLWysiwyg.exit(false)');
  srv.kill(); edge.kill();
  await sleep(1000);
}

// cleanup
try { require && require('node:fs').unlinkSync('.fix2.md'); } catch {}
try { require && require('node:fs').unlinkSync('.fix2.html'); } catch {}
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);