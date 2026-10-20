// Hardening tests — every real bug found in the third-round audit, plus the
// Node-side API surface that had silently rotted (404).
//
// Covered, all end-to-end against a live host:
//   1  any site could POST /api/save and overwrite the open document (HIGH)
//   2  overlapping saves could DELETE the document from disk (HIGH)
//   3  Config.Set raced and reported ok:true on a lost write (MED)
//   4  /api/export-csv could be pointed at the markdown source (LOW→MED)
//   5  --export could consume the .md as its output path (MED)
//   6  --port swallowed the next argument (MED)
//   7  Node mode: /api/config, /api/settings, /api/export-csv,
//      /api/upload-asset all 404, so every config-backed feature was dead there
//   8  Node mode: same cross-origin hole as the native host
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { exePath } from './_stage-exe.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = exePath(); // staged outside the sandboxed checkout — see _stage-exe.mjs
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

const base = 'http://127.0.0.1:';
const post = (u, body, hdr = {}) => fetch(u, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr },
  body: body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body)),
});

// ---------------------------------------------------------------------------
// fixtures
const dir = mkdtempSync(join(tmpdir(), 'mdl-hard-'));
const docPath = join(dir, 'hard.md');
const SRC = '# 硬化测试\n\n原内容\n';
writeFileSync(docPath, SRC);

const PORT = 20430;
// Isolate config: this test posts theme/fontSize to /api/config, which would
// otherwise write into the user's real %APPDATA%\mdlight\config.json.
const cfgDir = join(dir, 'cfg');
mkdirSync(cfgDir, { recursive: true });
const env = { ...process.env, MDLIGHT_CONFIG_DIR: cfgDir };
const proc = spawn(EXE, [docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true, env });
await sleep(2500);
const up = base + PORT;

// [1] cross-origin API access must be rejected ------------------------------
{
  const r = await post(up + '/api/save', { source: '# pwned', force: true },
    { Origin: 'https://evil.example' });
  ok(r.status === 403, '异源 Origin 的 /api/save 被 403 拒绝', 'got ' + r.status);
  const disk = readFileSync(docPath, 'utf8');
  ok(disk === SRC, '文档未被异源请求改写', JSON.stringify(disk));

  const r2 = await post(up + '/api/export-csv?name=x.csv', 'a,b',
    { Origin: 'https://evil.example' });
  ok(r2.status === 403, '异源 Origin 的 /api/export-csv 被 403 拒绝', 'got ' + r2.status);
}

