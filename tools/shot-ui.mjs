// Capture the full mdlight UI (topbar, TOC, content) — for visual review.
//
//   MDLIGHT_LAUNCHER=dist/mdlight.exe node tools/shot-ui.mjs
//   node tools/shot-ui.mjs out/topbar.png   (extra shot after a custom action via MUI_EVAL)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) { console.error('Edge not found'); process.exit(1); }

const LAUNCHER = process.env.MDLIGHT_LAUNCHER;
const MUI_EVAL = process.env.MUI_EVAL;                 // optional extra JS to run before the shot
const OUTFILE = process.argv[2] || 'ui-main.png';
const dir = mkdtempSync(join(tmpdir(), 'mdl-ui-'));
const PORT = 18805, CDP = 19448;
const doc = process.env.MUI_DOC || join(root, 'test', 'fixtures', 'mermaid.md');
const srv = LAUNCHER
  ? spawn(join(root, LAUNCHER), [doc, '--port', String(PORT), '--no-window'], { cwd: root, stdio: 'ignore', windowsHide: true })
  : spawn(process.execPath, [join(root, 'mdlight.mjs'), doc, '--port', String(PORT), '--no-window'], { cwd: root, stdio: 'ignore', windowsHide: true });
await sleep(LAUNCHER ? 4000 : 1600);

const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1200,860',
  '--user-data-dir=' + join(dir, 'p'), '--remote-debugging-port=' + CDP, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
await sleep(2500);

const list = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res } = pend.get(m.id); pend.delete(m.id); res(m.result); }
});
const send = (method, params) => new Promise(res => {
  const mid = ++id; pend.set(mid, { res });
  ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 860, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(6000);
if (MUI_EVAL) { await send('Runtime.evaluate', { expression: MUI_EVAL }); await sleep(600); }

const out = join(root, 'test', 'out', OUTFILE);
mkdirSync(join(root, 'test', 'out'), { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('screenshot ->', out, statSync(out).size, 'bytes');

srv.kill(); edge.kill(); await sleep(500);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);