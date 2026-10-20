// test/upstream-check.mjs — the inline mark syntax advertised in DESIGN.md.
//
// DESIGN.md documented 上标 `^x^`, 下标 `~x~`, 插入 `++x++`, 标记 `==x==`, but only the
// serializer (ui/mdserial.js) implemented them — the renderer produced none of them, so
// content silently lost its semantics on save. This suite locks in the renderer side.
//
// 上标 `^x^` is deliberately NOT implemented: in the sample physics corpus "^" is an
// ordinary superscript character in prose ("(p^2=m_h^2)", "10^-5") — 32 such pairs were
// measured — so a "^…^" delimiter would corrupt them. See DESIGN.md.
import { render } from '../core/renderer.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, l, extra) => {
  if (c) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('FAIL  ' + l + (extra ? '\n      ' + extra : '')); }
};
const R = (s) => render(s).html;
const cards = (h) => (h.match(/<div class="mdl-math-error">/g) || []).length;

console.log('A. the three syntaxes render');
ok(R('H~2~O').includes('<sub class="mdl-sub">2</sub>'), '~x~ -> <sub class="mdl-sub">', R('H~2~O'));
ok(R('a ++新增++ b'.replace('新增', 'new')).includes('<ins class="mdl-ins">new</ins>'), '++x++ -> <ins class="mdl-ins">', R('a ++new++ b'));
ok(R('a ==hot== b').includes('<mark class="mdl-mark">hot</mark>'), '==x== -> <mark class="mdl-mark">', R('a ==hot== b'));
ok(R('H~2~O 与 ==x== 与 ++y++').match(/mdl-sub|mdl-ins|mdl-mark/g).length === 3, 'all three coexist in one line');
ok(cards(R('H~2~O ==x== ++y++')) === 0, 'none of them can produce an error card');

console.log('B. the strict content guard keeps ordinary prose safe');
const literal = (s) => !/mdl-sub|mdl-ins|mdl-mark/.test(R(s));
ok(literal('~a b~'), 'whitespace inside ~…~ is not a token');
ok(literal('==a b=='), 'whitespace inside ==…== is not a token');
ok(literal('~中文~'), 'CJK inside ~…~ is not a token');
ok(literal('==中文=='), 'CJK inside ==…== is not a token');
ok(literal('~' + 'a'.repeat(41) + '~'), 'content longer than 40 chars is not a token');
ok(literal('~a=b~'), '= inside ~…~ is not a token');
ok(R('~i/j~').includes('<sub class="mdl-sub">i/j</sub>'), 'a plain subscript like ~i/j~ is allowed');
ok(literal('~a(b)~'), 'parentheses/backticks/carets/brackets are rejected');
ok(literal('~a|b~'), 'a table pipe is rejected (would break the table)');
ok(literal('a ~ b ~ c'), 'spaced tildes stay text');
ok(literal('~~struck~~'), 'a double tilde is not consumed by the sub rule');
ok(R('~~struck~~').includes('<s>struck</s>'), '~~x~~ still renders as <s> (strikethrough wins)');
ok(literal('~unclosed'), 'an unclosed ~ stays literal');
ok(literal('==unclosed'), 'an unclosed == stays literal');

console.log('C. code and math are untouched');
ok(R('`~x~`').includes('<code>~x~</code>'), 'inline code keeps ~x~ literal');
ok(R('```\n==x== ++y++\n```').indexOf('mdl-mark') === -1, 'a fenced block is never rewritten');
ok(R('$a~b$').includes('x-equation'), 'a math span still wins over the sub rule');
ok(R('$x^2$').includes('x-equation'), 'math is unaffected');
ok(!/mdl-sub|mdl-ins|mdl-mark/.test(R('$a~b$')), 'no mark token leaks out of math');

console.log('D. 上标 ^x^ is NOT implemented (the source of the original bug report)');
ok(!/mdl-sup/.test(R('^x^')), '^x^ is not promoted to <sup>');
ok(cards(R('^x^')) === 0, '^x^ produces no 公式渲染失败 card');
ok(cards(R('`^x^`')) === 0, 'the code span `^x^` produces no card');
ok(R('`^x^`').includes('<code>^x^</code>'), 'the code span `^x^` stays code');
ok(!/mdl-sup/.test(R('(p^2=m_h^2) 与 10^-5')), 'prose superscripts are left alone', R('(p^2=m_h^2) 与 10^-5'));
ok(R('(p^2=m_h^2)').includes('p^2=m_h^2'), 'the raw text of (p^2=m_h^2) survives byte for byte');

console.log('E. renderer <-> serializer round-trip contract');
const serial = readFileSync(join(ROOT, 'ui', 'mdserial.js'), 'utf8');
ok(/case 'sub': return '~'/.test(serial), 'serializer emits ~x~ for <sub>');
ok(/case 'ins': return '\+\+'/.test(serial), 'serializer emits ++x++ for <ins>');
ok(/case 'mark': return '=='/.test(serial), 'serializer emits ==x== for <mark>');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
