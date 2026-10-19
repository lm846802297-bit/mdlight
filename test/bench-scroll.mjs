// Measure scroll jank on the big doc. Reuse the plumbing from bench-browser.mjs.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const port = 20210;
const cdpPort = 20211;
const edge = process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = 'C:\\Users\\84680\\Desktop\\AI赚钱\\mdlight\\.edge-prof';

function httpGetJson(url) { return fetch(url).then((r) => r.json()); }
async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try { return (await httpGetJson(`http://127.0.0.1:${cdpPort}/json`)).find((t) => t.type === 'page'); }
    catch (e) { await sleep(300); }
  }
  throw new Error('no CDP target');
}
async function makeClient(wsUrl) {
  let nextId = 1; const pending = new Map();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  return {
    send(method, params) { return new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params: params || {} })); }); },
    close() { try { ws.close(); } catch (e) {} },
  };
}
async function evalJs(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

rmSync(prof, { recursive: true, force: true });
mkdirSync(prof, { recursive: true });
const edgeProc = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { detached: true, stdio: 'ignore' });
edgeProc.unref();
const hostProc = spawn('C:\\Users\\84680\\Desktop\\AI赚钱\\mdlight\\dist\\native\\mdlight.exe',
  ['bench-big.md', '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
hostProc.unref();
await sleep(1500);

const target = await cdpTarget();
const client = await makeClient(target.webSocketDebuggerUrl);
await client.send('Page.enable');
await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await sleep(1000);

// Scroll-jank probe: requestAnimationFrame frame budget while scrolling.
const jank = await evalJs(client, `
(async () => {
  const frameTimes = [];
  let rafId;
  function loop(t) { frameTimes.push(t); rafId = requestAnimationFrame(loop); }
  rafId = requestAnimationFrame(loop);
  // scroll in steps
  const step = 3000;
  const max = document.body.scrollHeight;
  const t0 = performance.now();
  let y = 0;
  while (y < max) {
    y += step;
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 8));
  }
  const elapsed = performance.now() - t0;
  cancelAnimationFrame(rafId);
  // compute frame budget: how many frames missed 16.7ms target
  let drops = 0, worst = 0;
  for (let i = 1; i < frameTimes.length; i++) {
    const d = frameTimes[i] - frameTimes[i-1];
    if (d > 20) drops++;
    if (d > worst) worst = d;
  }
  return { scrollElapsedMs: Math.round(elapsed), frames: frameTimes.length, droppedFrames: drops, worstFrameMs: Math.round(worst) };
})()
`);
console.log('=== 滚动卡顿实测 (native exe, 89KB doc) ===');
console.log(JSON.stringify(jank, null, 2));

client.close();
try { edgeProc.kill(); } catch (e) {}
try { hostProc.kill(); } catch (e) {}
