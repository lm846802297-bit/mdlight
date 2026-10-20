// Accurate: from Page.navigate to "every x-equation has a .katex child".
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { exePath } from './_stage-exe.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const doc = process.argv[2] || 'bench-big.md';
const port = 20220, cdpPort = 20221;
const edge = process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = join(process.cwd(), '.edge-prof');
function httpGetJson(url) { return fetch(url).then((r) => r.json()); }
async function cdpTarget() {
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
rmSync(prof, { recursive: true, force: true }); mkdirSync(prof, { recursive: true });
const edgeProc = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { detached: true, stdio: 'ignore' });
edgeProc.unref();
const hostProc = spawn(exePath(), [doc, '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
hostProc.unref();
await sleep(1500);
const target = await cdpTarget();
const client = await makeClient(target.webSocketDebuggerUrl);
await client.send('Page.enable');

const navStart = Date.now();
await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

const res = await evalJs(client, `
(async () => {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < 60000) {
    const total = document.querySelectorAll('x-equation').length;
    const done = document.querySelectorAll('x-equation .katex, x-equation .mdl-math-error').length;
    if (total > 0 && done >= total) {
      const errs = document.querySelectorAll('.mdl-math-error').length;
      return { totalEquations: total, renderedInMs: Date.now() - t0, errors: errs, sampleErr: (errs ? document.querySelector('.mdl-math-error')?.textContent : '') };
    }
    await new Promise(r => setTimeout(r, 30));
  }
  return { timeout: true };
})()
`);
console.log(`=== 从导航到全部 KaTeX 渲染完成 (${doc}) ===`);
console.log(JSON.stringify(res, null, 2));
console.log('(含服务器启动余量 + 导航，实际客户端渲染时间 < 该值)');

client.close();
try { edgeProc.kill(); } catch (e) {}
try { hostProc.kill(); } catch (e) {}
