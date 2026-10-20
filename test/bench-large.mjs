// test/bench-large.mjs
// 大文档打开流畅度实测（真实 native exe + headless Edge）。
// 度量：
//   1. 渲染完成耗时（Worker 离线程渲染）
//   2. 渲染期间主线程是否卡顿（rAF 帧间隔，>20ms 算掉帧）
//   3. 滚动流畅度（整页滚动时掉帧数）
//   4. 是否触发了虚拟滚动（>200 块懒渲染）
// 用法：
//   node test/bench-large.mjs            # 自动生成大文档并测 exe
//   node test/bench-large.mjs file.md    # 测指定文档
// 没有 Edge 时静默跳过（不破坏 CI）。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(root, 'dist', 'native', 'mdlight.exe');
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) { console.log('Edge 未找到 — 跳过（不会破坏 CI）'); process.exit(0); }

const port = 20260, cdpPort = 20261;
const prof = join(root, '.edge-prof-' + Date.now());
const DOC = process.argv[2] || join(root, 'bench-large.md');

function genDoc() {
  // 足够大：约 40 章 × ~90 块 = ~3600 块（>200 触发虚拟滚动），每章若干公式/表格/代码/列表
  const parts = [];
  for (let c = 0; c < 40; c++) {
    parts.push(`# 第 ${c} 章 大型文档性能测试`);
    parts.push(`> 引用块：这是第 ${c} 章的引言。$e^{i\\pi}+1=0$ 是一条优雅的公式。`);
    for (let i = 0; i < 20; i++) {
      parts.push(`第 ${c}-${i} 段正文：$\\int_0^1 x\\,dx = \\frac{1}{2}$ 与 $\\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}$` +
        `，以及无需数学的普通长文本，用来模拟真实阅读文档的连续文字流，夹杂 **加粗** 和 *斜体* 与 \`行内代码\`。`);
    }
    for (let i = 0; i < 2; i++) {
      parts.push(`$$\\nabla\\cdot\\vec{E} = \\frac{\\rho}{\\varepsilon_0} \\qquad \\nabla\\times\\vec{B} - \\frac{1}{c^2}\\frac{\\partial\\vec{E}}{\\partial t} = \\mu_0\\vec{J}$$`);
    }
    parts.push('| 列A | 列B | 列C |\n| --- | --- | --- |\n| ' + c + 'a | ' + c + 'b | ' + c + 'c |\n| x | y | z |');
    parts.push('- 列表项一\n- 列表项二\n- 列表项三');
    parts.push('```js\nfunction hello(name) { return "hi " + name; }\n```');
  }
  const md = parts.join('\n\n');
  writeFileSync(DOC, md);
  return { bytes: Buffer.byteLength(md) };
}

async function httpGetJson(u) { return fetch(u).then((r) => r.json()); }
async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try { return (await httpGetJson(`http://127.0.0.1:${cdpPort}/json`)).find((t) => t.type === 'page'); }
    catch (e) { await sleep(300); }
  }
  throw new Error('no CDP target');
}
async function makeClient(wsUrl) {
  let nextId = 1; const pending = new Map(); const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  return { send(m, p) { return new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p || {} })); }); }, close() { try { ws.close(); } catch (e) {} } };
}
async function evalJs(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

rmSync(prof, { recursive: true, force: true }); mkdirSync(prof, { recursive: true });
const edgeProc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { detached: true, stdio: 'ignore' });
edgeProc.unref();
const sizeInfo = process.argv[2]
  ? { bytes: existsSync(DOC) ? (await import('node:fs')).statSync(DOC).size : 0 }
  : genDoc();

