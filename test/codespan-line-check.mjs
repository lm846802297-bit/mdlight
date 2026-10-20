// test/codespan-line-check.mjs
//
// 自足测试脚本：`node test/codespan-line-check.mjs` 直接可跑，不依赖构建产物。
//
// 覆盖：`core/mathfmts.mjs` 反引号配对的**行内限定**（回归）。
//
// 背景：`convertBackticks()` 在 markdown-it 之前扫描整篇源文，过去允许
//       等长反引号串跨行配对。正文里任何一个落单反引号都会让它之后的所有
//       配对整体错位，拼出一个跨行的“代码跨度”；一旦它看起来像数学就会被
//       改写成 `$…$`，于是下一行（甚至 `### 标题`）被吞进公式里：
//         <h3 id="实现…">实现$core/renderer.mjs<code>增加</code>mdToLatex(src)` 纯函数：</h3>
//       同时目录会出现一条乱条目。修复后闭合必须出现在同一行内。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../core/renderer.mjs';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  ok  ' + name);
  } else {
    failed += 1;
    failures.push(name + (extra ? ' — ' + extra : ''));
    console.log('  ✗   ' + name + (extra ? ' — ' + extra : ''));
  }
}

function html(src) {
  const out = render(src);
  return typeof out === 'string' ? out : out.html;
}

console.log('A. 代码跨度不得吞掉下一行');
{
  const h = html('### 实现\n`core/renderer.mjs` 增加 `mdToLatex(src)` 纯函数：\n');
  ok('h3 内容是干净的“实现”', /<h3[^>]*>实现<\/h3>/.test(h), h.match(/<h3[^>]*>[\s\S]*?<\/h3>/)?.[0]);
  ok('正文段落独立存在', /mdToLatex\(src\)/.test(h.replace(/<[^>]+>/g, '')));
  ok('没有任何 h3 含 mdToLatex', !/<h3[^>]*>[^<]*mdToLatex/.test(h));
  ok('没有漏出裸反引号', !/<h3[^>]*>[^<]*`/.test(h));
}

console.log('B. 落单反引号不应让后面的配对整体错位');
{
  const h = html('正文里有一个落单的反引号 ` 结束。\n\n### 实现\n`core/renderer.mjs` 增加。\n');
  ok('h3 仍然是“实现”', /<h3[^>]*>实现<\/h3>/.test(h), h.match(/<h3[^>]*>[\s\S]*?<\/h3>/)?.[0]);
  ok('后面的行内代码仍然成码', /<code>core\/renderer\.mjs<\/code>/.test(h));
}

console.log('C. 合法的“反引号里包三个反引号”写法保持代码');
{
  const h = html('说明：` ```mermaid ` 表示按需加载。\n下一行是普通文字。\n');
  ok('跨度保持为代码', /<code>```mermaid<\/code>/.test(h), h.match(/<code>[\s\S]*?<\/code>/)?.[0]);
  ok('下一行没有被吞进代码/公式', /下一行是普通文字/.test(h.replace(/<[^>]+>/g, '')));
  ok('没有公式错误卡片', !/<div class="mdl-math-error">/.test(h));
}

console.log('D. 跨行“像数学”的反引号内容不得被改写成公式');
{
  const h = html('前文 `x^2\n第二行 y` 后文。\n');
  ok('没有生成公式', !/<x-equation/.test(h), h);
  ok('没有错误卡片', !/<div class="mdl-math-error">/.test(h));
  ok('第二行仍在文档中', h.includes('第二行 y'), h);
}

console.log('E. 整个仓库的 DESIGN.md 必须干净');
{
  const doc = path.join(root, 'DESIGN.md');
  if (fs.existsSync(doc)) {
    const h = html(fs.readFileSync(doc, 'utf8'));
    ok('DESIGN.md 无公式错误卡片', !/<div class="mdl-math-error">/.test(h));
    ok('标题“实现”独立成行', /<h3[^>]*>实现<\/h3>/.test(h), h.match(/<h3[^>]*>[\s\S]{0,120}?<\/h3>/g)?.join(' | '));
    ok('每个 ### 都成为独立 h3', (h.match(/<h3/g) || []).length === (fs.readFileSync(doc, 'utf8').match(/^### /gm) || []).length);
    ok('没有控制字符漏进渲染结果', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(h));
  } else {
    console.log('  SKIP (DESIGN.md not found)');
  }
}

console.log('F. 反引号内容仍然可以正常变成公式');
{
  const h = html('函数 `sqrt(x)` 与 `x^2` 都应该渲染。\n');
  ok('两条都渲染为公式', (h.match(/<x-equation/g) || []).length === 2, h);
  ok('无错误卡片', !/<div class="mdl-math-error">/.test(h));
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('failures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
