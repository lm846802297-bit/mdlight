import { render } from '../core/renderer.mjs';

const cases = [
  '`\\bar`',
  '`\\mathcal`',
  '`\\bar{L}`',
  '`\\mathcal{L}`',
  '`\\slashed k`',
  '`\\mathrm{Tr}`',
  '`\\frac`',
  '`\\sqrt`',
  '`\\bar` 和 `\\mathcal` 混排',
];

for (const s of cases) {
  let h;
  try { h = render('测试 ' + s + ' 结束。').html; } catch (e) { console.log('THROW ' + JSON.stringify(s) + ' ' + e.message); continue; }
  const m = /mdl-math-error-msg">([\s\S]*?)<\/span>/.exec(h);
  const isMath = /x-equation/.test(h);
  console.log((m ? 'ERR  ' : 'ok   ') + JSON.stringify(s).padEnd(24) + (m ? ' -> ' + m[1].trim() : '') + (isMath ? '  [became math]' : '  [literal code]'));
}
