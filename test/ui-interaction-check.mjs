// test/ui-interaction-check.mjs — 交互回归（真实 exe + headless Edge + CDP）
//
// 覆盖按参考阅读器交互模型补齐的那批交互，全部在真实渲染页面上操作：
//   1. 左栏三标签（目录 / 历史 / 收藏）可切换，当前文档会进历史
//   2. 目录节折叠（caret 按钮、隐藏子树、状态持久化）
//   3. Ctrl+K 快捷键面板：人话标签 + 点值可改键（真的按键改绑并落 localStorage）
//   4. Ctrl+滚轮调字号、Alt+滚轮调正文行宽
//   5. 代码块三按钮（复制 / 换行 / 行号）真的生效
//   6. mermaid 双击进全屏查看器、Esc 关闭
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

const doc = [
  '# 交互样本',
  '',
  '正文一段。',
  '',
  '## 小节 A',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  'console.log(a + b);',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B; B-->C;',
  '```',
  '',
  '## 小节 B',
  '',
  'bbb',
  '',
  '### 子节 B1',
  '',
  'b1',
  '',
  '## 小节 C',
  '',
  'ccc',
  '',
].join('\n');
const dir = mkdtempSync(join(tmpdir(), 'mdl-uix-'));
const docPath = join(dir, 'uix.md');
writeFileSync(docPath, doc);

const port = 20370, cdpPort = 20371;
const prof = join(root, '.edge-prof-uix');
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
// isolate the host's config dir: these tests change font/width/shortcuts, and
// without this they would read and overwrite the real %APPDATA%\mdlight\config.json
// (and the stored width would race with the test's own width assertions).
const hp = spawn(EXE, [docPath, '--port', String(port), '--no-window'],
  { detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { MDLIGHT_CONFIG_DIR: dir }) });
hp.unref();
await sleep(2000);
const c = await makeClient((await cdpTarget()).webSocketDebuggerUrl);
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

