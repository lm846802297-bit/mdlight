// Marp / PPT presentation mode checks.
// Part 1 verifies the renderer produces per-slide HTML + deck config.
// Part 2 drives the native host with a headless Edge and asserts the
// presentation overlay (F5, arrow paging, HUD page counter) works end-to-end.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { render } from '../core/renderer.mjs';
import { exePath } from './_stage-exe.mjs';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? ' \u2192 got ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Part 1: renderer -------------------------------------------------------
console.log('\n[1] 渲染器：frontmatter 解析 + 幻灯片分割');
const deck = [
  '---',
  'marp: true',
  'size: 16:9',
  'paginate: true',
  'header: "{title} — mdlight"',
  'footer: "Slide {page} / {total}"',
  '---',
  '# 第一页',
  '',
  '内容',
  '',
  '---',
  '',
  '# 第二页',
  '',
  '$$E = mc^2$$',
  '',
  '---',
  '',
  '# 第三页',
  '',
].join('\n');
const d = render(deck);
ok(d.marp && d.marp.size === '16:9', 'marp.size 解析为 16:9', JSON.stringify(d.marp));
ok(d.marp && d.marp.paginate === true, 'marp.paginate 解析为 true');
ok(d.marp && d.marp.header === '{title} — mdlight', 'marp.header 保留宏');
ok(d.slides && d.slides.length === 3, '3 个 slide', d.slides && d.slides.length);
ok(d.slides && d.slides[0].includes('<h1'), 'slide[0] 是标题页');
ok(d.slides && d.slides[1].includes('x-equation'), 'slide[1] 含公式');
ok(!d.slides[0].includes('mdl-marp-break'), 'slide 内不出现分页符');
ok((d.html.match(/mdl-marp-break/g) || []).length === 2, '阅读 html 用 2 个分页符连接 3 页');

console.log('\n[2] 渲染器：非 Marp 文档不产生幻灯片');
const plain = render('# 普通\n\n正文');
ok(plain.marp === undefined, 'marp:false → marp 未定义');
ok(plain.slides === undefined, 'marp:false → slides 未定义');
const explicitFalse = render('---\nmarp: false\n---\n# 不是幻灯片\n\n---\n\n# 仍是一页');
ok(explicitFalse.marp === undefined, 'marp:false 显式 → 不是幻灯片');
ok(explicitFalse.slides === undefined, 'marp:false 显式 → slides 未定义');
const noFm = render('# 没有 frontmatter\n\n---\n\n# 这是分隔线');
ok(noFm.marp === undefined, '无 frontmatter → 不是幻灯片');

// ---- Part 2: DOM via headless Edge -----------------------------------------
console.log('\n[3] 端到端：native 宿主 + 无头 Edge');
const root = process.cwd();
const exe = exePath(); // staged outside the sandboxed checkout — see _stage-exe.mjs
const tmp = mkdtempSync(join(tmpdir(), 'marp-'));
const fakeApp = join(tmp, 'app');
const { mkdirSync } = await import('node:fs');
mkdirSync(fakeApp, { recursive: true });
writeFileSync(join(fakeApp, 'config.json'), JSON.stringify({ theme: 'light' }));
const doc = join(tmp, 'deck.md');
writeFileSync(doc, deck);

const port = 20360;
const edgePort = 19369;
const prof = join(tmp, 'edge-prof');
const server = spawn(exe, [doc, '--port', String(port), '--no-window'], {
  stdio: 'ignore',
  env: { ...process.env, MDLIGHT_CONFIG_DIR: fakeApp },
});
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + prof,
  '--remote-debugging-port=' + edgePort, 'about:blank',
], { stdio: 'ignore' });

try {
  await sleep(3000);
  const list = await (await fetch('http://127.0.0.1:' + edgePort + '/json')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const exceptions = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  };
  await new Promise((r) => ws.onopen = r);
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };
  const key = (k) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });
  await sleep(4500);

  ok(exceptions.length === 0, '无 JS 异常', exceptions.slice(0, 3).join('; '));

  // The marp button should now be visible (was hidden in markup)
  const btnHidden = await ev("document.getElementById('mdl-btn-marp') ? document.getElementById('mdl-btn-marp').hidden : 'missing'");
  ok(btnHidden === false, '放映按钮已显示', String(btnHidden));

  // Reading mode should show all three slides' content inline
  const readingHasAll = await ev("document.querySelectorAll('#mdl-content h1').length");
  ok(readingHasAll === 3, '阅读模式渲染 3 个标题', readingHasAll);

  // Enter presentation
  await key('F5');
  await sleep(400);
  const overlayHidden = await ev("var o=document.getElementById('mdl-marp-overlay'); o ? o.hidden : 'missing'");
  ok(overlayHidden === false, 'F5 后放映覆盖层显示');
  const page1 = await ev("document.getElementById('mdl-marp-hud-page') ? document.getElementById('mdl-marp-hud-page').textContent : ''");
  ok(page1.trim() === '1 / 3', 'HUD 显示 1 / 3', page1.trim());

  // Advance
  await key('ArrowRight');
  await sleep(300);
  const page2 = await ev("document.getElementById('mdl-marp-hud-page').textContent");
  ok(page2.trim() === '2 / 3', 'ArrowRight → 2 / 3', page2.trim());
  const slide2hasEq = await ev("document.getElementById('mdl-marp-slide').innerHTML.indexOf('x-equation') >= 0");
  ok(slide2hasEq === true, '第 2 页含公式');

  // Prev
  await key('ArrowLeft');
  await sleep(300);
  const back1 = await ev("document.getElementById('mdl-marp-hud-page').textContent");
  ok(back1.trim() === '1 / 3', 'ArrowLeft → 1 / 3', back1.trim());

  // Last slide should not advance past the end
  await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight');
  await sleep(400);
  const end = await ev("document.getElementById('mdl-marp-hud-page').textContent");
  ok(end.trim() === '3 / 3', '到达末页不越界 (3 / 3)', end.trim());

  // Timer started
  const timerVal = await ev("document.getElementById('mdl-marp-hud-timer').textContent");
  ok(/^\d+:\d\d$/.test(timerVal || ''), '演讲者计时器已启动 (m:ss)', String(timerVal));

  // Exit
  await key('Escape');
  await sleep(300);
  const afterEsc = await ev("var o=document.getElementById('mdl-marp-overlay'); o ? o.hidden : 'missing'");
  ok(afterEsc === true, 'Escape 退出放映');
} finally {
  try { server.kill(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(500);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

console.log('\nmarp-check: ' + pass + ' \u2713, ' + fail + ' \u2717');
process.exit(fail ? 1 : 0);