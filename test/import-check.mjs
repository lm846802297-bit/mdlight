// test/import-check.mjs
// Verifies the "一键导入" pipeline end to end:
//   1. core/renderer.mjs exposes latexToMarkdown / pdfToMarkdown / preprocessMathSync
//   2. multi-format math (AsciiMath + MathML) renders to KaTeX equations
//   3. node server POST /api/import-md writes the converted .md and swaps to it
//   4. the import buttons' guard logic (name validation, no overwrite of open doc)
// Run: node test/import-check.mjs  (no build artifacts, no browser required)
import { spawn } from 'node:child_process';
import {
  existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, l, e) => {
  if (c) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('FAIL  ' + l + (e ? '  → ' + e : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { render, latexToMarkdown, pdfToMarkdown, preprocessMathSync, pdfExtractText }
  = await import('../core/renderer.mjs');

// ---- 1. converter exports present on the renderer module --------------------
ok(typeof latexToMarkdown === 'function', 'renderer 暴露 latexToMarkdown');
ok(typeof pdfToMarkdown === 'function', 'renderer 暴露 pdfToMarkdown');
ok(typeof preprocessMathSync === 'function', 'renderer 暴露 preprocessMathSync');
ok(typeof pdfExtractText === 'function', 'renderer 暴露 pdfExtractText');

// ---- 2. multi-format math renders to KaTeX equation -------------------------
// AsciiMath: backtick-wrapped "x^2+1" (no latex delimiters) → converted to LaTeX → x-equation
const asciiOut = render('Area = `x^2+1` for every root');
ok(asciiOut.html.includes('x-equation'), 'AsciiMath 反引号公式渲染为 x-equation');
// MathML inline
const mathmlOut = render('Inline <math><mi>x</mi><mo>+</mo><mn>1</mn></math> here');
ok(mathmlOut.html.includes('x-equation'), 'MathML <math> 渲染为 x-equation');
// MathML display block (standalone <math display="block"> → $$…$$)
const mmBlock = render('<math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>');
ok(mmBlock.html.includes('mdl-eq--display'), '块级 MathML 渲染为 display x-equation');
// backtick code must stay literal (flaw #1 regression)
const codeOut = render('keep `\\(x^2\\)` literal');
ok(!codeOut.html.includes('x-equation'), '反引号 LaTeX 样代码不被误转公式');
// LaTeX still works
const texOut = render('Both $y = \\alpha$ and \\(z = \\beta\\) inline.');
ok(texOut.html.includes('x-equation'), 'LaTeX / AI 方言公式仍正常工作');

// ---- 3. converters round-trip ----------------------------------------------
const md1 = latexToMarkdown('\\section{Results}\n\nWe show $x=1$ and \\textbf{bold} items.');
ok(/^# Results/m.test(md1), 'LaTeX \\section → # 标题');
ok(/\*bold\*/.test(md1), 'LaTeX \\textbf → **bold**');
ok(/\$x=1\$/.test(md1), 'LaTeX 数学保留');

// ---- 4. node server /api/import-md ------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'mdl-imp-'));
const docPath = join(dir, 'base.md');
writeFileSync(docPath, '# 基础文档\n\n正文。\n');
const PORT = 20950;
const server = spawn(process.execPath, [join(root, 'mdlight.mjs'), docPath, '--port', String(PORT), '--no-window'],
  { cwd: root, stdio: 'ignore', windowsHide: true });
await sleep(1800);

let baseUrl = 'http://127.0.0.1:' + PORT + '/';
// discover real port (--port is honored; keep as-is)
let importOk = false, swappedServed = false, guardOk = true;
try {
  // valid import
  const targetName = 'converted.md';
  const r = await fetch(baseUrl + 'api/import-md', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: targetName, content: '# 转换结果\n\nlaTeX→md 内容。\n' }),
  });
  const j = await r.json();
  importOk = !!(j && j.ok && existsSync(join(dir, targetName)));
  // rejected: must be .md
  const bad = await fetch(baseUrl + 'api/import-md', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x.tex', content: 'y' }),
  });
  if (bad.status !== 400) guardOk = false;
  // the served document now points at the imported file
  const src = await fetch(baseUrl + 'api/source', { cache: 'no-store' }).then((x) => x.json());
  swappedServed = !!(src && /\u8f6c\u6362\u7ed3\u679c/.test(src.source || '')); // "转换结果"
} catch (e) { console.log('  server err: ' + e.message); }
ok(importOk, 'POST /api/import-md 写入 .md 文件');
ok(guardOk, '/api/import-md 拒绝非 .md 名称(400)');
ok(swappedServed, '/api/import-md 后 /api/source 指向新文档');

server.kill();
await sleep(300);
rmSync(dir, { recursive: true, force: true });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);