// Measure browser-side render cost on the big doc, through the native host.
// Uses the same CDP-over-WebSocket plumbing as native-check.mjs.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const port = 20200;
const cdpPort = 20201;
const edge = process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = 'C:\\Users\\84680\\Desktop\\AI赚钱\\mdlight\\.edge-prof';

function httpGetJson(url) {
  return fetch(url).then((r) => r.json());
}

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try { return (await httpGetJson(`http://127.0.0.1:${cdpPort}/json`)).find((t) => t.type === 'page'); }
    catch (e) { await sleep(300); }
  }
  throw new Error('no CDP target');
}

async function makeClient(wsUrl) {
  let nextId = 1;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  return {
    send(method, params) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    },
    close() { try { ws.close(); } catch (e) {} },
  };
}

async function evalJs(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

rmSync(prof, { recursive: true, force: true });
mkdirSync(prof, { recursive: true });

const edgeProc = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank',
], { detached: true, stdio: 'ignore' });
edgeProc.unref();

// start native host
const hostProc = spawn('C:\\Users\\84680\\Desktop\\AI赚钱\\mdlight\\dist\\native\\mdlight.exe',
  [process.argv[2] || 'bench-big.md', '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
hostProc.unref();
await sleep(1500);

const target = await cdpTarget();
const client = await makeClient(target.webSocketDebuggerUrl);
await client.send('Page.enable');

// Time from navigation commit to KaTeX render completion.
const measure = `
(async () => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  // poll until the stat bar reports its final numbers (mermaidCount / eqCount)
  const t0 = Date.now();
  const deadline = t0 + 30000;
  let last = 0;
  while (Date.now() < deadline) {
    const st = document.querySelector('.mdl-stat') ? document.querySelector('.mdl-stat').textContent : '';
    if (st !== last) { last = st; await new Promise(r => setTimeout(r, 50)); }
    else if (st) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return {
    navLoadMs: Math.round(nav.duration || 0),
    domContentMs: Math.round(nav.domContentLoadedEventEnd || 0),
    bodyBytes: document.body.innerHTML.length,
    eqCount: (document.querySelectorAll('x-equation').length),
    katexRendered: document.querySelectorAll('.katex').length,
    hCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    tableCount: document.querySelectorAll('table').length,
    stat: last,
  };
})()
`;

// navigate
await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await sleep(500);

const navRes = await evalJs(client, measure);
console.log('=== 浏览器端渲染实测 (native exe) ===');
console.log(JSON.stringify(navRes, null, 2));

// now measure scroll jank: force layout of the whole doc, time it
const layout = await evalJs(client, `
(() => {
  const t0 = performance.now();
  const h = document.body.scrollHeight;  // forces full reflow
  const t1 = performance.now();
  return { scrollHeight: h, fullReflowMs: Math.round(t1 - t0) };
})()
`);
console.log('\n=== 全量布局耗时 ===');
console.log(JSON.stringify(layout, null, 2));

client.close();
try { edgeProc.kill(); } catch (e) {}
try { hostProc.kill(); } catch (e) {}
