// test/mathroute-check.mjs
//
// 自足测试脚本：`node test/mathroute-check.mjs` 直接可跑，不依赖构建产物。
//
// 覆盖：反引号代码 → AsciiMath 的错误路由（回归）。
// 规则：反引号代码段要么保持代码，要么转成能渲染的公式，
//       绝不允许产出 `公式渲染失败` 卡片（<div class="mdl-math-error">）。
//
// 背景：`core/mathfmts.mjs` 的 MATH_SIGNAL 曾把 `^ + * = < > / : \` 等
// 普通代码符号当作数学信号，于是 `^x^`、`a^b^c`、`x^^2`、`npm run a && b`、
// `C:\path`、`\s` 这类行内代码被塞给 asciimath-to-latex + KaTeX，渲染成
// “公式渲染失败”卡片。修复后这些一律保持代码。

import fs from 'node:fs';
import { render } from '../core/renderer.mjs';
import { latexLooksBroken } from '../core/mathfmts.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; failures.push(`\n  [FAIL] ${label}`); }
  return cond;
}

const ERROR_CARD = /<div class="mdl-math-error">/g;
const EQUATION = /<x-equation\b/;

function cardCount(html) {
  return (html.match(ERROR_CARD) || []).length;
}

/** 渲染一段行内代码（包在散文里，更接近真实文档） */
function renderSpan(code) {
  return render('前文 `' + code + '` 后文。').html;
}

