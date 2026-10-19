// dist standalone test: copy dist/ somewhere with NO node_modules and verify the
// launcher + mermaid on-demand assets work from that layout alone.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'mdl-standalone-'));
cpSync(join(root, 'dist'), join(dir, 'dist'), { recursive: true });
const doc = join(dir, 'doc.md');
const { writeFileSync } = await import('node:fs');
writeFileSync(doc, '# 独立运行\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n$$x^2$$\n');

const PORT = 18701;
const srv = spawn(process.execPath, [join(dir, 'dist', 'mdlight.mjs'), doc, '--port', String(PORT), '--no-window'], {
  cwd: dir, stdio: 'ignore', windowsHide: true,
});
try {
  await sleep(1600);
  const get = async (p) => { const r = await fetch('http://127.0.0.1:' + PORT + p); return { s: r.status, t: await r.text() }; };

  const page = await get('/');
  ok(page.s === 200, 'dist 独立启动，页面 200', page.s);
  ok(/<x-mermaid/.test(page.t), '文档中的 mermaid 变成占位');
  ok(/mermaidCount:\s*1/.test(page.t), 'mermaidCount 注入为 1');
  ok(/mdlight 0\.5\.0|__MDL__/.test(page.t), '版本/配置存在');

  const kj = await get('/assets/mermaid/kinds.json');
  ok(kj.s === 200, 'dist 里能取到 kinds.json', kj.s);
  let meta = null;
  try { meta = JSON.parse(kj.t); } catch (e) {}
  ok(!!meta, 'kinds.json 合法');
  ok(meta && meta.kinds['flowchart-v2'] && meta.kinds['flowchart-v2'].split, 'flowchart-v2 映射到 split chunk');

  if (meta && meta.kinds['flowchart-v2']) {
    const c = await get('/assets/mermaid/' + meta.kinds['flowchart-v2'].split);
    ok(c.s === 200, 'dist 里能取到 flowchart chunk', c.s);
  }
  const entry = await get('/assets/mermaid/' + (meta ? meta.entry : 'mermaid-entry.js'));
  ok(entry.s === 200, 'dist 里能取到 entry', entry.s);

  // does the dist launcher still work without any node_modules at all?
  ok(!existsSync(join(dir, 'dist', 'node_modules')), '确认测试环境无 node_modules');

  const exportOut = await new Promise((res) => {
    const p = spawn(process.execPath, [join(dir, 'dist', 'mdlight.mjs'), doc, '--export', join(dir, 'out.html')], { cwd: dir, stdio: 'ignore', windowsHide: true });
    p.on('exit', (code) => res(code));
  });
  ok(exportOut === 0, '独立导出成功', 'exit ' + exportOut);
  const html = (await import('node:fs')).readFileSync(join(dir, 'out.html'), 'utf8');
  ok(html.length > 100000, '导出文件非空', html.length);
  ok(/data-static/.test(html), '导出为静态页面');
  ok(/<x-mermaid/.test(html), '导出保留 mermaid 源码块');
  ok(/离线导出不含图表引擎/.test(html), '导出说明图表不可渲染的原因');
  // The inlined app.js contains the import path as a string literal (dead code
  // in static mode — renderMermaid() returns before reaching it). What matters
  // is that nothing REFERENCES it as a resource: no <script src>, no <link href>.
  ok(!/<script[^>]+src=/.test(html), '导出无任何外部脚本引用');
  ok(!/<link[^>]+href="\/assets/.test(html), '导出无任何服务端样式引用');
} finally {
  try { srv.kill(); } catch (e) {}
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
