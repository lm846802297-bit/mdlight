#!/usr/bin/env node
// feat4b: shortcut panel CSS + topbar button + i18n keys
const { readFileSync, writeFileSync, appendFileSync } = await import('node:fs');

// ---- CSS
let css = readFileSync('ui/app.css', 'utf8');
const scCss = [
  "",
  "/* ---- custom shortcut panel (Ctrl+K) ---- */",
  ".mdl-sc-panel {",
  "  position: fixed; top: 44px; right: 12px; z-index: 900;",
  "  min-width: 220px; max-width: 320px;",
  "  background: var(--mdl-bg, #fff); color: var(--mdl-fg, #222);",
  "  border: 1px solid var(--mdl-border, #ddd); border-radius: 6px;",
  "  box-shadow: 0 4px 16px rgba(0,0,0,.12); padding: 10px 14px;",
  "  font-family: var(--mdl-mono, Consolas), monospace; font-size: 12px;",
  "}",
  ".mdl-sc-row { display: flex; justify-content: space-between; gap: 16px; padding: 2px 0; }",
  ".mdl-sc-lbl { opacity: .75; }",
  ".mdl-sc-val { font-weight: 600; }",
  ".mdl-sc-btns { margin-top: 8px; display: flex; gap: 8px; }",
  ".mdl-sc-btns .mdl-btn { cursor: pointer; }",
].join('\n');
if (css.indexOf('.mdl-sc-panel') < 0) {
  appendFileSync('ui/app.css', scCss + '\n');
  console.log('CSS appended');
} else {
  console.log('CSS already present, skipping');
}

// ---- index.html: add Ctrl+K hint to the settings button title
let html = readFileSync('ui/index.html', 'utf8');
if (html.indexOf('mdl-sc-panel') < 0 && html.indexOf('title="设置"') > 0) {
  html = html.replace(
    'id="mdl-btn-settings" title="设置"',
    'id="mdl-btn-settings" title="设置 (Ctrl+K)"'
  );
  writeFileSync('ui/index.html', html);
  console.log('index.html updated');
}

// ---- i18n.js: add shortcut panel keys
let i18n = readFileSync('ui/i18n.js', 'utf8');
if (i18n.indexOf("'sc-reset'") < 0) {
  // insert before the closing of the zh-CN object — look for the last closing brace pattern
  const anchor = "  },";
  // safer: just append keys inside both language objects by finding unique existing keys
  const zhAnchor = "'marp-ready': '检测到 Marp 幻灯片（{n} 页），按 F5 放映'";
  const enAnchor = "'marp-ready': 'Detected Marp slides ({n} pages). Press F5 to present'";
  if (i18n.indexOf(zhAnchor) >= 0) {
    i18n = i18n.replace(zhAnchor, zhAnchor + ",\n" +
      "      'sc-reset': '恢复默认',\n" +
      "      'sc-reset-done': '已恢复默认快捷键',\n" +
      "      'sc-close': '关闭'");
    console.log('zh-CN sc keys added');
  }
  if (i18n.indexOf(enAnchor) >= 0) {
    i18n = i18n.replace(enAnchor, enAnchor + ",\n" +
      "      'sc-reset': 'Reset to defaults',\n" +
      "      'sc-reset-done': 'Shortcuts reset',\n" +
      "      'sc-close': 'Close'");
    console.log('en-US sc keys added');
  }
  writeFileSync('ui/i18n.js', i18n);
} else {
  console.log('i18n sc keys already present');
}

console.log('feat4b done');
