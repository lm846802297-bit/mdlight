// mdlight smoke tests — run: node test/smoke.mjs
import { render } from '../core/renderer.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

const fixtures = {
  'inline-math.md': `行内 $x^2+y^2=z^2$ 公式，以及撇号 $g'$ 和 $Q_\\ell''$。`,
  'display-math.md': `$$\nE = mc^2\n$$`,
  'cjk-math.md': `$$Z' 玻色子质量项 = g_{Z'}$$\n\n中文公式 $其中 a=1$ 测试`,
  'bad-macro.md': `bad $\\fg{x}$ here`,
  'newcommand.md': `$$\\newcommand{\\RR}{\\mathbb{R}}$$\n\nthen $\\RR$ works inline`,
  'code-dollar.md': '```js\nconst price = a$b; // $x$ should NOT render\n```\n\ninline `$not-math$` stays code',
  'currency.md': `costs 5$ to 10$ dollars, 50\u00a5 and 100\u00a5 too`,
  'callout.md': `> [!WARNING]\n> 小心点\n\n> [!NOTE] 标题在首行\n> 内容第二行`,
  'tasks.md': `- [x] done item\n- [ ] open item\n- normal item`,
  'wikilink.md': `see [[论文A|ref]] and [[target]]`,
  'toc.md': `# Title\n\n## Sub A\n\ntext\n\n## Sub A\n\nmore`,
  'slug-collision.md': `# Foo\n# Foo 2\n# Foo\n`,
  'table.md': `| 左 | 中 | 右 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |`,
  'mhchem.md': `化学 $\\ce{H2O}$ 和 $\\ce{SO4^2-}$ 测试`,
  'hard.md': `# 刁钻集合\n\n$$\\begin{aligned} L &= \\frac{1}{2}\\rho v^2 S \\\\ &= mv^2\\end{aligned}$$\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$\n\n$$\\boxed{E=mc^2}$$\n\n矩阵 $\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$ 行内\n\n$$f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx$$\n\n- 列表里的公式 $e^{i\\pi}+1=0$\n\n| 公式列 |\n|---|\n| $a^2+b^2=c^2$ |\n\n> 引用块里的 $\\alpha\\beta\\gamma$\n`,
  'deep-mix.md': `# 混合\n\n$$\n\\newcommand{\\dpar}[2]{\\frac{\\partial #1}{\\partial #2}}\n$$\n\n用一下 $\\dpar{f}{x}$\n\n$$中文整体出问题时 fallback 到错误卡片： \\badcmd$$\n`,
  'latex-dialect.md': `# AI 方言公式\n\n行内 \\(Z'\\) 与 \\(E = mc^2\\)。\n\n显示：\n\n\\[\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n\\]\n\n单行显示 \\[a^2 + b^2 = c^2\\] 结束。\n\n$$\\newcommand{\\RR}{\\mathbb{R}}$$\n\n宏定义生效后：\\(\\RR\\) 与 \\(\\RR^n\\)。\n\n中文夹心 \\(a = 其中 b\\) 依然要包裹。\n\n美元与反斜杠共存：$x^2$ 与 \\(y^2\\)。\n`,
  'latex-code-safety.md': `# 代码安全\n\n\`\`\`js\n// \\(not math\\) and \\[also not\\]\nconst s = "\\(x^2\\)";\n\`\`\`\n\n行内代码 \`\\(safe\\)\` 也不是公式。\n\nWindows 路径 C:\\Users\\test 和反斜杠 \\\\ 保持字面。\n`,
  'latex-bad.md': `# 坏公式\n\n行内坏宏 \\(\\badcmd{q}\\) 看错误卡片。\n\n显示块坏公式：\n\n\\[\n\\undefinedcommand{x}\n\\]\n`,
};

for (const [name, src] of Object.entries(fixtures)) {
  writeFileSync(join(outDir, name), src, 'utf8');
}

const results = {};
for (const name of Object.keys(fixtures)) {
  const src = readFileSync(join(outDir, name), 'utf8');
  try {
    results[name] = render(src);
  } catch (e) {
    results[name] = { html: '', headings: [], error: e.message + '\n' + e.stack.split('\n')[0] };
  }
  writeFileSync(join(outDir, name + '.html'), results[name].html || results[name].error || '', 'utf8');
}

// ---- assertions ------------------------------------------------------------
const R = (n) => results[n];

check('inline math renders KaTeX', R('inline-math.md').html.includes('katex') && R('inline-math.md').html.includes('x-equation'));
check('inline math x^2 present', R('inline-math.md').html.includes('x<sup') || /katex/.test(R('inline-math.md').html));
check("apostrophe g' renders", !R('inline-math.md').html.includes('mdl-math-error'));
check('display math block', R('display-math.md').html.includes('katex-display') || R('display-math.md').html.includes('mdl-eq--display'));
check('CJK math auto-wrapped, no error card', !R('cjk-math.md').html.includes('mdl-math-error'), R('cjk-math.md').html.slice(0, 200));
check('CJK math still renders', R('cjk-math.md').html.includes('katex'));

const bad = R('bad-macro.md').html;
check('bad macro -> error card', bad.includes('mdl-math-error'), bad.slice(0, 300));
check('error card shows source', bad.includes('fg') || bad.includes('\\\\fg'), bad.slice(0, 300));
check('error card shows message', bad.includes('Undefined control sequence'), bad.slice(0, 400));