const res = await ev(c, `(async()=>{
 try {
  const t0 = performance.now();
  while (performance.now() - t0 < 60000) {
    const m = document.getElementById('mdl-content');
    if (m && !m.querySelector('pre.mdl-source-preview') && m.querySelectorAll('h2').length > 2) break;
    await new Promise(r=>setTimeout(r,100));
  }
  await new Promise(r=>setTimeout(r,900));
  const s = (ms) => new Promise(r=>setTimeout(r,ms));
  const out = {};
  const toc = document.getElementById('mdl-toc');
  const content = document.getElementById('mdl-content');

  // ---- 1. 左栏三标签 ----
  out.tabs = [...toc.querySelectorAll('.mdl-toc-tab')].map(b=>b.textContent.trim());
  const histBtn = [...toc.querySelectorAll('.mdl-toc-tab')].find(b=>/历史/.test(b.textContent));
  const favBtn = [...toc.querySelectorAll('.mdl-toc-tab')].find(b=>/收藏/.test(b.textContent));
  if (favBtn) { favBtn.click(); await s(200); }
  out.favPaneShown = !document.getElementById('mdl-pane-favorites').hidden;
  out.favEmpty = (document.getElementById('mdl-pane-favorites').textContent||'').trim().length > 0;
  if (histBtn) { histBtn.click(); await s(250); }
  out.histPaneShown = !document.getElementById('mdl-pane-history').hidden;
  out.histRows = document.querySelectorAll('#mdl-pane-history .mdl-toc-row').length;
  out.histHasDoc = (document.getElementById('mdl-pane-history').textContent||'').indexOf('uix.md') >= 0;

  // ---- 2. 目录节折叠 ----
  const caret = toc.querySelector('button.mdl-toc-caret');
  out.caretButtons = toc.querySelectorAll('button.mdl-toc-caret').length;
  const vis = () => toc.querySelectorAll('#mdl-pane-toc .mdl-toc-node:not(.is-toc-hidden)').length;
  out.nodesBefore = vis();
  if (caret) { caret.click(); await s(200); }
  out.nodesAfterFold = vis();
  out.foldStored = localStorage.getItem('mdl-toc-folded') || '';
  if (caret) { caret.click(); await s(200); }
  out.nodesAfterUnfold = vis();
  // 折叠不得误伤历史/收藏行（它们和目录用了不同的类名）
  out.histNotHidden = document.querySelectorAll('#mdl-pane-history .is-toc-hidden').length === 0;

  // ---- 3. Ctrl+K 快捷键面板 + 改键 ----
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true }));
  await s(300);
  const panel = document.getElementById('mdl-sc-panel');
  out.scOpen = !!panel && panel.hidden === false;
  const vals = panel ? [...panel.querySelectorAll('.mdl-sc-val')] : [];
  const lbls = panel ? [...panel.querySelectorAll('.mdl-sc-lbl')].map(e=>e.textContent) : [];
  out.scRows = vals.length;
  out.scLabelHuman = lbls.length > 0 && lbls.every(x => !/^(toc|theme|find|wysiwyg|mindmap|dual|marp|editor|source|print|settings|open|zoom-|width-)/.test(x));
  out.scValIsButton = vals.length > 0 && vals.every(v => v.tagName === 'BUTTON');
  const themeName = () => panel ? [...panel.querySelectorAll('.mdl-sc-val')].find(v => /主题/.test(v.parentElement.textContent)) : null;
  const themeVal = themeName();
  if (themeVal) {
    themeVal.click();
    await s(180);
    // starting a recording rebuilds the row list, so re-query instead of
    // reading the (now detached) node we clicked
    const rec = themeName();
    out.scRecording = !!rec && /按下/.test(rec.textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Y', ctrlKey:true, shiftKey:true, bubbles:true }));
    await s(250);
  }
  out.scStored = localStorage.getItem('mdl-shortcuts') || '';
  const themeAfter = panel ? [...panel.querySelectorAll('.mdl-sc-val')].find(v => /主题/.test(v.parentElement.textContent)) : null;
  out.scRebound = themeAfter ? themeAfter.textContent : '';
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await s(200);
  out.scClosed = !!panel && panel.hidden === true;

  // ---- 4. 滚轮缩放 / 行宽 ----
  const rootEl = document.documentElement;
  out.fontBefore = parseFloat(getComputedStyle(rootEl).getPropertyValue('--mdl-font-size')) || 0;
  content.dispatchEvent(new WheelEvent('wheel', { deltaY:-120, ctrlKey:true, bubbles:true, cancelable:true }));
  await s(250);
  out.fontAfter = parseFloat(getComputedStyle(rootEl).getPropertyValue('--mdl-font-size')) || 0;
  out.widthBefore = getComputedStyle(rootEl).getPropertyValue('--mdl-content-max').trim();
  content.dispatchEvent(new WheelEvent('wheel', { deltaY:120, altKey:true, bubbles:true, cancelable:true }));
  await s(250);
  out.widthAfter = getComputedStyle(rootEl).getPropertyValue('--mdl-content-max').trim();

  // ---- 5. 代码块三按钮 ----
  const tools = [...content.querySelectorAll('.mdl-code-tools button, .mdl-code-btn')];
  out.codeTools = tools.map(b=>b.textContent.trim());
  const lnBtn = tools.find(b=>b.textContent.trim() === '#');
  if (lnBtn) { lnBtn.click(); await s(300); }
  out.lineSpans = content.querySelectorAll('pre code .line').length;
  const wrapBtn = tools.find(b=>b.textContent.trim() === '\u21b5');
  const codePre = content.querySelector('pre.mdl-code');
  const wrapBefore = codePre ? codePre.classList.contains('mdl-code-wrapped') : null;
  if (wrapBtn) { wrapBtn.click(); await s(250); }
  // the TOC panel uses this class per-block (the 🌐 global default is body-level)
  out.wrapToggled = !!(codePre && codePre.classList.contains('mdl-code-wrapped') !== wrapBefore);
  if (lnBtn) { lnBtn.click(); await s(200); }
  if (wrapBtn) { wrapBtn.click(); await s(150); }

  // ---- 6. mermaid 全屏查看器 ----
  const mm = content.querySelector('x-mermaid');
  out.mermaidSvg = content.querySelectorAll('x-mermaid svg').length;
  if (mm) {
    mm.dispatchEvent(new MouseEvent('dblclick', { bubbles:true, cancelable:true }));
    await s(400);
  }
  const v = document.querySelector('.mdl-mm-full');
  out.mmViewerOpen = !!v && v.hidden !== true && getComputedStyle(v).display !== 'none';
  out.mmViewerHasSvg = !!(v && v.querySelector('svg'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await s(300);
  const v2 = document.querySelector('.mdl-mm-full');
  out.mmViewerClosed = !v2 || v2.hidden === true || getComputedStyle(v2).display === 'none';

  return out;
 } catch (e) { return { __err: String((e && e.stack) || e) }; }
})()`);

