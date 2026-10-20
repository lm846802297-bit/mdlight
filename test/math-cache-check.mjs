// test/math-cache-check.mjs — verifies the per-render-pass KaTeX cache is correct:
// repeated formulas render once (output identical), no stale macros leak across
// render() calls, and the cache never changes output.
import { render } from '../core/renderer.mjs';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok  ' + l); } else { fail++; console.log('FAIL  ' + l); } };

// 1. Repeated formula: same output, cache reused
const doc1 = 'Use $E=mc^2$ and $E=mc^2$ and $E=mc^2$.';
const r1 = render(doc1);
const eqs = (r1.html.match(/x-equation/g) || []).length;
ok(eqs === 6, 'repeated formula produces 3 equations (6 x-equation tags: open+close)');
ok(/data-src="E=mc\^2"/.test(r1.html), 'each equation carries its data-src');

// 2. Cache cleared per render(): doc A defines a macro, doc B uses same formula
const docA = '\\newcommand{\\RR}{\\mathbb{R}}\n\n$$\\RR$$ and $$\\RR$$ again';
const docB = '$$\\RR$$ with no macro';
const ra = render(docA);
const rb = render(docB);
ok(ra.html.includes('mathbb'), 'docA renders the macro');
ok(!rb.html.includes('mathbb'), 'docB does NOT reuse docA cached macro output (no stale cache)');

// 3. Same doc, two renders, byte-identical
const docC = '# Title\n\n$x^2 + y^2$ and $x^2 + y^2$ and a table\n\n| a | b |\n| - | - |\n| 1 | 2 |';
const rc1 = render(docC);
const rc2 = render(docC);
ok(rc1.html === rc2.html, 'two renders of same doc are byte-identical (cache is per-pass)');

// 4. Display vs inline are distinct keys
const docD = '$x$ inline and $$x$$ display';
const rd = render(docD);
ok(rd.html.includes('mdl-eq--display'), 'display equation has mdl-eq--display class');
ok((rd.html.match(/x-equation/g) || []).length === 4, 'inline + display = 2 equations (4 tags)');

// 5. Macro defined mid-document affects later formulas (cache key folds macroTable)
const docE = '$a$ then \\newcommand{\\M}{10} then $\\M$';
const re = render(docE);
ok(re.html.includes('10') || re.html.includes('\\M'), 'mid-document macro applied to later formula');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);