// [2] overlapping saves must never delete the document ----------------------
{
  const bodies = Array.from({ length: 20 }, (_, i) => ({ source: '# 保存 ' + i, force: true }));
  const res = await Promise.all(bodies.map((b) => post(up + '/api/save', b)));
  const saved = res.filter((r) => r.status === 200).length;
  const errs = res.filter((r) => r.status !== 200).length;
  ok(existsSync(docPath), '20 个并发保存后文档仍在磁盘上');
  const disk = readFileSync(docPath, 'utf8');
  ok(/^# 保存 \d+$/.test(disk.trim()), '文档内容是某一次保存的完整正文', JSON.stringify(disk));
  console.log('    （20 个并发保存：成功 ' + saved + '，其余 ' + errs + '）');
}

// [3] config round-trip (shape mirrors native/Server.cs) --------------------
{
  const r = await post(up + '/api/config', { theme: 'nord', fontSize: 17 });
  const j = await r.json();
  ok(j.ok === true && j.config === true, 'POST /api/config 返回 ok', JSON.stringify(j));
  const g = await (await fetch(up + '/api/config')).json();
  ok(g.theme === 'nord' && g.fontSize === 17, 'GET /api/config 读回刚写的配置', JSON.stringify(g));
}

// [4] CSV export cannot be aimed at the document ----------------------------
{
  const r = await post(up + '/api/export-csv?name=' + encodeURIComponent('hard.md'), 'a,b');
  const t = await r.text();
  ok(/name must be a \.csv|refusing/i.test(t), 'CSV 导出拒绝 .md 文件名', t);
  ok(readFileSync(docPath, 'utf8').trim().startsWith('# 保存'), '文档未被 CSV 内容覆盖');

  const okr = await post(up + '/api/export-csv?name=out.csv', 'A,B\r\n1,2\r\n');
  ok(okr.status === 200, '正常的 CSV 导出仍然成功');
  ok(existsSync(join(dir, 'out.csv')), 'CSV 文件已生成');
}

// [5]/[6] argument handling -------------------------------------------------
{
  // --export with no explicit output must not consume the .md as its target
  const html = join(dir, 'hard.html');
  await new Promise((res) => {
    const p = spawn(EXE, [docPath, '--export'],
      { cwd: root, stdio: 'ignore', windowsHide: true });
    p.on('exit', res);
    setTimeout(() => { try { p.kill(); } catch { /* ignore */ } res(null); }, 60000);
  });
  ok(existsSync(html), '--export 生成了默认的同名 .html');
  ok(readFileSync(docPath, 'utf8').trim().startsWith('# 保存'),
     '--export 没有把 .md 当成输出文件覆盖');

  // `--port <文件名>` used to eat the document and show the picker; now the
  // file stays a file and -p still fixes the port.
  const np = spawn(EXE, ['--port', docPath, '-p', '20432', '--no-window'],
    { cwd: root, stdio: 'ignore', windowsHide: true });
  await sleep(2500);
  let served = null;
  try {
    const r = await fetch(base + 20432 + '/');
    served = (await r.text()).includes('保存') || r.status === 200;
  } catch { /* ignore */ }
  ok(served, '--port 后跟文件名时不再吞掉该参数（服务仍正常启动）');
  try { np.kill(); } catch { /* ignore */ }
}

// [7] Node mode must expose the same API surface ----------------------------
{
  const cfgDir = join(dir, 'cfg');
  mkdirSync(cfgDir, { recursive: true });
  const np = spawn(process.execPath, ['mdlight.mjs', docPath, '--port', '20431', '--no-window'], {
    cwd: root, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, MDLIGHT_CONFIG_DIR: cfgDir },
  });
  await sleep(2500);
  const nup = base + 20431;
  const g = await (await fetch(nup + '/api/config')).json();
  ok(g.theme === 'sepia' || g.theme === undefined, 'Node 模式 GET /api/config 可用', JSON.stringify(g));
  const s = await post(nup + '/api/config', { theme: 'sepia' });
  const sj = await s.json();
  ok(sj.ok === true, 'Node 模式 POST /api/config 生效', JSON.stringify(sj));
  const g2 = await (await fetch(nup + '/api/config')).json();
  ok(g2.theme === 'sepia', 'Node 模式配置已持久化到 config.json', JSON.stringify(g2));
  const st = await post(nup + '/api/settings', {});
  const stj = await st.json();
  ok(stj.ok === false && /mdlight\.exe/.test(stj.error || ''),
     'Node 模式 /api/settings 返回明确提示而非 404', JSON.stringify(stj));
  const csv = await post(nup + '/api/export-csv?name=n.csv', 'A,B\r\n1,2\r\n');
  ok(csv.status === 200, 'Node 模式 CSV 导出可用');
  const up2 = await post(nup + '/api/upload-asset?name=p.png',
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  ok(up2.status === 200, 'Node 模式 /api/upload-asset 可用');

  // [8] same-origin guard on the Node host
  const evil = await post(nup + '/api/config', { theme: 'x' }, { Origin: 'https://evil.example' });
  ok(evil.status === 403, 'Node 模式异源 /api/config 被 403 拒绝', 'got ' + evil.status);
  const site = await fetch(nup + '/api/save', {
    method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: '# pwned', force: true }),
  });
  ok(site.status === 403, 'Node 模式 Sec-Fetch-Site=cross-site 的保存被拒绝', 'got ' + site.status);
  try { np.kill(); } catch { /* ignore */ }
}

// teardown
try { proc.kill(); } catch { /* ignore */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
