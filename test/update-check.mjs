// test/update-check.mjs
// Verifies the exe's self-update + .md-binding routes:
//   /api/update-check (returns JSON with current version),
//   /api/update-apply  (guarded),
//   /api/bind + /api/unbind (Shell integration round-trip).
// Run: node test/update-check.mjs  (needs a built dist/native/mdlight.exe)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(root, 'dist', 'native', 'mdlight.exe');
let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('FAIL  ' + l + (e ? '  → ' + e : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXE)) { console.log('缺少 dist/native/mdlight.exe — 先跑 build:native'); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'mdl-upd-'));
writeFileSync(join(dir, 'base.md'), '# base\n');
const PORT = 20988;
const srv = spawn(EXE, [join(dir, 'base.md'), '--port', String(PORT), '--no-window'], { stdio: 'ignore', windowsHide: true });
await sleep(2200);
const B = `http://127.0.0.1:${PORT}`;

async function api(p, opts) {
  try {
    const r = await fetch(B + p, opts || {});
    return { status: r.status, json: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, json: {}, error: String(e && e.message || e) }; }
}

// update-check: returns ok + current version, plus hasUpdate/error flags
const uc = await api('/api/update-check');
ok(uc.status === 200 && uc.json.ok === true && uc.json.current === '0.9.0',
  '/api/update-check 返回 ok + current=0.9.0' + (uc.error ? '  (' + uc.error + ')' : ''));
ok(typeof uc.json.hasUpdate === 'boolean' && typeof uc.json.error === 'boolean',
  '/api/update-check 含 hasUpdate/error 布尔标志');

// update-apply with no url: guarded, returns a message (no crash)
const ua = await api('/api/update-apply', { method: 'POST', body: '{}' });
ok(ua.status === 200 && ua.json.ok === true && typeof ua.json.message === 'string',
  '/api/update-apply（无 url）返回 ok + message');

// bind/unbind round-trip: both report ok (Shell is idempotent; we unbind after)
const bd = await api('/api/bind', { method: 'POST', body: '{}' });
ok(bd.status === 200 && bd.json.ok === true && /安装|installed|已/.test(bd.json.message || ''),
  '/api/bind 安装 .md 关联');
const ub = await api('/api/unbind', { method: 'POST', body: '{}' });
ok(ub.status === 200 && ub.json.ok === true,
  '/api/unbind 卸载 .md 关联（清理回归）');

// app.js payload carries the new handlers
const app = await (await fetch(B + '/assets/app.js')).text();
ok(app.includes('checkUpdate') && app.includes('/api/update-check') && app.includes('/api/bind'),
  '打包的 app.js 含 update/bind 逻辑');

srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);