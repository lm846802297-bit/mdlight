// mermaid integration test: server-side placeholders + asset routes + lazy the
// kind map. Does NOT render SVG (that needs a browser); it proves the on-demand
// plumbing: a doc with mermaid gets <x-mermaid>, the route serves exactly the
// requested chunk, and a doc without mermaid never touches /assets/mermaid/*.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const dir = mkdtempSync(join(tmpdir(), 'mdl-mm-'));
const withMm = join(dir, 'with.md');
const noMm = join(dir, 'without.md');
writeFileSync(withMm, readFileSync(join(root, 'test', 'fixtures', 'mermaid.md'), 'utf8'));
writeFileSync(noMm, '# 没有图表\n\n```js\nconst a = 1;\n```\n\n$$x^2$$\n');

function serve(file, port) {
  const p = spawn(process.execPath, [join(root, 'mdlight.mjs'), file, '--port', String(port), '--no-window'], {
    cwd: root, stdio: 'ignore', windowsHide: true,
  });
  return p;
}
async function get(url) {
  const r = await fetch(url);
  const text = await r.text();
  return { status: r.status, text, type: r.headers.get('content-type') || '' };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PORT_A = 18401, PORT_B = 18402;
const srvA = serve(withMm, PORT_A);
const srvB = serve(noMm, PORT_B);
try {
  await sleep(1400);

  console.log('\n[1] 含 mermaid 的文档');
  const a = await get('http://127.0.0.1:' + PORT_A + '/');
  ok(a.status === 200, '页面 200');
  const mmCount = (a.text.match(/<x-mermaid/g) || []).length;
  ok(mmCount === 4, '4 个 <x-mermaid> 占位（3 正常 + 1 错误）', 'got ' + mmCount);
  ok(/mermaidCount:\s*4/.test(a.text), '__MERMAID_COUNT__ 注入为 4');
  ok(/<x-mermaid[^>]*data-mdl-line/.test(a.text), '占位带 data-mdl-line（供 F2 跳行）');
  ok(/mdl-mermaid-src/.test(a.text), '降级源码块存在');
  ok(/securityLevel|__MDL__/.test(a.text), '配置对象存在');
  // NB: hljs wraps tokens in <span>, so assert on the markers, not the literal text
  const jsBlock = /mdl-code[^>]*><code class="hljs language-js"/.test(a.text)
    && /hljs-keyword">const</.test(a.text);
  ok(jsBlock, '普通 js 代码块仍正常高亮渲染');
  ok(!/<x-mermaid[^>]*>\s*<svg/.test(a.text), '服务端不渲染 SVG（需 DOM）');

  console.log('\n[2] kinds.json 路由');
  const kj = await get('http://127.0.0.1:' + PORT_A + '/assets/mermaid/kinds.json');
  ok(kj.status === 200, 'kinds.json 200');
  let meta = null;
  try { meta = JSON.parse(kj.text); } catch (e) {}
  ok(!!meta, 'kinds.json 是合法 JSON');
  ok(meta && Object.keys(meta.kinds).length >= 37, '至少 37 种图表', meta && Object.keys(meta.kinds).length);
  ok(meta && meta.kinds['flowchart-v2'] && meta.kinds['flowchart-v2'].split, 'flowchart-v2 有 split 文件名');
  ok(meta && meta.kinds['sequence'] && meta.kinds['sequence'].split, 'sequence 有 split 文件名');
  ok(meta && meta.kinds['pie'] && meta.kinds['pie'].split, 'pie 有 split 文件名');

  console.log('\n[3] 按需 chunk 路由');
  const entry = await get('http://127.0.0.1:' + PORT_A + '/assets/mermaid/' + meta.entry);
  ok(entry.status === 200, 'entry 200', entry.status);
  ok(/application\/javascript/.test(entry.type), 'entry 是 JS');
  const splitName = meta.kinds['flowchart-v2'].split;
  const chunk = await get('http://127.0.0.1:' + PORT_A + '/assets/mermaid/' + splitName);
  ok(chunk.status === 200, 'flowchart chunk 200', chunk.status);
  ok(chunk.text.length > 100, 'chunk 非空');
  const bad = await get('http://127.0.0.1:' + PORT_A + '/assets/mermaid/../../mdlight.mjs');
  ok(bad.status === 400 || bad.status === 404, '目录穿越被拒', bad.status);
  const missing = await get('http://127.0.0.1:' + PORT_A + '/assets/mermaid/nope.js');
  ok(missing.status === 404, '不存在的 chunk 404', missing.status);

  console.log('\n[4] 不含 mermaid 的文档（关键：零成本）');
  const b = await get('http://127.0.0.1:' + PORT_B + '/');
  ok(b.status === 200, '页面 200');
  const bCount = (b.text.match(/<x-mermaid/g) || []).length;
  ok(bCount === 0, '0 个 <x-mermaid>', 'got ' + bCount);
  ok(/mermaidCount:\s*0/.test(b.text), '__MERMAID_COUNT__ 为 0');
  ok(b.text.length < a.text.length, '无图表页面更小（占位不产生体积）');

  console.log('\n[5] 包体积口径');
  ok(meta.bytes > 5_000_000, '37 种图表全量约 5 MB（懒加载，非全下载）', meta.bytes);
} finally {
  try { srvA.kill(); } catch (e) {}
  try { srvB.kill(); } catch (e) {}
  await sleep(400);
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
