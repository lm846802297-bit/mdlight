import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');
// The IIFE parameter named `t` shadows the module-level i18n t() function.
// Rename the IIFE parameters to `tab` and `idx`.
const old = "    for (var i = 0; i < openTabs.length; i++) {\n      (function (t, idx) {";
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
s = s.replace(old, "    for (var i = 0; i < openTabs.length; i++) {\n      (function (tab, idx) {", 1);
// Now rename the `t.` and `t(` references inside that block to tab./tab(
// The block is from "(function (tab, idx) {" to the matching "})(" of the IIFE.
const blockStart = s.indexOf('(function (tab, idx) {');
// find the closing "      })(openTabs[i], i);"
const blockEnd = s.indexOf('})(openTabs[i], i);');
if (blockEnd < 0) { console.log('block end not found'); process.exit(1); }
const block = s.slice(blockStart, blockEnd + '})(openTabs[i], i);'.length);
const fixedBlock = block
  .replace(/t\.active/g, 'tab.active')
  .replace(/t\.name/g, 'tab.name')
  .replace(/t\.path/g, 'tab.path')
  .replace(/tabPath\(t\)/g, 'tabPath(tab)')
  .replace(/close\.title = t\(/, "close.title = t2("); // placeholder, we'll fix below
// Actually simpler: within the block, `t(` is the shadowed variable; replace only the i18n call
s = s.slice(0, blockStart) + block.replace("close.title = t('tab-close', '关闭');", "close.title = t('tab-close', '关闭');") + s.slice(blockEnd + '})(openTabs[i], i);'.length);
// Wait — inside the block, `t` IS the tab. We need to call the outer i18n function.
// The outer i18n function is also named `t` (line 14). So the IIFE must NOT shadow it.
// Since we renamed the param to `tab`, the `t('tab-close'...)` inside now refers to the OUTER t. Correct!
// But we also need to replace t. / t.name / t.active / tabPath(t) inside the block with tab.*
const block2 = s.slice(s.indexOf('(function (tab, idx) {'), s.indexOf('})(openTabs[i], i);') + '})(openTabs[i], i);'.length);
const block3 = block2
  .replace(/(?<![\w.])t\.active/g, 'tab.active')
  .replace(/(?<![\w.])t\.name/g, 'tab.name')
  .replace(/tabPath\((?<!tab\.)tab\)/g, 'tabPath(tab)')
  .replace(/tabPath\(tab\)/g, 'tabPath(tab)');
// Simpler and safer: do targeted replaces in the known block
s = s.replace("        el.title = tabPath(t);", "        el.title = tabPath(tab);");
s = s.replace("        label.textContent = t.name || (tabPath(t).split('/').pop() || t.name || 'untitled');",
              "        label.textContent = tab.name || (tabPath(tab).split('/').pop() || tab.name || 'untitled');");
s = s.replace("        el.className = 'mdl-tab' + (t.active ? ' mdl-tab-active' : '');",
              "        el.className = 'mdl-tab' + (tab.active ? ' mdl-tab-active' : '');");
writeFileSync('ui/app.js', s);
console.log('fix-tab-shadow done');
