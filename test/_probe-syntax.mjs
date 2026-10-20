// which documented "定制语法" are actually implemented?
import { render } from '../core/renderer.mjs';

const cases = [
  ['上标 ^x^', '这是 上标 ^x^ 结束。', /<sup>/],
  ['插入 ++x++', '这是 插入 ++x++ 结束。', /<ins>/],
  ['标记 ==x==', '这是 标记 ==x== 结束。', /<mark>/],
  ['wikilink [[x]]', '这是 [[x]] 结束。', /mdl-wikilink/],
  ['callout', '> [!NOTE]\n> 内容', /mdl-callout/],
  ['task list', '- [x] 完成\n- [ ] 未完成', /mdl-task/],
  ['mermaid lazy', '```mermaid\ngraph TD; A-->B;\n```', /x-mermaid/],
  ['strikethrough ~~x~~', '这是 ~~x~~ 结束。', /<s>/],
  ['subscript ~x~', '这是 ~x~ 结束。', /<sub>/],
];

for (const [name, src, want] of cases) {
  let html;
  try { html = render(src).html; } catch (e) { console.log('THROW  ' + name + ' → ' + e.message); continue; }
  const impl = want.test(html) ? 'IMPLEMENTED' : 'not implemented';
  console.log(impl.padEnd(15) + name + (want.test(html) ? '' : '   → ' + html.replace(/\n/g, ' ').slice(0, 140)));
}
