// test/ui-display-check.mjs — 界面显示回归（真实 exe + headless Edge + CDP）
//
// 覆盖用户报过的“界面显示错乱”这一类问题，全部按 1440×900 真实视口测量：
//   1. 标题不得被上一行吞掉（反引号跨行配对的典型症状）
//   2. 不得出现任何「公式渲染失败」卡片，状态栏不得出现“失败”
//   3. 页面不得出现横向滚动条（内容/公式挤出视口）
//   4. 左侧目录条目不得重叠；条目多时目录面板必须可滚动（overflow-y:auto）
//   5. 比内容区更宽的 display 公式必须自己能横向滚动（overflow-x:auto），不允许顶破页面
//   6. 反引号代码仍然保持 <code>
//   7. 开机自动检查更新的静默语义：加载后不得弹出 toast
// Edge 未安装时跳过（不影响 CI）。
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
const ok = (c, l, extra) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('FAIL  ' + l + (extra ? '  → ' + extra : '')); } };

// ---- fixture: 落单反引号 + 标题 + 长目录 + 超宽 display 公式 + 表格 ----
const parts = [];
parts.push('# 显示回归样本');
parts.push('正文里有一个落单的反引号 ` 结束。');
parts.push('### 实现');
parts.push('`core/renderer.mjs` 增加 `mdToLatex(src)` 纯函数：');
for (let i = 0; i < 40; i++) parts.push('## 小节 ' + i);
parts.push('| a | b |\n|---|---|\n| 1 | 2 |');
// 一个明显比内容区宽的 display 公式（长求和），用来验证公式自己能横向滚动。
// 必须远超内容区宽度（1440 视口下正文约 860px），否则这条断言测不到东西：
// KaTeX 的度量会随字体略有浮动，所以这里给足冗余（约 2000px 宽）。
const summands = ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\zeta', '\\eta', '\\theta',
  '\\iota', '\\kappa', '\\lambda', '\\mu', '\\nu', '\\xi', '\\pi', '\\rho'];
parts.push('$$\\sum_{i_1=1}^{n}\\sum_{i_2=1}^{n}\\sum_{i_3=1}^{n}\\sum_{i_4=1}^{n}'
  + summands.map((g) => `${g}_{i_1i_2i_3i_4}\\,`).join('')
  + '\\sigma_{i_1i_2i_3i_4}$$');
const doc = parts.join('\n\n');
const dir = mkdtempSync(join(tmpdir(), 'mdl-ui-'));
const docPath = join(dir, 'ui.md');
writeFileSync(docPath, doc);

const port = 20360, cdpPort = 20361;
const prof = join(root, '.edge-prof-ui');
async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try { return (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === 'page'); }
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
  if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
  return r.result && r.result.result ? r.result.result.value : undefined;
}

rmSync(prof, { recursive: true, force: true });
const ep = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--window-size=1440,900', '--user-data-dir=' + prof, `--remote-debugging-port=${cdpPort}`, 'about:blank'],
  { detached: true, stdio: 'ignore' });
ep.unref();
const hp = spawn(EXE, [docPath, '--port', String(port), '--no-window'], { detached: true, stdio: 'ignore' });
hp.unref();
await sleep(2000);
const c = await makeClient((await cdpTarget()).webSocketDebuggerUrl);
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

