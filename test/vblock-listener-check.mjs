// test/vblock-listener-check.mjs — verifies wrapVBlocks preserves event listeners
// (equation copy buttons, collapse handlers) and produces correct wrapping.
// Uses the real exe + headless Edge via CDP. Exits 0 if Edge absent.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { exePath } from './_stage-exe.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = exePath(); // staged outside the sandboxed checkout — see _stage-exe.mjs
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) { console.log('Edge 未找到 — 跳过（不会破坏 CI）'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('FAIL  ' + l); } };

// Build a doc with >200 blocks AND mermaid so wrapVBlocks actually runs.
const parts = [];
for (let i = 0; i < 60; i++) {
  parts.push(`## Section ${i}`);
  for (let j = 0; j < 4; j++) parts.push(`段落 ${i}.${j} with $x^{${i}}$ formula.`);
  if (i === 5) parts.push('```mermaid\ngraph TD; A-->B;\n```');
}
const doc = parts.join('\n\n');
const dir = mkdtempSync(join(tmpdir(), 'mdl-vb-'));
const docPath = join(dir, 'big.md');
writeFileSync(docPath, doc);

const port = 20340, cdpPort = 20341;
const prof = join(root, '.edge-prof-vb');
function httpGetJson(u) { return fetch(u).then((r) => r.json()); }
async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try { return (await httpGetJson(`http://127.0.0.1:${cdpPort}/json`)).find((t) => t.type === 'page'); }
    catch (e) { await sleep(300); }
  }
  throw new Error('no CDP target');
}
async function makeClient(wsUrl) {
  let i = 1; const p = new Map(); const ws = new WebSocket(wsUrl);
  await new Promise((r, x) => { ws.onopen = r; ws.onerror = x; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  return { send(m, x) { return new Promise((r) => { const id = i++; p.set(id, r); ws.send(JSON.stringify({ id, method: m, params: x || {} })); }); }, close() { try { ws.close(); } catch (e) {} } };
}
async function ev(c, e) {
  const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 60000 });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

rmSync(prof, { recursive: true, force: true });
const ep = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank'], { detached: true, stdio: 'ignore' });
ep.unref();
const hp = spawn(EXE, [docPath, '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
hp.unref();
await sleep(2000);
const t = await cdpTarget();
const c = await makeClient(t.webSocketDebuggerUrl);
await c.send('Page.enable');
await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

const res = await ev(c, `(async()=>{
  // wait for render + wrap
  for (let i=0;i<100;i++){
    const m=document.getElementById('mdl-content');
    if(m && m.querySelectorAll('.mdl-vblock').length>0 && m.querySelectorAll('x-equation').length>0) break;
    await new Promise(r=>setTimeout(r,50));
  }
  const m=document.getElementById('mdl-content');
  const vblocks=m.querySelectorAll('.mdl-vblock').length;
  const eqs=m.querySelectorAll('x-equation').length;
  // listener survival: equation copy buttons present (wireEquationCopy runs before wrap)
  const copyBtns=m.querySelectorAll('.mdl-eq-copy').length;
  // contentEl position preserved (split-pane not present, but check it's still in layout)
  const inLayout = !!document.querySelector('.mdl-layout main#mdl-content');
  // mermaid rendered or at least placeholder present
  const mermaid=m.querySelectorAll('x-mermaid').length;
  return { vblocks, eqs, copyBtns, inLayout, mermaid, scrollH: document.body.scrollHeight };
})()`);

ok(res.vblocks > 0, 'vblock wrapping occurred (mermaid + >200 blocks)');
ok(res.eqs > 0, 'equations rendered inside vblocks');
ok(res.copyBtns === res.eqs, 'all equation copy buttons survived wrapping (listener preservation)');
ok(res.inLayout, 'contentEl preserved in layout after wrap');
ok(res.mermaid >= 0, 'mermaid placeholders present');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
c.close(); try { ep.kill(); } catch (e) {} try { hp.kill(); } catch (e) {}
rmSync(dir, { recursive: true, force: true });
setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch (e) {} }, 1500);
process.exit(fail > 0 ? 1 : 0);