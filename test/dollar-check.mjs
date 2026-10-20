// test/dollar-check.mjs — inline $…$ pairing must be STRICT.
//
// A single stray $ (an author typo `\)` written where `$` was meant, a currency amount,
// a lone opener) used to pair with the NEXT $ far away and swallow a whole slice of
// Chinese prose into one giant 公式渲染失败 card. Failing to pair must now degrade to
// literal text, never a card.
//
// Also covers the two real-world repairs found while fixing that:
//   * inside $$…$$ a backtick is math text, not markdown code — pandoc writes EVERY
//     command as `\cmd`{=tex}, and converting those to $…$ injected nested $ into KaTeX
//   * docs mangled by a converter that ate the backslash of \begin/\frac/\to
//     (leaving 0x08/0x0C/0x09) must still render
import { render } from '../core/renderer.mjs';

let pass = 0, fail = 0;
const ok = (c, l, extra) => {
  if (c) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('FAIL  ' + l + (extra ? '\n      ' + extra : '')); }
};
const eq = (h) => (h.match(/<x-equation/g) || []).length;
const cards = (h) => (h.match(/<div class="mdl-math-error">/g) || []).length;
const R = (s) => render(s).html;

console.log('A. unpaired $ never becomes a giant prose card');
// the two shapes actually found in the user's physics docs
const proseSwallow = '双传播子项给出 $ (m_i^2+m_j^2-p^2)B_0/2$。这两个质量平方项不能遗漏。若分子是 $k^2$ 而不是 $k\\cdot(k+p)$，应先写';
const typo = '逐项乘以 $J_p\\)。对 16 条路径逐一套用同一公式，即已把原始的 $16\\times6$ 个三维积分';
ok(cards(R(proseSwallow)) === 0, 'prose with a stray $ produces no error card', R(proseSwallow).slice(0, 200));
ok(cards(R(typo)) === 0, 'author typo \\) where $ was meant produces no error card', R(typo).slice(0, 200));
ok(!/不能遗漏/.test(R(typo)), 'prose is never swallowed into a math body');
ok(R('一个字 $ 没有闭合，后面还有 $ 另一个').indexOf('mdl-math-error') === -1, 'a lone $ stays literal');

console.log('B. legitimate math with a space after the opener still renders');
const spaced = '给出 $ (m_i^2+m_j^2-p^2)B_0/2$ 这一项';
ok(cards(R(spaced)) === 0, 'no card');
ok(eq(R(spaced)) === 1, 'renders as one equation', R(spaced).slice(0, 300));
ok(eq(R('设 $x^2+y^2=r^2$ 为单位圆')) === 1, 'plain inline math still renders');
ok(eq(R('若分子是 $k^2$ 而不是 $k\\cdot(k+p)$，应先写')) === 2, 'two proper spans in CJK prose render');

console.log('C. currency is not math');
ok(eq(R('costs 5$ to 10$ dollars, 50\u00a5 and 100\u00a5 too')) === 0, 'trailing-amount prices stay text');
ok(eq(R('$100 和 $10')) === 0, 'leading-amount prices stay text');
ok(eq(R('it costs $100 and $10 total')) === 0, 'english currency stays text');
ok(eq(R('价格 \\$5 和 \\$9 结束')) === 0, 'escaped \\$ stays literal');

console.log('D. 中文夹心 is preserved (CJK inside math auto-wraps to \\text)');
ok(eq(R('中文夹心 $中文$ 应自动包 \\text。')) === 1, '$中文$ still renders as math');
ok(eq(R('中文公式 $其中 a=1$ 测试')) === 1, 'CJK plus ascii math still renders');
ok(eq(R('$\\text{质量}$ 守恒')) === 1, 'explicit \\text{中文} still renders');
// but real sentence punctuation at top level means the span was prose, not math
ok(cards(R('$这是一整句话。$')) === 0, 'a CJK sentence with 。 is not treated as math');

console.log('E. display math stays lenient');
const disp = '$$\n\\begin{aligned} L &= \\frac{1}{2}\\rho v^2 S \\\\ &= mv^2\\end{aligned}\n$$';
ok(eq(R(disp)) === 1 && cards(R(disp)) === 0, 'multi-line aligned display math still renders');
ok(eq(R('$$a^2+b^2$$')) === 1, 'single-line display math still renders');
ok(eq(R('$$\n\\newcommand{\\RR}{\\mathbb{R}}\n$$')) === 0, 'definition-only display block emits nothing');

console.log('F. pandoc `\\cmd`{=tex} raw inlines');
const pandoc = '$$\n`\\frac{|\\delta\\Pi|}{m_h^2}`{=tex}\n=`\\frac{0.16835}{(125.25)^2}`{=tex}\n`\\simeq1.073`{=tex}`\\times10`{=tex}\\^{-5}.\n$$';
const ph = R(pandoc);
ok(cards(ph) === 0, 'pandoc {=tex} inside a display block produces no card', ph.slice(0, 300));
ok(eq(ph) === 1, 'and still renders as one display equation');
ok(!/data-src="[^"]*`/.test(ph), 'no backtick is handed to KaTeX');
ok(eq(R('正文里的 `\\mathrm{Tr}`{=tex} 与 `x^2` 都渲染')) === 2, 'a {=tex} raw inline in prose still becomes math');

console.log('G. docs mangled by a lost backslash are repaired');
const bs = '$$A_h=' + String.fromCharCode(8) + 'egin{pmatrix}0&1\\\\1&0\\end{pmatrix}$$';
const ff = '$$r=' + String.fromCharCode(12) + 'rac ab$$';
const tb = '$$\\lim_{r' + String.fromCharCode(9) + 'o1}' + String.fromCharCode(12) + 'rac{r\\ln r}{r-1}$$';
ok(cards(R(bs)) === 0 && eq(R(bs)) === 1, '0x08 restores \\b (\\begin)', R(bs).slice(0, 200));
ok(cards(R(ff)) === 0 && eq(R(ff)) === 1, '0x0C restores \\f (\\frac)', R(ff).slice(0, 200));
ok(cards(R(tb)) === 0 && eq(R(tb)) === 1, '0x09/0x0C restore \\t and \\f (\\to, \\frac)', R(tb).slice(0, 200));
ok(eq(R('$$\\begin{aligned}a&=b\\\\c&=d\\end{aligned}$$')) === 1, 'real newlines/lines are untouched');

console.log('H. no regression in the ordinary cases');
ok(eq(R('行内 $x^2+y^2=z^2$ 公式')) === 1, 'plain inline math');
ok(eq(R('$$E = mc^2$$')) === 1, 'plain display math');
ok(eq(R('`$x$` and `\\(y\\)`')) === 0, 'code spans stay code');
ok(R('```js\nconst price = a$b;\n```').indexOf('x-equation') === -1, 'fenced code is untouched');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