const res = await ev(c, `(async()=>{
  const t0 = performance.now();
  while (performance.now() - t0 < 60000) {
    const m = document.getElementById('mdl-content');
    if (m && !m.querySelector('pre.mdl-source-preview') && m.querySelectorAll('x-equation').length > 0) break;
    await new Promise(r=>setTimeout(r,100));
  }
  await new Promise(r=>setTimeout(r,900));
  const content = document.getElementById('mdl-content');
  const toc = document.getElementById('mdl-toc');
  const h3s = [...content.querySelectorAll('h3')];
  const links = [...toc.querySelectorAll('a')];
  const lr = links.map(a=>a.getBoundingClientRect());
  let overlaps = 0;
  for (let i=1;i<lr.length;i++) if (lr[i].top < lr[i-1].bottom - 0.6) overlaps++;
  const eqs = [...content.querySelectorAll('x-equation')];
  // 注意：content-visibility:auto 会「跳过」屏幕外子树，此时 scrollWidth 只是占位值，
  // 必须先把这条超宽公式滚进视口再量，否则测到的是假几何。
  const wide = eqs[eqs.length - 1];
  if (wide) { wide.scrollIntoView({ block: 'center' }); await new Promise(r=>setTimeout(r,400)); }
  const wideOverflow = wide ? wide.scrollWidth - wide.clientWidth : 0;
  let wideScrollLeft = 0;
  if (wide) { wide.scrollLeft = 400; await new Promise(r=>setTimeout(r,80)); wideScrollLeft = wide.scrollLeft; }
  const widest = eqs.reduce((a,e)=>Math.max(a, e.getBoundingClientRect().width), 0);
  const paneScrollW = document.documentElement.scrollWidth;
  const toast = document.getElementById('mdl-toast');
  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    h3: h3s.map(h=>h.textContent.trim()),
    h3Merged: h3s.some(h=>/mdToLatex|core\\/renderer/.test(h.textContent)),
    codeKept: [...content.querySelectorAll('code')].some(e=>e.textContent.includes('core/renderer.mjs')),
    cards: content.querySelectorAll('.mdl-math-error').length,
    stat: (document.getElementById('mdl-stat')||{}).textContent || '',
    eq: eqs.length,
    widestEq: Math.round(widest),
    wideOverflow: Math.round(wideOverflow),
    wideScrollLeft: Math.round(wideScrollLeft),
    paneW: content.clientWidth,
    docScrollW: paneScrollW,
    pageScrollX: paneScrollW > window.innerWidth + 1,
    tocItems: links.length,
    tocOverlaps: overlaps,
    tocOverflowY: toc ? getComputedStyle(toc).overflowY : null,
    tocScrollable: toc ? toc.scrollHeight > toc.clientHeight : false,
    toastVisible: !!(toast && toast.hidden === false),
    toastText: toast ? (toast.textContent||'').slice(0,60) : '',
  };
})()`);

if (res && res.__err) { console.log('FAIL  audit expression threw: ' + res.__err); fail++; }
else {
  ok(res.viewport === '1440x900', '视口按 1440x900 测量', res.viewport);
  ok(res.h3.includes('实现'), '### 实现 独立成标题', JSON.stringify(res.h3));
  ok(!res.h3Merged, '标题没有被下一行吞掉');
  ok(res.codeKept, '反引号代码仍保持 <code>');
  ok(res.cards === 0, '没有公式渲染失败卡片', 'cards=' + res.cards);
  ok(!/失败/.test(res.stat), '状态栏没有“失败”', res.stat);
  ok(!res.pageScrollX, '页面没有横向滚动条');
  ok(res.tocOverlaps === 0, '目录条目没有重叠', 'overlaps=' + res.tocOverlaps);
  ok(res.tocItems >= 40, '目录条目齐全（>=40）', 'items=' + res.tocItems);
  ok(res.tocOverflowY === 'auto', '目录面板可滚动 (overflow-y:auto)', String(res.tocOverflowY));
  ok(res.tocScrollable, '目录条目多时确实产生滚动（不被裁掉）');
  ok(res.wideOverflow > 100, 'fixture 里确实有一条远超内容区宽的公式（测量有效）', 'overflow=' + res.wideOverflow + 'px, pane=' + res.paneW);
  ok(res.wideScrollLeft > 0, '超宽 display 公式能横向滚动到尾部（不会被裁掉）', 'scrollLeft=' + res.wideScrollLeft);
  ok(!res.toastVisible, '加载后没有弹 toast（自动检查更新静默）', res.toastText);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
c.close(); try { ep.kill(); } catch (e) {} try { hp.kill(); } catch (e) {}
rmSync(dir, { recursive: true, force: true });
setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch (e) {} }, 1500);
process.exit(fail > 0 ? 1 : 0);
