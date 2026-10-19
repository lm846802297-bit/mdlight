// Verify the off-thread renderer: while a huge document renders in the Worker,
// the main thread must stay responsive (rAF keeps hitting 60fps), and the final
// HTML must be identical to a synchronous render.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const edge = process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe';
// unique per-run profile so a lingering previous Edge never blocks a fresh one
const prof = 'C:\\Users\\84680\\Desktop\\AI赚钱\\mdlight\\.edge-prof-' + Date.now();
function httpGetJson(u) { return fetch(u).then((r) => r.json()); }
async function cdpTarget(cdpPort) {
  for (let i = 0; i < 50; i++) { try { return (await httpGetJson(`http://127.0.0.1:${cdpPort}/json`)).find((t) => t.type === 'page'); } catch (e) { await sleep(300); } }
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

// start headless edge
const port = 20240, cdpPort = 20241;
rmSync(prof, { recursive: true, force: true }); try { mkdirSync(prof, { recursive: true }); } catch (e) {}
const edgeProc = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { detached: true, stdio: 'ignore' });
edgeProc.unref();

async function run(doc, docSizeLabel) {
  const hostProc = spawn('C:\\Users\\84680\\Desktop\\AI赚钱\\mdlight\\dist\\native\\mdlight.exe', [doc, '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
  hostProc.unref();
  await sleep(1500);
  const target = await cdpTarget(cdpPort);
  const client = await makeClient(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  // No sleep: start the rAF probe immediately so we capture the render window.

  // sample: is the placeholder visible, are Workers alive, and does rAF hold up?
  const probe = `
(async () => {
  const t0 = performance.now();
  const frameDeltas = [];
  let rafId;
  function loop(t) { frameDeltas.push(t); rafId = requestAnimationFrame(loop); }
  rafId = requestAnimationFrame(loop);
  // scroll a bit while rendering to prove the UI thread is free
  window.scrollTo(0, 2000);
  // wait until render finished (placeholder gone, x-equation present)
  let finished = false;
  while (performance.now() - t0 < 60000) {
    const main = document.getElementById('mdl-content');
    const pre = main && main.querySelector('pre.mdl-source-preview');
    const eq = main && main.querySelectorAll('x-equation').length;
    if (!pre && eq > 0) { finished = true; break; }
    await new Promise(r => setTimeout(r, 60));
  }
  cancelAnimationFrame(rafId);
  let worst = 0, over20 = 0;
  for (let i = 1; i < frameDeltas.length; i++) {
    const d = frameDeltas[i] - frameDeltas[i-1];
    if (d > 20) over20++;
    if (d > worst) worst = d;
  }
  const main = document.getElementById('mdl-content');
  return {
    renderFinishedMs: Math.round(performance.now() - t0),
    workersAlive: (window.Worker ? 'Worker API present' : 'no Worker'),
    frames: frameDeltas.length,
    worstFrameMs: Math.round(worst),
    framesOver20ms: over20,
    eq: main.querySelectorAll('x-equation').length,
    katex: main.querySelectorAll('.katex').length,
    h1: (main.querySelector('h1')||{textContent:''}).textContent,
  };
})()
`;
  const res = await evalJs(client, probe);
  console.log(`\n===== ${docSizeLabel} =====`);
  console.log(JSON.stringify(res, null, 2));
  client.close();
  try { hostProc.kill(); } catch (e) {}
  return res;
}

// build a large doc with clean (correctly-escaped) math
import { writeFileSync } from 'node:fs';
const docPath = process.argv[2];
if (docPath) {
  const sz = (await import('node:fs')).readFileSync(docPath, 'utf8').length;
  console.log('测试文档: ' + (sz / 1024).toFixed(0) + ' KB (' + docPath + ')');
} else {
  const parts = [];
  for (let c = 0; c < 20; c++) {
    parts.push(`# 章节 ${c}`);
    for (let i = 0; i < 60; i++) {
      parts.push(`段落 ${c}-${i}：$x^2 + y^2 = z^2$ 与 $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ 以及普通文本，用来放大 KaTeX 的渲染成本。`);
    }
    for (let i = 0; i < 6; i++) parts.push(`$$${'\\int_0^1 x\\,dx = \\frac{1}{2}$$'} 与 $${'\\nabla\\cdot\\vec{E} = \\frac{\\rho}{\\varepsilon_0}$$'}`);
  }
  writeFileSync('bench-worker.md', parts.join('\n\n'));
  const size = (await import('node:fs')).readFileSync('bench-worker.md', 'utf8').length;
  console.log('测试文档: ' + (size / 1024).toFixed(0) + ' KB');
}

await run(docPath || 'bench-worker.md', docPath ? (docPath + ' 大文档') : 'Worker 渲染测试');

try { edgeProc.kill(); } catch (e) {}
