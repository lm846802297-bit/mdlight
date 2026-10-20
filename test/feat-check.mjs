// Feature checks: code_lineno / code_wrap / table full-screen.
// Drives a headless Edge against the native host, asserting the DOM-level
// effects of each toggle. Runs against a fake config so the real one is
// untouched.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { exePath } from './_stage-exe.mjs';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? ' \u2192 got ' + extra : '')); }
};

const root = process.cwd();
const exe = exePath(); // staged outside the sandboxed checkout — see _stage-exe.mjs
const tmp = mkdtempSync(join(tmpdir(), 'feat-'));
const fakeApp = join(tmp, 'app');
mkdirSync(fakeApp, { recursive: true });
writeFileSync(join(fakeApp, 'config.json'), JSON.stringify({
  codeLineno: true, codeWrap: true, font: 'Segoe UI', fontSize: 15.5, theme: 'light',
}));
const doc = join(tmp, 'doc.md');
writeFileSync(doc, [
  '# 代码与表格测试',
  '',
  '## 子章节 A',
  '',
  '第一段属于 A。',
  '',
  '第二段属于 A。',
  '',
  '## 子章节 B',
  '',
  '第一段属于 B。',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  'const c = 3;',
  '```',
  '',
  '| 列一 | 列二 | 列三 |',
  '| --- | --- | --- |',
  '| a   | b   | c   |',
  '| d   | e   | f   |',
  '',
  '$$E = mc^2$$',
  '',
  '行内公式 $\\alpha + \\beta$ 也应能复制 LaTeX 源码。',
  '',
].join('\n'));