/** 断言：该行内代码保持为代码，且不产生错误卡片 */
function expectCode(code, label) {
  const html = renderSpan(code);
  const n = cardCount(html);
  ok(n === 0, `${label}：不得出现 mdl-math-error（实际 ${n} 个），src=\`${code}\``);
  const escaped = code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const re = new RegExp('<code[^>]*>\\s*' + escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</code>');
  ok(re.test(html), `${label}：应原样渲染为 <code>${code}</code>`);
  ok(!EQUATION.test(html), `${label}：不应被当作公式（不得出现 x-equation）`);
}

/** 断言：该行内代码仍被路由为数学并渲染成公式 */
function expectMath(code, label) {
  const html = renderSpan(code);
  const n = cardCount(html);
  ok(n === 0, `${label}：不得出现 mdl-math-error（实际 ${n} 个），src=\`${code}\``);
  ok(EQUATION.test(html), `${label}：应仍然渲染为公式（x-equation），src=\`${code}\``);
}

/* ------------------------------------------------------------------
 * 1) 回归表：全部误判为公式的普通行内代码（任务描述里的每一行）
 * ------------------------------------------------------------------ */
console.log('\n[1] 反引号误判为公式的回归用例');
expectCode('^x^', '以 ^ 开头');
expectCode('_x', '以 _ 开头');
expectCode('a^b^c', '重复上标');
expectCode('x^^2', '连续上标算子');
expectCode('X_1_2', '重复下标');
expectCode('\\s', 'LaTeX 转义（\\s）');
expectCode('\\n', 'LaTeX 转义（\\n）');
/* 裸宏名（pandoc `` `\bar`{=tex} `` 形态的代码段内容）：整段只有一个宏名、没有参数 */
expectCode('\\bar', '裸宏名（\\bar）');
expectCode('\\mathcal', '裸宏名（\\mathcal）');
expectCode('\\frac', '裸宏名（\\frac）');
expectCode('\\sqrt', '裸宏名（\\sqrt）');
expectCode('\\mathrm', '裸宏名（\\mathrm）');
// pandoc raw-inline `` `\Delta`{=tex} `` 的代码段内容也是裸宏名；按“路由不确定
// 时优先保留代码”的规则退化为字面代码（不是错误卡片）。
expectCode('\\Delta', '裸宏名（\\Delta）');
/* 语料实测：裸函数宏直接当上标（x^\max），KaTeX 报
   "Got function '\max' with no arguments as superscript" */
expectCode('m_S,λ_S^max', '裸函数宏作上标');
expectCode('λ_S^max=4π', '裸函数宏作上标（带等号）');
/* 语料实测：AsciiMath/LaTeX 混写，转换器把 `_\mu` 转义成 `_\\mu` → KaTeX 报错 */
expectCode('U_A(1)_{L_\\mu-L_\\tau}', '下标组内混用 LaTeX 反斜杠');
expectCode('--examplepath="C:\\myfolder\\env=x64"', 'Windows 路径 + 引号');
expectCode('C:\\Users\\me\\file.txt', 'Windows 盘符路径');
expectCode('npm run build:mermaid && npm run build && npm run build:native', 'shell && 命令');

/* 同一类里再多补几个真实的“文档里常见代码”，确认不会回退 */
console.log('\n[2] 其它常见行内代码（不得成为公式）');
expectCode('some_var', '代码标识符');
expectCode('hello', '纯单词');
expectCode('core/mathfmts.mjs', '含斜杠的路径');
expectCode('src/foo.js', '含斜杠的相对路径');
expectCode('a/b.js', '带扩展名的路径');
expectCode('i++', '自增表达式');
expectCode('--flag=value', '命令行选项');
expectCode('git commit -m "x"', '带引号的命令');

/* ------------------------------------------------------------------
 * 3) 正向：这些必须继续被当作 AsciiMath
 * ------------------------------------------------------------------ */
console.log('\n[3] 正向：AsciiMath 仍须渲染为公式');
expectMath('x^2', '上标');
expectMath('x^2+1', '上标表达式');
expectMath('sqrt(x)', 'sqrt 函数');
expectMath('a/b', '最简分数');
expectMath('12/5', '数字分数');
expectMath('alpha', '希腊字母');
expectMath('sum_(i=1)^n i', 'sum + 上下标');
expectMath('a+b', '加法');
expectMath('a * b * 2', '乘法（转 \\cdot）');
expectMath('x <= y', 'AsciiMath 比较运算符（≤）');
expectMath('a != b', 'AsciiMath 不等运算符（≠）');
/* 带参数的 LaTeX 宏：完整表达式，不得因为“含反斜杠”就被一刀切当代码 */
expectMath('\\bar{L}', '带参数的宏（\\bar{L}）');
expectMath('\\mathrm{Tr}', '带参数的宏（\\mathrm{Tr}）');
expectMath('\\frac{a}{b}', '带参数的宏（\\frac{a}{b}）');
expectMath('\\slashed k', '带参数的宏（\\slashed k）');

/* 块级 ``asciimath:`` 前置标注（双反引号 / 行内三反引号） */
console.log('\n[4] 块级 asciimath: 形式仍须渲染');
for (const src of ['``asciimath:x^2+1``', '```asciimath:x^2+1```']) {
  const html = render(src).html;
  ok(cardCount(html) === 0, `块级 ${src}：不得出现错误卡片`);
  ok(EQUATION.test(html), `块级 ${src}：应渲染为公式`);
}
/* 多行 fenced 代码块仍保持代码，不得被当公式 */
{
  const html = render('```asciimath:\nx^2+1\n```').html;
  ok(cardCount(html) === 0, '多行 fenced 代码块：不得出现错误卡片');
  ok(/mdl-code/.test(html), '多行 fenced 代码块：应保持代码块');
}

/* ------------------------------------------------------------------
 * 5) 兜底闸：latexLooksBroken 结构自检
 * ------------------------------------------------------------------ */
console.log('\n[5] latexLooksBroken 结构自检');
const broken = ['', '   ', '^x', '_x', 'x^^2', 'x^', 'a^{b}^c', 'x_1_2', 'a^b^c', '{x', 'x}'];
const fine = ['x^{2}', '\\frac{a}{b}', '\\alpha', 'x_{i}^{2}', '\\sum_{i=1}^{n} i', 'a+b', '\\sqrt{x}'];
for (const s of broken) ok(latexLooksBroken(s) === true, `latexLooksBroken(${JSON.stringify(s)}) 应为 true`);
for (const s of fine) ok(latexLooksBroken(s) === false, `latexLooksBroken(${JSON.stringify(s)}) 应为 false`);

/* ------------------------------------------------------------------
 * 6) 全量兜底：一批“代码味”片段逐个渲染，任何一个出现卡片即失败
 * ------------------------------------------------------------------ */
console.log('\n[6] 批量兜底扫描：任何反引号代码都不得产生错误卡片');
const bulk = [
  '^', '^^', '_', '__', 'a^', 'a_', '^^x', 'x^_2',
  'foo(bar) && baz()', 'if (a) { b(); }', 'a || b',
  '#include <stdio.h>', 'SELECT * FROM t;', 'x = y = z',
  'print("hi")', 'ls -la /tmp', 'echo $HOME', 'curl -X POST http://x/y',
  'user@host:~$ ls', 'TODO: fix this', '2 < 3 > 1', 'a != b',
  'path/to/file', './script.sh', 'make -j4', 'docker run -it img',
];
for (const code of bulk) {
  const html = renderSpan(code);
  ok(cardCount(html) === 0, `兜底：\`${code}\` 不得出现错误卡片`);
}

/* ------------------------------------------------------------------
 * 7) 真实文档：DESIGN.md 必须零错误卡片
 * ------------------------------------------------------------------ */
console.log('\n[7] DESIGN.md 渲染不得出现错误卡片');
{
  const md = fs.readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
  const html = render(md).html;
  const n = cardCount(html);
  ok(n === 0, `DESIGN.md 应零错误卡片，实际 ${n} 个`);
  ok(/<code[^>]*>\s*\^x\^\s*<\/code>/.test(html), 'DESIGN.md 的 `^x^` 应渲染为代码');
}

console.log(`\n==== 结果：${passed} passed, ${failed} failed ====`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓（无公式渲染失败卡片）');
}