if (res && res.__err) { console.log('FAIL  交互审计脚本抛错: ' + res.__err); fail++; }
else {
  ok((res.tabs || []).join(',') === '目录,历史,收藏', '左栏三个标签（目录/历史/收藏）', JSON.stringify(res.tabs));
  ok(res.favPaneShown === true, '点“收藏”切到收藏面板');
  ok(res.histPaneShown === true, '点“历史”切到历史面板');
  ok(res.histHasDoc === true, '当前文档已记入历史', 'rows=' + res.histRows);
  ok(res.caretButtons >= 1, '目录里有可折叠的 caret 按钮', 'buttons=' + res.caretButtons);
  ok(res.nodesAfterFold < res.nodesBefore, '点 caret 折叠子树', res.nodesBefore + ' → ' + res.nodesAfterFold);
  ok((res.foldStored || '').indexOf('交互样本') >= 0, '折叠状态写进 localStorage', res.foldStored);
  ok(res.nodesAfterUnfold === res.nodesBefore, '再点还原', String(res.nodesAfterUnfold));
  ok(res.histNotHidden === true, '折叠目录不会误伤历史/收藏条目');
  ok(res.scOpen === true, 'Ctrl+K 打开快捷键面板');
  ok(res.scRows >= 10, '面板列出全部快捷键', 'rows=' + res.scRows);
  ok(res.scLabelHuman === true, '面板显示人话标签而不是内部 id');
  ok(res.scValIsButton === true, '快捷键值是可点击的按钮');
  ok(res.scRecording === true, '点击后进入录制状态（提示按下按键）');
  ok((res.scStored || '').indexOf('ctrl+shift+y') >= 0, '按下 Ctrl+Shift+Y 后新键位落 localStorage', res.scStored);
  ok(/Shift/.test(res.scRebound || '') && /Y/.test(res.scRebound || ''), '面板显示新键位', res.scRebound);
  ok(res.scClosed === true, 'Esc 关闭快捷键面板');
  ok(res.fontAfter > res.fontBefore, 'Ctrl+滚轮放大字号', res.fontBefore + ' → ' + res.fontAfter);
  ok(res.widthAfter !== res.widthBefore, 'Alt+滚轮改正文行宽', res.widthBefore + ' → ' + res.widthAfter);
  ok(res.codeTools.length >= 3, '代码块有三个按钮（复制/换行/行号）', JSON.stringify(res.codeTools));
  ok(res.lineSpans >= 3, '点“#”后代码按行拆出 gutter', 'lines=' + res.lineSpans);
  ok(res.wrapToggled === true, '点“↵”切换自动换行');
  ok(res.mermaidSvg >= 1, 'mermaid 已渲染出 SVG', 'svg=' + res.mermaidSvg);
  ok(res.mmViewerOpen === true, '双击 mermaid 打开全屏查看器');
  ok(res.mmViewerHasSvg === true, '查看器里有 SVG');
  ok(res.mmViewerClosed === true, 'Esc 关闭 mermaid 查看器');
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
c.close(); try { ep.kill(); } catch (e) {} try { hp.kill(); } catch (e) {}
rmSync(dir, { recursive: true, force: true });
setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch (e) {} }, 1500);
process.exit(fail > 0 ? 1 : 0);