const port = 20260;
const edgePort = 19269;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });
  await sleep(4000);

  console.log('\n[1] 配置经 CSS 变量 / body class 生效');
  ok(await ev("document.body.classList.contains('mdl-code-wrap')"), 'codeWrap -> mdl-code-wrap 类');
  ok(await ev("document.body.classList.contains('mdl-code-lineno')"), 'codeLineno -> mdl-code-lineno 类');

  console.log('\n[2] 代码行号：每行一个 <span class="line">，CSS counter 编号');
  const lineCount = await ev("document.querySelectorAll('#mdl-content pre code .line').length");
  ok(lineCount === 3, '3 行代码拆成 3 个 .line span（末行换行不产生空 span）', lineCount);
  const lines = await ev("Array.from(document.querySelectorAll('#mdl-content pre code .line')).map(function(l){return l.textContent;})");
  ok(lines && lines.join('|') === 'const a = 1;|const b = 2;|const c = 3;', '每行内容正确', lines && lines.join('|'));
  const gutter = await ev("getComputedStyle(document.querySelectorAll('#mdl-content pre code .line')[0], '::before').content");
  ok(/counter\(line\)/.test(gutter || ''), '行号 gutter 已生成 (content: counter(line))', gutter);

  console.log('\n[3] 表格全屏按钮 + 切换');
  const tbl = await ev("document.querySelectorAll('#mdl-content table').length");
  ok(tbl === 1, '有 1 个表格');
  const btnExists = await ev("document.querySelectorAll('#mdl-content table .mdl-tbl-fs').length");
  ok(btnExists === 1, '表格有 ⛶ 全屏按钮');
  await ev("document.querySelectorAll('#mdl-content table .mdl-tbl-fs')[0].click()");
  const fsOn = await ev("document.querySelectorAll('#mdl-content table')[0].classList.contains('mdl-tbl-fs-on')");
  ok(fsOn === true, '点击后进入全屏模式');
  const fsPos = await ev("getComputedStyle(document.querySelectorAll('#mdl-content table')[0]).position");
  ok(fsPos === 'fixed', '全屏时 position: fixed', fsPos);
  const bodyOverflow = await ev("document.body.style.overflow");
  ok(bodyOverflow === 'hidden', '全屏时锁定 body 滚动');
  await ev("document.querySelectorAll('#mdl-content table .mdl-tbl-fs')[0].click()");
  ok(await ev("document.querySelectorAll('#mdl-content table')[0].classList.contains('mdl-tbl-fs-on')") === false, '再点退出全屏');

  console.log('\n[4] 文档未破坏');
  ok(await ev("(document.querySelector('#mdl-content h1')||{textContent:''}).textContent") === '代码与表格测试', '标题正常');
  ok(exceptions.length === 0, '无未捕获异常', exceptions.slice(0, 2).join(' | '));

  console.log('\n[5] 正文标题折叠');
  const pAfterA = await ev("(function(){var h=Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0]; return h.nextElementSibling.textContent;})()");
  ok(/第一段属于 A/.test(pAfterA || ''), 'A 的下一段是 A 的内容', pAfterA);
  await ev("(function(){var h=Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0]; h.click();})()");
  ok(await ev("Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0].classList.contains('mdl-folded')"), '点击后 h2 有 mdl-folded 类');
  const hiddenA = await ev("(function(){var h=Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0]; return h.nextElementSibling.style.display;})()");
  ok(hiddenA === 'none', 'A 的内容被折叠隐藏', hiddenA);
  ok(await ev("(function(){var h=Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0]; var b=h.nextElementSibling; while(b){if(/^H[1-6]$/.test(b.tagName||'')&&b.tagName[1]<=2)break; if(!b.style.display) return 'not-hidden'; b=b.nextElementSibling;} return 'hidden-until-B';})()") === 'hidden-until-B', 'A 下的所有内容都折叠，B 保留');
  await ev("(function(){var h=Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0]; h.click();})()");
  ok(await ev("(function(){var h=Array.from(document.querySelectorAll('#mdl-content h2')).filter(function(x){return x.textContent==='子章节 A';})[0]; return h.nextElementSibling.style.display;})()") === '', '再点展开恢复');

  console.log('\n[6] F3 双栏分屏');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', {key:'F3', bubbles:true}))");
  await sleep(600);
  ok(await ev("document.body.classList.contains('mdl-dual')"), '按 F3 进入双栏模式');
  ok(await ev("(document.getElementById('mdl-editor')||{}).classList && document.getElementById('mdl-editor').classList.contains('dual')"), '编辑器进入 dual 布局');
  ok(await ev("document.getElementById('mdl-editor').hidden === false"), '编辑器面板显示');
  ok(await ev("document.getElementById('mdl-source').value !== ''"), '源码面板有内容');
  ok(await ev("getComputedStyle(document.getElementById('mdl-editor')).position === 'fixed'"), '编辑器保持 fixed');
  // live preview: type new text into the source, the preview re-renders
  await ev("(function(){var t=document.getElementById('mdl-source'); t.value = t.value + '\\n\\n新增段落 F3。'; t.dispatchEvent(new Event('input', {bubbles:true}));})()");
  await sleep(1200);
  ok(await ev("(document.querySelector('#mdl-content').textContent||'').indexOf('新增段落 F3') >= 0"), '输入后预览实时刷新');
  // exit
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', {key:'F3', bubbles:true}))");
  await sleep(600);
  ok(await ev("document.body.classList.contains('mdl-dual')") === false, '再按 F3 退出双栏');

  console.log('\n[7] 页面内查找栏');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', {key:'f', ctrlKey:true, bubbles:true}))");
  await sleep(400);
  ok(await ev("document.getElementById('mdl-find').hidden === false"), 'Ctrl+F 打开查找栏');
  await ev("(function(){var i=document.getElementById('mdl-find-input'); i.value='属于'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await sleep(250);
  // Typing no longer searches per keystroke: matching now runs on Enter/blur
  // (IME-safe, and the same contract as the reference reader), so the first
  // Enter is what produces the hits.
  ok(await ev("document.querySelectorAll('#mdl-content mark.mdl-find-hit').length") === 0, '输入过程不实时搜索');
  await ev("document.getElementById('mdl-find-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))");
  await sleep(400);
  ok(await ev("document.querySelectorAll('#mdl-content mark.mdl-find-hit').length") === 3, '高亮 3 个匹配', await ev("document.querySelectorAll('#mdl-content mark.mdl-find-hit').length"));
  ok(await ev("document.getElementById('mdl-find-count').textContent") === '1/3', '计数显示 1/3', await ev("document.getElementById('mdl-find-count').textContent"));
  ok(await ev("document.querySelector('#mdl-content mark.mdl-find-hit').textContent") === '属于', '匹配文本正确');
  ok(await ev("document.querySelector('#mdl-content mark.mdl-find-hit--active') !== null"), '有当前激活匹配');
  await ev("document.getElementById('mdl-find-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))");
  await sleep(300);
  ok(await ev("document.getElementById('mdl-find-count').textContent") === '2/3', 'Enter 跳到下一个 → 2/3', await ev("document.getElementById('mdl-find-count').textContent"));
  await ev("document.getElementById('mdl-find-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', shiftKey:true, bubbles:true}))");
  await sleep(300);
  ok(await ev("document.getElementById('mdl-find-count').textContent") === '1/3', 'Shift+Enter 回到上一个 → 1/3', await ev("document.getElementById('mdl-find-count').textContent"));
  await ev("document.getElementById('mdl-find-close').click()");
  await sleep(300);
  ok(await ev("document.getElementById('mdl-find').hidden === true"), '关闭查找栏');
  ok(await ev("document.querySelectorAll('#mdl-content mark.mdl-find-hit').length") === 0, '关闭后高亮清除');
  // 文档未被查找污染
  ok(await ev("(document.querySelector('#mdl-content h1')||{textContent:''}).textContent") === '代码与表格测试', '查找后文档仍正常');

  console.log('\n[8] 自绘标题栏 (frameless)');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?frameless=1' });
  await sleep(2500);
  ok(await ev("document.body.classList.contains('mdl-frameless')"), '?frameless=1 时 body 有 mdl-frameless');
  ok(await ev("document.getElementById('mdl-win-ctls').hidden === false"), '窗口控制按钮显示');
  ok(await ev("!!document.getElementById('mdl-win-min') && !!document.getElementById('mdl-win-max') && !!document.getElementById('mdl-win-close')"), '最小化/最大化/关闭按钮齐全');
  ok(await ev("document.getElementById('mdl-win-close').offsetParent !== null"), '控制按钮可见可点');
  // non-frameless page keeps the controls hidden
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });
  await sleep(2000);
  ok(await ev("document.getElementById('mdl-win-ctls').hidden === true"), '无 frameless 参数时控制按钮隐藏');

  console.log('\n[9] i18n 多语言');
  ok(await ev("(window.MDLI18N && window.MDLI18N.lang()) === 'zh-CN'"), '默认中文 (zh-CN)');
  ok(await ev("document.getElementById('mdl-btn-toc').title") === '目录 (Ctrl+T)', '中文按钮提示');
  await ev("document.getElementById('mdl-btn-lang').click()");
  await sleep(500);
  ok(await ev("(window.MDLI18N && window.MDLI18N.lang()) === 'en-US'"), '切到 en-US');
  ok(await ev("document.getElementById('mdl-btn-toc').title") === 'Contents (Ctrl+T)', '英文按钮提示');
  ok(await ev("document.getElementById('mdl-editor-close').textContent") === 'Close', '编辑器按钮英文');
  ok(await ev("document.getElementById('mdl-find-input').placeholder") === 'Find in page…', '查找框英文');
  await ev("document.getElementById('mdl-btn-lang').click()");
  await sleep(500);
  ok(await ev("(window.MDLI18N && window.MDLI18N.lang()) === 'zh-CN'"), '再点切回 zh-CN');
  ok(await ev("document.getElementById('mdl-btn-toc').title") === '目录 (Ctrl+T)', '切回后提示恢复中文');

  console.log('\n[10] CSV 导出');
  ok(await ev("document.querySelectorAll('#mdl-content table').length") === 1, '文档有 1 个表格');
  await ev("document.getElementById('mdl-btn-csv').click()");
  await sleep(1200);
  const csvPath = join(tmp, 'doc-\u8868\u683c1.csv');
  let csvExists = null;
  try { csvExists = readFileSync(csvPath, 'utf8'); } catch (e) { csvExists = null; }
  ok(csvExists !== null, '导出生成 CSV 文件', csvPath);
  if (csvExists) {
    // UTF-8 BOM is written on purpose so Excel doesn't mangle Chinese.
    const head = csvExists.replace(/^\uFEFF/, '').split('\r\n')[0];
    ok(/^\u5217\u4e00,\u5217\u4e8c,\u5217\u4e09/.test(head), 'CSV 首行是表头', JSON.stringify(head));
    ok(/\r\n/.test(csvExists), 'CSV 用 CRLF 换行');
  }

  console.log('\n[11] 大纲脑图 (markmap)');
  await ev("document.getElementById('mdl-btn-mindmap').click()");
  await sleep(600);
  ok(await ev("document.getElementById('mdl-mindmap').hidden === false"), '点击 🧠 打开脑图');
  ok(await ev("document.getElementById('mdl-mindmap-title').textContent") === '\u4ee3\u7801\u4e0e\u8868\u683c\u6d4b\u8bd5', '脑图根标题是 H1');
  ok(await ev("document.querySelectorAll('#mdl-mindmap-body svg text').length") >= 3, 'SVG 有多个节点文字', await ev("document.querySelectorAll('#mdl-mindmap-body svg text').length"));
  ok(await ev("document.querySelectorAll('#mdl-mindmap-body svg path').length") >= 2, 'SVG 有连线', await ev("document.querySelectorAll('#mdl-mindmap-body svg path').length"));
  await ev("document.getElementById('mdl-mindmap-close').click()");
  await sleep(300);
  ok(await ev("document.getElementById('mdl-mindmap').hidden === true"), '点击 ✕ 关闭脑图');
  await ev("document.getElementById('mdl-btn-mindmap').click()");
  await sleep(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  ok(await ev("document.getElementById('mdl-mindmap').hidden === true"), '按 Esc 关闭脑图');

  console.log('\n[12] 编辑资产上传');
  // POST a tiny PNG via the host route; it should land in <docdir>/assets.
  const pngBuf = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0x0d,0x49,0x48,0x44,0x52]);
  const upRes = await fetch('http://127.0.0.1:' + port + '/api/upload-asset?name=pic.png', {
    method: 'POST', body: pngBuf, headers: { 'Content-Type': 'application/octet-stream' },
  });
  const upJson = await upRes.json().catch(() => null);
  ok(upJson && upJson.ok === true && upJson.path === 'assets/pic.png', '上传返回 assets/pic.png', JSON.stringify(upJson));
  let assetBuf = null;
  try { assetBuf = readFileSync(join(tmp, 'assets', 'pic.png')); } catch (e) { assetBuf = null; }
  ok(assetBuf !== null && assetBuf.length === pngBuf.length, '文件写入 <docdir>/assets/pic.png', assetBuf && assetBuf.length);
  // non-image name must be rejected
  const badRes = await fetch('http://127.0.0.1:' + port + '/api/upload-asset?name=evil.exe', {
    method: 'POST', body: pngBuf,
  });
  ok(badRes.status >= 400, '非图片后缀被拒绝', badRes.status);
  // path traversal in the filename must be neutralised
  const travRes = await fetch('http://127.0.0.1:' + port + '/api/upload-asset?name=..%2F..%2Fescape.png', {
    method: 'POST', body: pngBuf,
  });
  const travJson = await travRes.json().catch(() => null);
  ok(!(travJson && travJson.path && travJson.path.indexOf('..') >= 0), '文件名中的路径穿越被中和', travJson && travJson.path);

  console.log('\n[13] 外观：皮肤 / 字体 / 字号');
  const skinCount = await ev("document.querySelectorAll('#mdl-skin-grid .mdl-skin').length");
  ok(skinCount >= 16, '皮肤面板有 16 种模式', skinCount);
  // pick a skin directly (not cycle)
  const origTheme = await ev("document.body.dataset.theme");
  await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin[data-skin=\"nord\"]'); if(b) b.click();})()");
  ok(await ev("document.body.dataset.theme") === 'nord', '点击皮肤卡切到 nord', await ev("document.body.dataset.theme"));
  await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin[data-skin=\"light\"]'); if(b) b.click();})()");
  ok(await ev("document.body.dataset.theme") === 'light', '切到 light', await ev("document.body.dataset.theme"));
  // one of the newly added skins
  await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin[data-skin=\"cyberpunk\"]'); if(b) b.click();})()");
  ok(await ev("document.body.dataset.theme") === 'cyberpunk', '切到赛博朋克', await ev("document.body.dataset.theme"));
  // the active highlight must move to the chosen card immediately
  const onCount = await ev("document.querySelectorAll('#mdl-skin-grid .mdl-skin--on').length");
  const onIsCyber = await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin--on'); return b ? b.dataset.skin : null;})()");
  ok(onCount === 1 && onIsCyber === 'cyberpunk', '选中卡高亮立即更新到赛博朋克', onCount + '/' + onIsCyber);
  // dark skins must map mermaid to a dark theme even in a light OS
  ok(await ev("window.__mdlMermaidTheme()") === 'dark', '赛博朋克 → mermaid 深色主题', await ev("window.__mdlMermaidTheme()"));
  await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin[data-skin=\"nord\"]'); if(b) b.click();})()");
  ok(await ev("window.__mdlMermaidTheme()") === 'dark', '北欧 → mermaid 深色主题', await ev("window.__mdlMermaidTheme()"));
  await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin[data-skin=\"solarized\"]'); if(b) b.click();})()");
  ok(await ev("window.__mdlMermaidTheme()") === 'default', '日光（浅色） → mermaid 浅色主题', await ev("window.__mdlMermaidTheme()"));
  // font size: A+ then A- then restore
  const size0 = await ev("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mdl-font-size'))");
  const bigger = await ev("(function(){document.getElementById('mdl-btn-larger').click(); return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mdl-font-size'));})()");
  ok(bigger > size0, 'A+ 增大字号 (' + size0 + ' -> ' + bigger + ')');
  const smaller = await ev("(function(){document.getElementById('mdl-btn-smaller').click(); return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mdl-font-size'));})()");
  ok(smaller < bigger, 'A- 减小字号 (' + bigger + ' -> ' + smaller + ')');
  // font family
  await ev("(function(){var s=document.getElementById('mdl-font-select'); s.value='Georgia'; s.dispatchEvent(new Event('change'));})()");
  ok(/Georgia/.test(await ev("getComputedStyle(document.documentElement).getPropertyValue('--mdl-font')")), '选择 Georgia 后 --mdl-font 已更新');
  // restore theme + font to a sane default so later runs aren't affected
  await ev("(function(){var b=document.querySelector('#mdl-skin-grid .mdl-skin[data-skin=\"auto\"]'); if(b) b.click();})()");
  await ev("(function(){var s=document.getElementById('mdl-font-select'); s.value=''; s.dispatchEvent(new Event('change'));})()");
  // Ctrl+D / ◐ cycle must persist to config.json too (it used to revert on reload)
  const cfgBefore = await (await fetch('http://127.0.0.1:' + port + '/api/config')).json();
  await ev("(function(){var b=document.getElementById('mdl-btn-theme'); if(b) b.click();})()");
  await sleep(600);
  const cfgAfter = await (await fetch('http://127.0.0.1:' + port + '/api/config')).json();
  ok(cfgAfter.theme && cfgAfter.theme !== (cfgBefore && cfgBefore.theme), 'Ctrl+D 换肤持久化到 config.json (' + (cfgBefore && cfgBefore.theme) + ' -> ' + cfgAfter.theme + ')');
  // a font set through the ⚙ settings window (config.json, not localStorage) must
  // show as selected in the 🎨 dropdown. The settings window writes config and the
  // page re-reads it on load, so reload to reproduce that flow.
  await fetch('http://127.0.0.1:' + port + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ font: 'Times New Roman', theme: 'system' }) });
  await sleep(300);
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });
  await sleep(2000);
  const selFont = await ev("(function(){var s=document.getElementById('mdl-font-select'); return s.value;})()");
  ok(selFont === 'Times New Roman', '⚙ 设置的字体在 🎨 下拉中显示为选中', selFont);
  // restore
  await fetch('http://127.0.0.1:' + port + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ font: '', theme: 'system' }) });
  await sleep(300);

  // ── [14] 右键上下文菜单 ─────────────────────────────────────────────
  const ctxVisible = await ev("(function(){ if (window.__mdlCtxOpen) window.__mdlCtxOpen(120, 120); var m = document.getElementById('mdl-ctx'); return m && m.hidden === false; })()");
  ok(ctxVisible, '右键打开上下文菜单（可见）');
  const ctxItems = await ev("document.querySelectorAll('#mdl-ctx .mdl-ctx-item').length");
  ok(ctxItems >= 12, '菜单条目数量 >= 12 (' + ctxItems + ')');
  // 外观子面板默认隐藏
  ok(await ev("(function(){var p=document.getElementById('mdl-ctx').querySelector('.mdl-ctx-sub'); return p && p.hidden === true;})()"), '外观子面板初始隐藏');
  // 展开外观 → 皮肤格 / 字体下拉 / 字号都有
  await ev("(function(){var items=document.querySelectorAll('#mdl-ctx .mdl-ctx-item'); var it=Array.from(items).filter(function(x){return /外观/.test(x.textContent);})[0]; if(it) it.click();})()");
  const ctxSubOpen = await ev("(function(){var p=document.getElementById('mdl-ctx').querySelector('.mdl-ctx-sub'); return p && p.hidden === false;})()");
  ok(ctxSubOpen, '点击外观项展开子面板');
  ok(await ev("document.querySelectorAll('#mdl-ctx-skin-grid .mdl-skin').length") === 16, '右键面板里 16 张皮肤卡');
  ok(await ev("document.querySelectorAll('#mdl-ctx-font-select option').length") >= 13, '右键面板里有字体下拉');
  ok(await ev("/px$/.test(document.getElementById('mdl-ctx-size-val').textContent)"), '右键面板显示当前字号');
  // 在右键面板里换皮肤
  await ev("(function(){var b=document.querySelector('#mdl-ctx-skin-grid .mdl-skin[data-skin=\"dracula\"]'); if(b) b.click();})()");
  ok(await ev("document.body.dataset.theme") === 'dracula', '在右键菜单里切到 dracula');
  // 换回 system，关闭菜单
  await ev("(function(){var b=document.querySelector('#mdl-ctx-skin-grid .mdl-skin[data-skin=\"system\"]'); if(b) b.click();})()");
  await ev("(function(){window.__mdlCtxClose ? window.__mdlCtxClose() : (document.getElementById('mdl-ctx').hidden = true);})()");
  ok(await ev("document.getElementById('mdl-ctx').hidden === true"), '关闭右键菜单');
  // Escape 也能关
  await ev("window.__mdlCtxOpen(100,100)");
  ok(await ev("document.getElementById('mdl-ctx').hidden === false"), '再次打开');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
  ok(await ev("document.getElementById('mdl-ctx').hidden === true"), 'Escape 关闭右键菜单');
  // 回归：开过外观面板→关菜单→重开→点外观应仍能展开（ctxAppearOpen 失同步修复）
  await ev("window.__mdlCtxOpen(100,100)");
  await ev("(function(){var items=document.querySelectorAll('#mdl-ctx .mdl-ctx-item'); var it=Array.from(items).filter(function(x){return /外观/.test(x.textContent);})[0]; if(it) it.click();})()");
  ok(await ev("(function(){var p=document.getElementById('mdl-ctx').querySelector('.mdl-ctx-sub'); return p && p.hidden === false;})()"), '重开后点外观仍能展开子面板（ctxAppearOpen 失同步回归）');
  await ev("(function(){window.__mdlCtxClose ? window.__mdlCtxClose() : (document.getElementById('mdl-ctx').hidden = true);})()");
  // 菜单里的快捷功能项可用（目录）
  await ev("window.__mdlCtxOpen(100,100)");
  ok(await ev("document.getElementById('mdl-ctx').hidden === false"), '功能菜单打开');
  await ev("(function(){var it=Array.from(document.querySelectorAll('#mdl-ctx .mdl-ctx-item')).filter(function(x){return /目录/.test(x.textContent);})[0]; if(it) it.click();})()");
  ok(await ev("document.getElementById('mdl-toc').classList.contains('is-hidden')") === false, '菜单点目录 → TOC 显示');

  // ── [15] 复制公式得到 LaTeX 源码 ─────────────────────────────────────────
  // pick the first rendered (non-error) equation and read its data-src
  const eqSrc = await ev("(function(){var e=document.querySelector('x-equation[data-src]'); return e ? e.getAttribute('data-src') : null;})()");
  ok(!!eqSrc, '页面有带 data-src 的公式 (' + String(eqSrc).slice(0, 30) + ')');
  // hover copy button exists
  ok(await ev("document.querySelectorAll('x-equation .mdl-eq-copy').length") >= 1, '公式上有复制按钮');
  // intercept a copy event on a selection inside the equation → clipboard holds LaTeX
  const copyLatex = await ev("(function(){var e=document.querySelector('x-equation[data-src]'); var expected=e.getAttribute('data-src'); var dt=new DataTransfer(); var hit=null; function onC(ev){hit=ev.clipboardData.getData('text/plain');} document.addEventListener('copy', onC, true); var r=document.createRange(); r.selectNodeContents(e); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); var c=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:dt}); document.dispatchEvent(c); s.removeAllRanges(); document.removeEventListener('copy', onC, true); return {expected:expected, hit:hit, defaultPrevented:c.defaultPrevented};})()");
  ok(copyLatex.defaultPrevented === true, '复制事件被拦截');
  ok(copyLatex.hit === copyLatex.expected, '选中公式复制 → 剪贴板是 LaTeX 源码（' + String(copyLatex.hit).slice(0, 30) + '）');
  // a selection spanning text + formula still copies the raw text
  const rawKept = await ev("(function(){var e=document.querySelector('x-equation[data-src]'); var p=e.parentNode; var dt=new DataTransfer(); var hit=''; function onC(ev){hit=ev.clipboardData.getData('text/plain');} document.addEventListener('copy', onC, true); var r=document.createRange(); var t=document.createTextNode('hello'); p.insertBefore(t, e); r.setStart(t,0); r.setEnd(t,5); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); var c=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:dt}); document.dispatchEvent(c); s.removeAllRanges(); t.remove(); document.removeEventListener('copy', onC, true); return {hit:hit, prevented:c.defaultPrevented};})()");
  ok(rawKept.prevented === false && rawKept.hit === '', '公式外的普通文本复制不被改写');
  // inline math also copies its source
  const inlineSrc = await ev("(function(){var e=document.querySelector('x-equation[data-src][class=\"mdl-eq\"]'); return e ? e.getAttribute('data-src') : null;})()");
  const inlineLatex = await ev("(function(){var e=document.querySelector('x-equation[data-src][class=\"mdl-eq\"]'); if(!e) return 'NONE'; var dt=new DataTransfer(); var hit=''; function onC(ev){hit=ev.clipboardData.getData('text/plain');} document.addEventListener('copy', onC, true); var r=document.createRange(); r.selectNodeContents(e); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:dt})); s.removeAllRanges(); document.removeEventListener('copy', onC, true); return hit;})()");
  if (inlineSrc) { ok(inlineLatex === inlineSrc, '行内公式复制 → LaTeX（' + String(inlineLatex).slice(0, 30) + '）'); }

  console.log('\n' + pass + ' \u2713 checks passed, ' + fail + ' failures');
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  fail++; console.log('  \u2717 测试异常: ' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  try { server.kill(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(1000);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}