const hostProc = spawn(EXE, [DOC, '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
hostProc.unref();
await sleep(1500);
const target = await cdpTarget();
const client = await makeClient(target.webSocketDebuggerUrl);
await client.send('Page.enable');
await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

// 渲染计时 + 主线程帧率 + 虚拟滚动检测
const render = await evalJs(client, `
(async () => {
  const t0 = performance.now();
  const deltas = [];
  let rafId;
  function loop(t) { deltas.push(t); rafId = requestAnimationFrame(loop); }
  rafId = requestAnimationFrame(loop);
  window.scrollTo(0, 1500); // 边渲染边滚，证明 UI 线程不卡
  let finished = false;
  while (performance.now() - t0 < 120000) {
    const main = document.getElementById('mdl-content');
    const pre = main && main.querySelector('pre.mdl-source-preview');
    if (!pre && main && main.querySelectorAll('x-equation').length > 0) { finished = true; break; }
    await new Promise(r => setTimeout(r, 60));
  }
  cancelAnimationFrame(rafId);
  let over20 = 0, worst = 0;
  for (let i = 1; i < deltas.length; i++) {
    const d = deltas[i] - deltas[i-1];
    if (d > 20) over20++;
    if (d > worst) worst = d;
  }
  const main = document.getElementById('mdl-content');
  return {
    renderMs: Math.round(performance.now() - t0),
    frames: deltas.length,
    framesOver20ms: over20,
    worstFrameMs: Math.round(worst),
    eq: main ? main.querySelectorAll('x-equation').length : 0,
    vblock: main ? main.querySelectorAll('.mdl-vblock').length : 0,
    lazyloading: main ? main.querySelectorAll('.mdl-vblock[data-lazy]').length : 0,
  };
})()
`);
console.log(`\n===== 大文档打开实测 (${(sizeInfo.bytes / 1024).toFixed(0)} KB) =====`);
console.log(JSON.stringify(render, null, 2));

// 滚动流畅度
const jank = await evalJs(client, `
(async () => {
  await new Promise(r => setTimeout(r, 300));
  const frameTimes = [];
  let rafId;
  function loop(t) { frameTimes.push(t); rafId = requestAnimationFrame(loop); }
  rafId = requestAnimationFrame(loop);
  const step = 6000;
  const max = document.body.scrollHeight;
  const t0 = performance.now();
  let y = 0;
  while (y < max) { y += step; window.scrollTo(0, y); await new Promise(r => setTimeout(r, 8)); }
  const elapsed = performance.now() - t0;
  cancelAnimationFrame(rafId);
  let drops = 0, worst = 0;
  for (let i = 1; i < frameTimes.length; i++) {
    const d = frameTimes[i] - frameTimes[i-1];
    if (d > 20) drops++;
    if (d > worst) worst = d;
  }
  return { scrollMs: Math.round(elapsed), frames: frameTimes.length, droppedFrames: drops, worstFrameMs: Math.round(worst), scrollHeight: max };
})()
`);
console.log('\n===== 滚动流畅度 =====');
console.log(JSON.stringify(jank, null, 2));

// 阈值判定
let pass = true;
const notes = [];
if (render.renderMs > 15000) { pass = false; notes.push(`渲染过慢 ${render.renderMs}ms>15s`); }
if (render.framesOver20ms > render.frames * 0.3 && render.frames > 5) { pass = false; notes.push(`渲染期主线程掉帧过多 ${render.framesOver20ms}/${render.frames}`); }
if (jank.frames > 5 && jank.droppedFrames > jank.frames * 0.4) { pass = false; notes.push(`滚动掉帧过多 ${jank.droppedFrames}/${jank.frames}`); }
if (render.vblock === 0) notes.push('提示：未触发虚拟滚动（虚滚动需 >200 块）');
console.log('\n=== 结论: ' + (pass ? '✅ 流畅（未发现明显卡顿）' : '❌ 存在卡顿需要优化') + (notes.length ? ' — ' + notes.join('; ') : '') + ' ===');

client.close();
try { edgeProc.kill(); } catch (e) {}
try { hostProc.kill(); } catch (e) {}
// Edge may still hold the profile dir briefly; best-effort clean with retry.
for (let i = 0; i < 5; i++) {
  try { rmSync(prof, { recursive: true, force: true }); break; }
  catch (e) { await sleep(400); }
}
try { if (!process.argv[2]) rmSync(DOC, { force: true }); } catch (e) {}
process.exit(pass ? 0 : 1);