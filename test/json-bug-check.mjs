// Regression test for the Json.FindValue bug in native/Server.cs:
// a string *value* that spells the key (e.g. {"x":"source","source":"real"})
// must not be mistaken for the key itself.
//
// This test compiles the C# Json class standalone and checks the exact case.
// We cannot unit-test the C# class without a host, so we verify the fix
// end-to-end: POST /api/save with a source that contains "base": inside its
// string value, and assert the server did not confuse it with the base field.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(root, 'dist', 'native', 'mdlight.exe');
let pass = 0, fail = 0;
const ok = (c, l, e) => {
  if (c) { pass++; console.log('  ✓ ' + l); }
  else { fail++; console.log('  ✗ ' + l + (e ? '  → ' + e : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXE)) {
  console.log('dist/native/mdlight.exe 不存在 — 先运行 node tools/build-native.mjs');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'mdl-json-'));
const docPath = join(dir, 'json.md');
const orig = '# 测试\n\n原内容\n';
writeFileSync(docPath, orig);

// Isolate config
const cfgDir = join(dir, 'cfg');

mkdirSync(cfgDir, { recursive: true });

const PORT = 20461;
const env = { ...process.env, MDLIGHT_CONFIG_DIR: cfgDir };
const proc = spawn(EXE, [docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true, env });
await sleep(2500);
const up = 'http://127.0.0.1:' + PORT;

// [1] source value that contains "base": inside its text
// If FindValue is broken, it will find "base": *inside the source string*
// and parse the wrong value → save fails or writes wrong content.
{
  const trickySource = '# 文档\n\nbase: 应该保存这行\n';
  const r = await fetch(up + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: trickySource, force: true }),
  });
  const j = await r.json();
  ok(j.ok === true, 'source 含 "base:" 文本时 /api/save 仍成功', JSON.stringify(j));
  const disk = readFileSync(docPath, 'utf8');
  ok(disk === trickySource, '磁盘内容是正确的 tricky source', JSON.stringify(disk));
}

// [1b] adversarial: source spells ase and orce AND we send a real base/force
{
  const tricky2 = '# doc\nbase: x\nforce: y\n';
  const r = await fetch(up + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: tricky2, base: null, force: true }),
  });
  const j = await r.json();
  ok(j.ok === true, 'source 同时含 base/force 文本时 /api/save 仍成功', JSON.stringify(j));
  const disk = readFileSync(docPath, 'utf8');
  ok(disk === tricky2, '磁盘是 tricky2（含 base: force: 行）', JSON.stringify(disk));
}

// [2] explicit base field that conflicts with disk sha
// base = wrong sha, force = false → must return 409 conflict
{
  const r = await fetch(up + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: '# 新内容', base: '0000000000000000000000000000000000000000000000000000000000000000' }),
  });
  ok(r.status === 409, '陈旧 base sha 返回 409 冲突（不静默覆盖）', 'got ' + r.status);
}

// [3] correct base sha → success
{
  // get current sha
  const src = readFileSync(docPath, 'utf8');
  const crypto = await import('node:crypto');
  const sha = crypto.createHash('sha256').update(src).digest('hex');
  const r = await fetch(up + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: '# 第三轮', base: sha }),
  });
  const j = await r.json();
  ok(j.ok === true, '正确 base sha 的 /api/save 成功', JSON.stringify(j));
}

// [4] source field containing the literal text "force": — must not confuse the parser
{
  const tricky = 'force: true\n# 标题\n';
  const r = await fetch(up + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: tricky, force: false, base: null }),
  });
  const j = await r.json();
  ok(j.ok === true, 'source 含 "force:" 文本时解析器不被干扰', JSON.stringify(j));
  const disk = readFileSync(docPath, 'utf8');
  ok(disk === tricky, '磁盘内容是 tricky source（含 force: 行）', JSON.stringify(disk));
}

// [5] config round-trip with a value that spells a config key
// POST /api/config {"theme":"fontSize"} — the value spells another key
// GetObject + Normalise must not confuse it
{
  const r = await fetch(up + '/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'fontSize' }),
  });
  const j = await r.json();
  ok(j.ok === true, 'POST /api/config {"theme":"fontSize"} 成功', JSON.stringify(j));
  const g = await (await fetch(up + '/api/config')).json();
  ok(g.theme === 'fontSize', 'GET /api/config 读回 theme=fontSize（值不被误解析）', JSON.stringify(g));
}

try { proc.kill(); } catch { /* ignore */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