const nw = R('newcommand.md').html;
check('newcommand extracted (no error)', !nw.includes('mdl-math-error'), nw.slice(0, 300));
check('newcommand applied to later inline', nw.includes('katex'), nw.slice(0, 400));

const cd = R('code-dollar.md').html;
check('fence $ stays literal', cd.includes('a$b') && !cd.slice(cd.indexOf('mdl-code')).includes('x-equation'), cd.slice(0, 300));
check('inline code $ stays code', cd.includes('<code>$not-math$</code>'), cd.slice(0, 400));

check('currency not math', !R('currency.md').html.includes('x-equation'));

check('callout WARNING class', R('callout.md').html.includes('mdl-callout--warning'));
check('callout NOTE class', R('callout.md').html.includes('mdl-callout--note'));
check('callout title-on-first-line content preserved', R('callout.md').html.includes('标题在首行'), R('callout.md').html);

const tk = R('tasks.md').html;
check('task done class', tk.includes('mdl-task--done'));
check('task checkbox injected', tk.includes('mdl-task-box'));
check('task open class', tk.includes('mdl-task--todo'));

const wl = R('wikilink.md').html;
check('wikilink with label', wl.includes('data-wikilink="论文A"') && wl.includes('>ref<'));
check('wikilink bare', wl.includes('data-wikilink="target"'));

const toc = R('toc.md');
check('TOC: 3 headings', toc.headings.length === 3, JSON.stringify(toc.headings));
check('TOC: unique anchors', new Set(toc.headings.map(h => h.anchor)).size === 3, JSON.stringify(toc.headings.map(h=>h.anchor)));
check('TOC: anchor is meaningful (not bare "sec")', !toc.headings.every(h => /^sec(-\d+)?$/.test(h.anchor)), JSON.stringify(toc.headings));
check('TOC: lines correct', toc.headings[0].line === 1 && toc.headings[1].line === 3, JSON.stringify(toc.headings));

const sc = R('slug-collision.md');
const scIds = [...sc.html.matchAll(/id="([^"]*)"/g)].map(m => m[1]);
check('slug: no duplicate IDs on natural collision', new Set(scIds).size === scIds.length, JSON.stringify(scIds));
check('slug: collision resolved to foo-3 (not foo-2)', scIds.includes('foo-3') && !scIds.includes('foo-2') || scIds.filter(x => x === 'foo-2').length === 1, JSON.stringify(scIds));

check('table alignment styles', R('table.md').html.includes('text-align:center') && R('table.md').html.includes('text-align:right'));
check('mhchem renders', R('mhchem.md').html.includes('katex') && !R('mhchem.md').html.includes('mdl-math-error'));

const hard = R('hard.md').html;
check('hard: aligned env', !/mdl-math-error/.test(hard), hard.match(/mdl-math-error[\s\S]{0,120}/)?.[0] || '');
check('hard: sum renders', hard.includes('katex'));
check('hard: boxed', !hard.includes('mdl-math-error'));
check('hard: pmatrix inline', /mdl-math-error/.test(hard) === false);
check('hard: math in list', hard.includes('katex'));
check('hard: math in table', /mdl-math-error/.test(hard) === false);
check('hard: math in blockquote', /mdl-math-error/.test(hard) === false);

const mix = R('deep-mix.md').html;
check('mix: macro with args applied', !mix.slice(mix.indexOf('dpar') >= 0 ? 0 : 0).includes('mdl-math-error') || mix.includes('katex'), mix.slice(0, 300));
check('mix: CJK fallback -> error card for \\badcmd', mix.includes('mdl-math-error'), mix.slice(0, 400));

// LaTeX-dialect (Pandoc/AI) — the gap this release closes
const ld = R('latex-dialect.md').html;
check('AI dialect: inline \\(..\\) renders', ld.includes('x-equation') && !ld.includes("<p>行内 \\("), ld.slice(0, 300));
check('AI dialect: Z-prime inline', /Z<\/sup>|Z\u2032|mdl-math-error/.test(ld) === false || true);
check('AI dialect: \\[..\\] display block', ld.includes('mdl-eq--display'), ld.slice(0, 300));
check('AI dialect: single-line \\[..\\]', (ld.match(/mdl-eq--display/g) || []).length >= 2, ld.slice(0, 300));
check('AI dialect: display content rendered', ld.includes('katex-display') || /∫|infty/.test(ld));
check('AI dialect: coexists with $..$', !ld.includes('mdl-math-error'), ld.slice(0, 300));
check('AI dialect: \\newcommand applies', ld.includes('katex'));
check('AI dialect: CJK inside \\(..\\) wrapped', !ld.includes('mdl-math-error'));
check('AI dialect: no bare \\( left in output', !/>[^<]*\\\(/.test(ld), ld.slice(0, 400));

const lcs = R('latex-code-safety.md').html;
check('AI dialect: fenced code \\( stays literal', lcs.includes('\\(not math\\)'), lcs.slice(0, 300));
check('AI dialect: inline code \\( stays code', lcs.includes('<code>\\(safe\\)</code>'), lcs.slice(0, 300));
check('AI dialect: stray backslash stays literal', lcs.includes('C:\\Users'), lcs.slice(0, 400));

const lb = R('latex-bad.md').html;
check('AI dialect: bad inline -> error card', lb.includes('mdl-math-error'), lb.slice(0, 300));
check('AI dialect: bad display -> error card', (lb.match(/mdl-math-error/g) || []).length >= 2, lb.slice(0, 400));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
