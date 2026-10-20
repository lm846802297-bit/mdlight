// probe: what does each candidate source render to? report math error cards.
import { render } from '../core/renderer.mjs';

const cases = [
  ['plain ^x^ text', '这是上标 ^x^ 说明。'],
  ['backtick ^x^', '这是上标 `^x^` 说明。'],
  ['dollar ^x^', '这是 $^x^$ 说明。'],
  ['display ^x^', '$$^x^$$'],
  ['pandoc 2^10^', '结果是 2^10^ 次方。'],
  ['backtick x^2', '公式 `x^2` 结束。'],
  ['backtick a^b^c', '公式 `a^b^c` 结束。'],
  ['backtick x^^2', '公式 `x^^2` 结束。'],
  ['backtick hat', '公式 `hat x` 结束。'],
  ['insert ++x++', '插入 ++x++ 结束。'],
  ['mark ==x==', '标记 ==x== 结束。'],
  ['wikilink [[x]]', '链接 [[x]] 结束。'],
  ['math then sup', '先 $a$ 再 ^x^ 结束。'],
  ['two dollars', '成本 $100 和 $10。'],
  ['stray dollar + caret', '价格 $ ^x^ 结束'],
];

for (const [name, src] of cases) {
  let out;
  try { out = render(src); } catch (e) { console.log('THROW  ' + name + '  → ' + e.message); continue; }
  const re = /<div class="mdl-math-error">[\s\S]*?mdl-math-error-msg">([\s\S]*?)<\/span><\/div><pre class="mdl-math-error-src">([\s\S]*?)<\/pre>/g;
  const hits = []; let m;
  while ((m = re.exec(out.html))) hits.push(m[1] + '  <<SRC=' + m[2] + '>>');
  const sup = /<sup>/.test(out.html) ? ' [has <sup>]' : '';
  console.log((hits.length ? 'ERR    ' : 'ok     ') + name + sup + (hits.length ? '\n         ' + hits.join('\n         ') : ''));
}
