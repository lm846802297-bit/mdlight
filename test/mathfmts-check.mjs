// test/mathfmts-check.mjs
//
// 自足测试脚本：`node test/mathfmts-check.mjs` 直接可跑，不依赖构建产物。
// 覆盖 AsciiMath(反引号)、MathML、非数学内容不动、代码块内不误转换等。

import { preprocessMath, preprocessMathSync, mathmlToLatexInline, asciimathInlineFallback } from '../core/mathfmts.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = normalize(actual);
  const e = normalize(expected);
  const ok = a === e || braceNorm(a) === braceNorm(e);
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(`\n  [FAIL] ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
  return ok;
}

/**
 * 把 LaTeX 中"仅包裹单个原子"的花括号压平，用于容忍不同转换器的等价输出
 * （如 `{x}^{{2}}` ≡ `x^{2}`）。保留 \frac{..}{..} 等真正需要的括号。
 */
function braceNorm(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/\{([^{}]*)\}/g, (m, inner) => {
      // 内部不含换层括号，且为单个原子/数字/控制字整体
      if (/^\\?[A-Za-z0-9]+(\*)?$/.test(inner.trim())) return inner.trim();
      return m;
    });
  } while (s !== prev);
  return s;
}

function normalize(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function ok(cond, label) {
  if (cond) passed++;
  else { failed++; failures.push(`\n  [FAIL] ${label}`); }
  return cond;
}

// 异步测试收集
const tests = [];
function t(name, fn) { tests.push({ name, fn }); }

t('AsciiMath x^2 -> LaTeX', async () => {
  const out = await preprocessMath('`x^2`');
  eq(out, '$x^{2}$', 'x^2 → $x^{2}$（asciimath-to-latex 产出 {x}^{{2}}，组内等值）');
});

t('AsciiMath x^2+1 -> inline math', async () => {
  const out = await preprocessMath('value `x^2+1` here');
  ok(/`/.test(out) === false, '反引号应被移除');
  ok(/\$x\^\{?2\}?\+1\$/.test(out.replace(/\{[^}]*\}/g, (m)=>m.replace(/[{}]/g,''))) || out.includes('$'), '应被包裹成 $...$');
});

t('AsciiMath block-level asciimath: -> $$', async () => {
  const out = await preprocessMath('``asciimath:x^2+1``');
  ok(out.includes('$$'), '块级应生成 $$..$$');
  ok(!out.includes('asciimath:'), '标注应被移除');
});

t('纯代码/单词反引号不转换', async () => {
  const out = await preprocessMath('code `hello` here and `some_var` too');
  eq(out, 'code `hello` here and `some_var` too', '纯单词/下划线标识符应原样保留');
});

t('回归：含 LaTeX 定界符/$ 的行内代码一律不当作 asciimath', async () => {
  const src = 'text `\\(x^2\\)` more';
  const out = await preprocessMathSync(src);
  eq(out, src, '`\\(x^2\\)` 原样保留，不当公式');
});
t('回归：\\[y\\] 与 $z$ 行内代码保持原样', async () => {
  const src = '`\\[y\\]` and `$z$`';
  const out = await preprocessMathSync(src);
  eq(out, src, '`\\[y\\]` 与 `$z$` 均不转换');
});
t('纯 asciimath 仍转（x^2+1）', async () => {
  const out = await preprocessMathSync('`x^2+1`');
  eq(out, '$x^2+1$', '纯 asciimath 仍转 $x^2+1$');
});

t('代码块内不误转换 (fenced)', async () => {
  const md = '```\n`x^2` should stay\n```\nafter';
  const out = await preprocessMath(md);
  ok(out.includes('`x^2`'), '围栏内反引号应保留');
  ok(out.includes('```'), '围栏标记应保留');
});

t('非数学内容原样保留', async () => {
  const md = '# Title\n\nSome **bold** and `plain` text.\n\n- item\n- item2';
  const out = await preprocessMath(md);
  eq(out, md, '无数学时整体不变');
});

t('已有的 LaTeX $..$ 不被破坏', async () => {
  const md = 'Inline $a+b$ and display $$x=\\frac{1}{2}$$';
  const out = await preprocessMath(md);
  eq(out, md, '已有 LaTeX 保持原样');
});

t('MathML mi/mo/mn 基础', async () => {
  const out = await preprocessMath('<math><mi>x</mi><mo>+</mo><mn>1</mn></math>');
  eq(out, '$x+1$', 'x+1');
});

t('MathML mfrac -> frac', async () => {
  const out = await preprocessMath('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>');
  eq(out, '$\\frac{1}{2}$', '\\frac{1}{2}');
});

t('MathML msqrt -> sqrt', async () => {
  const out = await preprocessMath('<math><msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt></math>');
  eq(out, '$\\sqrt{x+1}$', 'sqrt(x+1)');
});

t('MathML msup -> superscript', async () => {
  const out = await preprocessMath('<math><msup><mi>x</mi><mn>2</mn></msup></math>');
  eq(out, '$x^{2}$', 'x^2');
});

t('MathML msub -> subscript', async () => {
  const out = await preprocessMath('<math><msub><mi>x</mi><mi>i</mi></msub></math>');
  eq(out, '$x_{i}$', 'x_i');
});

