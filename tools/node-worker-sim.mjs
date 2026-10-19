// Simulate exactly what the browser worker does: fetch the worker script,
// eval it in a sandboxed context with a fake importScripts, then post a message.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const dir = mkdtempSync(join(tmpdir(), 'mdl-sim-'));
writeFileSync(join(dir, 't.md'), '# 渲染一致性\n\n正文含 **粗体**。\n');
const srv = spawn(process.execPath, [join(process.cwd(), 'mdlight.mjs'), join(dir, 't.md'), '--port', '20207', '--no-window'],
  { stdio: 'ignore', windowsHide: true, env: { ...process.env, MDLIGHT_CONFIG_DIR: join(dir, 'cfg') } });
await new Promise(r => setTimeout(r, 2500));

const rwSrc = await (await fetch('http://127.0.0.1:20207/assets/renderer-worker.js')).text();
console.log('worker src len:', rwSrc.length);
// The node host does NOT serve /assets/renderer.js (only the native host does).
let rendererSrc = null, rendererErr = null;
try { rendererSrc = await (await fetch('http://127.0.0.1:20207/assets/renderer.js')).text(); }
catch (e) { rendererErr = e.message; }
console.log('node host /assets/renderer.js:', rendererErr ? 'FAIL: ' + rendererErr : 'len ' + rendererSrc.length);

if (rendererSrc) {
  // Now simulate the worker: importScripts loads renderer.js into self, then onmessage fires
  const selfObj = { MDLRenderer: null };
  const sandbox = {
    self: selfObj,
    importScripts: (url) => {
      if (url === '/assets/renderer.js') {
        // renderer.js is an IIFE: var MDLRenderer = (() => {...})()
        const src = rendererSrc.replace(/^var MDLRenderer=/, 'MDLRenderer=');
        vm.runInContext(src, ctx);
        selfObj.MDLRenderer = ctx.MDLRenderer;
        return;
      }
      throw new Error('unknown importScripts url: ' + url);
    },
    postMessage: (m) => { messages.push(m); },
  };
  const messages = [];
  const ctx = vm.createContext(sandbox);
  try {
    vm.runInContext(rwSrc, ctx);
    console.log('worker script loaded OK, MDLRenderer set:', !!selfObj.MDLRenderer);
    // fire onmessage
    sandbox.self.onmessage({ data: { id: 1, source: '# 渲染一致性\n\n正文含 **粗体**。\n', hardBreaks: false } });
    if (messages.length) {
      const m = messages[0];
      console.log('worker reply: ok=', m.ok, 'html len=', (m.html || '').length, 'mermaidCount=', m.mermaidCount);
      if (!m.ok) console.log('worker error:', m.error);
    } else console.log('worker posted nothing');
  } catch (e) {
    console.log('SIM ERROR:', e.message, e.stack ? e.stack.split('\n')[1] : '');
  }
}
srv.kill();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
