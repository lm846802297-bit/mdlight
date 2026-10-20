// Verify progressive render: on a huge doc, the raw markdown <pre> should be
// visible before the KaTeX pipeline finishes (no blank page).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { exePath } from './_stage-exe.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const doc = process.argv[2] || 'bench-extreme.md';
const port = 20230, cdpPort = 20231;
const edge = process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = join(process.cwd(), '.edge-prof');
function httpGetJson(u) { return fetch(u).then((r) => r.json()); }
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

await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

// Immediately after navigation, sample: is the raw-markdown placeholder present
// (progressive render worked) or is the content area blank?
const samples = [];
for (let i = 0; i < 12; i++) {
  await sleep(120);
  const s = await evalJs(client, `
    (() => {
      const main = document.getElementById('mdl-content');
      if (!main) return { t: ${i}, state: 'no-main' };
      const pre = main.querySelector('pre.mdl-source-preview');
      const katex = main.querySelectorAll('.katex').length;
      const eq = main.querySelectorAll('x-equation').length;
      if (pre) return { t: ${i}, state: 'raw-markdown-visible', preChars: pre.textContent.length };
      if (katex > 0 || eq > 0) return { t: ${i}, state: 'rendered', katex, eq };
      return { t: ${i}, state: 'blank' };
    })()
  `);
  samples.push(s);
}
console.log(`=== 渐进渲染采样 (${doc}) ===`);
samples.forEach((s) => console.log(JSON.stringify(s)));

// final state
const final = await evalJs(client, `
  (() => {
    const main = document.getElementById('mdl-content');
    const pre = main.querySelector('pre.mdl-source-preview');
    return {
      stillPlaceholder: !!pre,
      katex: main.querySelectorAll('.katex').length,
      eq: main.querySelectorAll('x-equation').length,
      stat: (document.querySelector('.mdl-stat')||{}).textContent || '',
    };
  })()
`);
console.log('=== 最终状态 ===');
console.log(JSON.stringify(final));

client.close();
try { edgeProc.kill(); } catch (e) {}
try { hostProc.kill(); } catch (e) {}
