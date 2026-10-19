import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const testFile = 'test/tex-check.mjs';
if (existsSync(testFile)) { console.log('tex-check.mjs already exists'); process.exit(0); }

const content = `
// tex-check.mjs — feat14: md → LaTeX export assertions
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// load the converter directly (pure function, no browser APIs)
const { mdToLatex } = await import(new URL('../core/renderer.mjs', import.meta.url));

const md = [
  '# 一级标题',
  '',
  '## 二级标题',
  '',
  'Hello **world** and *italic* text.',
  '',
  '- item one',
  '- item two',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted text',
  '',
  '| col a | col b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '\`inline code\`',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  'E = $x^2 + y^2$',
].join('\n');

const tex = mdToLatex(md);

ok('section command', tex.includes('\section{一级标题}'));
ok('subsection command', tex.includes('\subsection{二级标题}'));
ok('textbf bold', tex.includes('\textbf{world}'));
ok('textit italic', tex.includes('\textit{italic}'));
ok('itemize list', tex.includes('\begin{itemize}'));
ok('itemize end', tex.includes('\end{itemize}'));
ok('enumerate list', tex.includes('\begin{enumerate}'));
ok('enumerate end', tex.includes('\end{enumerate}'));
ok('item command', tex.includes('\item item one'));
ok('quote env', tex.includes('\begin{quote}'));
ok('quote end', tex.includes('\end{quote}'));
ok('tabular table', tex.includes('\begin{tabular}'));
ok('hline', tex.includes('\hline'));
ok('code in texttt', tex.includes('\texttt{inline code}'));
ok('verbatim block', tex.includes('\begin{verbatim}'));
ok('verbatim content', tex.includes('const x = 1;'));
ok('math passthrough', tex.includes('\(x^2 + y^2\)') || tex.includes('x^2 + y^2'));

// empty doc
ok('empty doc → empty-ish output', mdToLatex('').trim() === '');

// mermaid → comment
const texMm = mdToLatex('\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`');
ok('mermaid → % comment', texMm.includes('% [mermaid diagram]'));
ok('mermaid source in comments', texMm.includes('%   graph TD'));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
`;
writeFileSync(testFile, content);
console.log('tex-check.mjs created:', content.length, 'chars');