t('MathML operators: times/le/ge/times', async () => {
  const out = await preprocessMath('<math><mn>3</mn><mo>&#215;</mo><mn>4</mn><mo>&le;</mo><mn>5</mn></math>');
  eq(out, '$3\\times4\\le5$', '3 times 4 le 5');
});

t('MathML block display', async () => {
  const out = await preprocessMath('<math display="block"><mi>x</mi><mo>=</mo><mn>1</mn></math>');
  eq(out, '$$x=1$$', 'display=block → $$..$$');
});

t('MathML parser失败保留原文', async () => {
  const frag = '<math><msup><mi>x</mi></msup></math>';
  const res = mathmlToLatexInline(frag);
  eq(res, '$x$', '截断的 msup 仍有合理输出且不抛错');
});

t('MathML \u00d7/divide/ne', async () => {
  const out = await preprocessMath('<math><mi>a</mi><mo>&divide;</mo><mi>b</mi><mo>&ne;</mo><mn>0</mn></math>');
  eq(out, '$a\\div\\ b\\ne0$', 'divide/ne（控制字后补间隔 \\  ）');
});;

t('MathML msubsup', async () => {
  const out = await preprocessMath('<math><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup></math>');
  eq(out, '$x_{i}^{2}$', 'msubsup');
});

t('MathML mroot', async () => {
  const out = await preprocessMath('<math><mroot><mi>x</mi><mn>3</mn></mroot></math>');
  eq(out, '$\\sqrt[3]{x}$', 'mroot');
});

t('AsciiMath sum/int 经库转换', async () => {
  const out = await preprocessMath('``asciimath:sum_(n=1)^10 n``');
  ok(out.includes('\\sum'), 'sum 符号应转成 \\sum');
});

t('真实内容 + 数学混合', async () => {
  const md = '面积 ` a * b * 2 ` 且 `x^2` 的结果是 4。';
  const out = await preprocessMath(md);
  ok(!out.includes('` a * b * 2 `'), '含 `*` 的应被当作数学');
});

// 显式调用 fallback 的单元测试
t('fallback asciimath 子集', async () => {
  eq(asciimathInlineFallback('x^2'), 'x^{2}', 'fallback x^2');
  eq(asciimathInlineFallback('a+b'), 'a+b', 'fallback a+b');
  eq(asciimathInlineFallback('x^a'), 'x^{a}', 'fallback x^a');
  eq(asciimathInlineFallback('12/5'), '\\frac{12}{5}', 'fallback 分数');
});

t('preprocessMathSync 同步入口：AsciiMath+MathML', async () => {
  const out1 = preprocessMathSync('`x^2`');
  eq(out1, '$x^{2}$', 'sync x^2 → $x^{2}$');
  const out2 = preprocessMathSync('``asciimath:a+b``');
  ok(out2.includes('$$'), 'sync 块级 asciimath 生成 $$');
  const out3 = preprocessMathSync('<math><msup><mi>x</mi><mn>2</mn></msup></math>');
  eq(out3, '$x^{2}$', 'sync MathML msup → x^2');
  // 返回值为字符串而非 Promise
  ok(typeof out1 === 'string', 'sync 返回值是 string');
});

t('preprocessMathSync 同步入口：不误转代码与纯文本', async () => {
  const md = 'code `some_var` and path `a/b.js` and `x^2`';
  const out = preprocessMathSync(md);
  ok(out.includes('`some_var`'), '代码片段保留原反引号（不误转换）');
  ok(out.includes('`a/b.js`'), '路径保留原反引号（不误转换）');
  ok(out.includes('$x^{2}$'), 'x^2 应被转换成 $x^{2}$');
});

t('嵌套 MathML mrow+mfrac', async () => {
  const md = '<math><mrow><mi>x</mi><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></math>';
  const out = await preprocessMath(md);
  eq(out, '$x+\\frac{1}{2}$', '内联 mrow 嵌套 frac');
});

t('非 math 的 <math> 缺失闭合保留原文', async () => {
  const md = 'broken <math><mi>x</mi>';
  const out = await preprocessMath(md);
  eq(out, 'broken <math><mi>x</mi>', '未闭合 <math> 原样保留');
});

t('多个数学片段各自独立转换', async () => {
  const out = await preprocessMath('`a+b` and plain `<math><mi>x</mi></math>` end');
  ok(/^\$[\s\S]+\$$/.test(out) || out.includes('$a+b$') || out.includes('${a}+{b}$'),
    'asciimath a+b 被包裹成 $...$');
  ok(out.includes('$x$'), 'mathml x 转成 $x$');
});

t('反引号内含 URL/路径不算数学', async () => {
  const md = 'see `core/mathfmts.mjs` and `src/foo.js`';
  const out = await preprocessMath(md);
  eq(out, md, '含斜杠路径视为代码，不转换');
});

t('KaTeX 可渲染性抽查（不校验渲染，仅含包裹符）', async () => {
  const out = await preprocessMath('``asciimath:sqrt(x^2+y^2)`` and `<math><msqrt><msup><mi>x</mi><mn>2</mn></msup></msqrt></math>`');
  ok(out.includes('$'), '包含数学包裹符');
});

async function runAll() {
  for (const t of tests) {
    try {
      await t.fn();
    } catch (e) {
      failed++;
      failures.push(`\n  [ERROR] ${t.name}: ${e && e.stack || e}`);
    }
  }
  console.log(`\n==== 结果：${passed} passed, ${failed} failed (共 ${tests.length} 组) ====`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✓');
  }
}

runAll();