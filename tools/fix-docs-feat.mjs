import { readFileSync, writeFileSync } from 'node:fs';
// DESIGN.md: bump status line test count 359 + 24 -> 437 + 24 (437 = all suites including 46 feat2-check)
let d = readFileSync('DESIGN.md', 'utf8');
const oldD = '> **状态：✅ 已实现并通过全部验证（2026-10-24，v0.8.0）** — `npm test` 共 **359 + 24 项断言全绿**：';
if (d.indexOf(oldD) >= 0) {
  d = d.replace(oldD, '> **状态：✅ 已实现并通过全部验证（2026-10-24，v0.8.1）** — `npm test` 共 **437 + 24 项断言全绿**：', 1);
}
writeFileSync('DESIGN.md', d);
console.log('DESIGN updated:', d.indexOf('437 + 24') >= 0 ? 'ok' : 'anchor-miss');

// README: append the new v0.8.1 feature group to the feature table / capability list if there is one
let r = readFileSync('README.md', 'utf8');
const featBlock = [
  '',
  '### v0.8.1 新增：效率与排版增强',
  '',
  '| 功能 | 说明 |',
  '| --- | --- |',
  '| mermaid SVG 缓存 | 按 FNV-1a 内容指纹 + 主题存 localStorage，同文档二次打开图表 0 等待 |',
  '| 字体枚举 | `document.fonts.check()` 探测系统已装字体，字体下拉框优先列出可用项 |',
  '| PDF 页眉页脚宏 | 导出 PDF 支持 `{title}/{page}/{total}/{date}` 宏 + 出版级分页规则（防孤行/孤字、标题不压页尾） |',
  '| 自定义快捷键 | 集中管理面板（Ctrl+K）改任意功能键，一键恢复默认 |',
  '| 拖拽打开 | 桌面拖 .md 文件进窗口直接打开 |',
  '| 单实例 CLI 热发送 | 已运行 mdlight 时再开同一文件会转发给已有实例（Named Pipe），不另起窗口 |',
  '| 多文档标签页 | 顶栏标签条，多个 .md 并排，随时切换 |',
  '| 母版版式 | 流式 / A4 / 幻灯片 三种排版模板，设置面板切换 |',
  '| 虚拟滚动 | 超长文档（>200 块）懒渲染，滚动到才画图 |',
].join('\n');
// append to end of README (before final newlines)
const tail = r.replace(/\n*$/, '');
r = tail + '\n' + featBlock + '\n';
writeFileSync('README.md', r);
console.log('README updated:', r.indexOf('mermaid SVG 缓存') >= 0 ? 'ok' : 'fail');
