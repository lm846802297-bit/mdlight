import { readFileSync, writeFileSync } from 'node:fs';
let readme = readFileSync('README.md', 'utf8');
// Add LaTeX export to the line 94 area (list of context menu actions)
const anchor = '源码视图 `Ctrl+E`、直接编辑 `Ctrl+Shift+E`、外部编辑器 `F2`、打印 `Ctrl+P`、导出 CSV、导出 PDF、';
if (readme.indexOf(anchor) >= 0 && readme.indexOf('TeX') < 0) {
  readme = readme.replace(anchor, anchor + '导出 LaTeX (.tex)、');
  writeFileSync('README.md', readme);
  console.log('README: TeX added to ctx menu list');
}
// Also add to keyboard shortcut table after the right-click row
const ctxRow = '| （右键菜单） |';
if (readme.indexOf(ctxRow) >= 0) {
  const lines = readme.split('\n');
  const idx = lines.findIndex(l => l.startsWith(ctxRow));
  if (idx >= 0) {
    const texRow = '| TeX 按钮 | 一键将 Markdown 导出为 LaTeX (.tex)，标题 → \section、表格 → tabular、代码 → verbatim、公式通过、mermaid → 注释 |';
    lines.splice(idx + 1, 0, texRow);
    writeFileSync('README.md', lines.join('\n'));
    console.log('README: TeX shortcut row inserted');
  }
}
