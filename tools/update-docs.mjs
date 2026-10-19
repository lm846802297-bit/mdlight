import { readFileSync, writeFileSync } from 'node:fs';

// README.md: add LaTeX export row to the keyboard shortcut table
let readme = readFileSync('README.md', 'utf8');
const anchor = '| (\u53f3\u952e\u83dc\u5355) | \u4efb\u610f\u4f4d\u7f6e\u53f3\u952e\u6253\u5f00\u5feb\u6377\u83dc\u5355\uff1a';
if (readme.indexOf('TeX') < 0 && readme.indexOf(anchor) >= 0) {
  const newLine = '| (\u62d6\u62fd / \u53cc\u51fb .md) | \u628a\u6587\u4ef6\u62d6\u8fdb\u7a97\u53e3\u6216\u53cc\u51fb\u6253\u5f00\uff0c\u81ea\u52a8\u5207\u6362\u5230\u8be5\u6587\u6863 |\n'
    + '| TeX \u6309\u94ae | \u4e00\u952e\u5c06 Markdown \u6587\u6863\u5bfc\u51fa\u4e3a LaTeX (.tex) \u6587\u4ef6\uff08\u5199\u5165\u6587\u6863\u76ee\u5f55\uff09\uff0c\u6807\u9898 \u2192 \section\u3001\u8868\u683c \u2192 tabular\u3001\u4ee3\u7801 \u2192 verbatim\u3001\u516c\u5f0f\u901a\u8fc7\u3001mermaid \u2192 \u6ce8\u91ca |\n';
  readme = readme.replace(anchor, newLine + anchor);
  writeFileSync('README.md', readme);
  console.log('README: TeX export row added');
}

// DESIGN.md: add feat14 section
let design = readFileSync('DESIGN.md', 'utf8');
if (design.indexOf('mdToLatex') < 0) {
  const feat14 = '\n## feat14: Markdown \u2192 LaTeX \u5bfc\u51fa\n\n'
    + '### \u80cc\u666f\n'
    + '\u7528\u6237\u9700\u8981\u5c06 mdlight \u9884\u89c8\u7684 Markdown \u6587\u6863\u76f4\u63a5\u5bfc\u51fa\u4e3a\u53ef\u7f16\u8bd1\u7684 .tex \u6587\u4ef6\u3002\n\n'
    + '### \u5b9e\u73b0\n'
    + '`core/renderer.mjs` \u589e\u52a0 `mdToLatex(src)` \u7eaf\u51fd\u6570\uff1a\n'
    + '- \u6807\u9898 \u2192 \section / \subsection / \subsubsection\n'
    + '- **bold** / *italic* / `code` / ~~strike~~ \u2192 \textbf / \textit / \texttt / \u7eaf\u6587\u672c\n'
    + '- \u8868\u683c \u2192 \begin{tabular} + \hline\n'
    + '- \u76ee\u5f55\u5217\u8868 \u2192 \begin{itemize} / \begin{enumerate}\n'
    + '- \u5f15\u7528 \u2192 \begin{quote}\n'
    + '- \u56fe\u7247 \u2192 \includegraphics[width=\linewidth]\n'
    + '- \u4ee3\u7801\u5757 \u2192 \begin{verbatim}\n'
    + '- $math$ \u901a\u8fc7\u3001[link](url) \u2192 \href\n'
    + '- mermaid \u56fe \u2192 % \u6ce8\u91ca\u5757\n\n'
    + '\u5ba2\u6237\u7aef\u6d41\u7a0b\uff1aTeX \u6309\u94ae \u2192 fetch /api/source \u2192 mdToLatex() \u2192 POST /api/export-latex?name=X.tex \u2192 \u670d\u52a1\u7aef\u5199\u5199\u6587\u6863\u76ee\u5f55\u3002\n'
    + '\u5355\u4e00\u6587\u4ef6\u5bfc\u51fa\u573a\u666f\uff08\u65e0\u670d\u52a1\u5668\uff09\u65f6 TeX \u6309\u94ae\u663e\u793a no-service \u63d0\u793a\u3002\n';
  design += feat14;
  writeFileSync('DESIGN.md', design);
  console.log('DESIGN.md: feat14 section added');
}
