// core/mathfmts.mjs
//
// 多格式数学公式兼容：把 Markdown 源文本中的 AsciiMath（反引号形式）与内联
// MathML 统一转换成 KaTeX/LaTeX 的 $...$ / $$...$$ 形式，其余内容原样保留。
//
// 设计约束：
//   - 纯函数，无副作用，同一段输入必得同一段输出。
//   - 同时可在 Node 与浏览器（esbuild 打包）运行，不使用任何 Node 独有 API。
//   - asciimath-to-latex 通过动态 import 懒加载；若目标环境拿不到该包
//     （如浏览器回退 / import 抛错），自动回退到内置的 asciimath 子集翻译器。
//   - 解析失败时保留原始内容，不破坏文档。
//
// 注意：因为要动态加载 asciimath-to-latex，preprocessMath 是 async 的，
// 返回 Promise<string>。

/* =====================================================================
 * 通用小工具
 * ===================================================================== */

function escapeRe(s) {
  // eslint-disable-next-line no-useless-escape
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** HTML 实体解码（含命名与数字实体） */
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  const named = {
    lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ',
    times: '\u00d7', divide: '\u00f7', le: '\u2264', ge: '\u2265',
    ne: '\u2260', equiv: '\u2261', minus: '\u2212', middot: '\u00b7',
    sdot: '\u22c5', cdot: '\u22c5', in: '\u2208', notin: '\u2209',
    sub: '\u2282', sube: '\u2286', sup: '\u2283', supe: '\u2287',
    cup: '\u222a', cap: '\u2229', int: '\u222b', sum: '\u2211',
    prod: '\u220f', rarr: '\u2192', larr: '\u2190', infty: '\u221e',
    plusmn: '\u00b1', oplus: '\u2295', otimes: '\u2297',
  };
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return body in named ? named[body] : m;
  });
}

/** 把标签之间的空白/换行压成单个空格，并做实体解码；空白串返回空串 */
function normalizeText(chunk) {
  let t = decodeEntities(chunk);
  t = t.replace(/\s+/g, ' ');
  t = t.trim();
  return t;
}

/** 把一段完整 LaTeX 原子包进 `{}`，作为指数/下标的基座时更稳妥 */
function groupAtom(x) {
  return x ? '{' + x + '}' : '';
}

/* =====================================================================
 * MathML -> LaTeX：轻量递归解析器
 * ===================================================================== */

const MI_FN = {};
const _FNS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth', 'log', 'ln', 'lg',
  'exp', 'lim', 'max', 'min', 'arg', 'dim', 'gcd', 'det', 'mod', 'deg',
];
for (const f of _FNS) MI_FN[f] = '\\' + f;

const OP_MAP = [
  ['+', '+'],
  ['\u2212', '-'], ['-', '-'],
  ['*', '\\cdot'], ['\u00b7', '\\cdot'], ['\u2219', '\\cdot'],
  ['\u22c5', '\\cdot'], ['\u2217', '\\cdot'],
  ['\u00d7', '\\times'], ['\u22d5', '\\times'],
  ['\u2297', '\\otimes'], ['\u2295', '\\oplus'],
  ['\u00f7', '\\div'], ['/', '\\div'], ['\u2044', '/'],
  ['=', '='], ['\u2260', '\\ne'], ['\u2261', '\\equiv'],
  ['\u2248', '\\approx'], ['\u2245', '\\cong'],
  ['<', '<'], ['>', '>'],
  ['\u2264', '\\le'], ['\u2265', '\\ge'], ['\u226a', '\\ll'], ['\u226b', '\\gg'],
  ['\u2208', '\\in'], ['\u2209', '\\notin'],
  ['\u2282', '\\subset'], ['\u2286', '\\subseteq'],
  ['\u2283', '\\supset'], ['\u2287', '\\supseteq'],
  ['\u222a', '\\cup'], ['\u2229', '\\cap'],
  ['\u222b', '\\int'], ['\u2211', '\\sum'], ['\u220f', '\\prod'],
  ['\u2192', '\\to'], ['\u2190', '\\gets'], ['\u2194', '\\leftrightarrow'],
  ['\u21d4', '\\Leftrightarrow'], ['\u21d2', '\\Rightarrow'], ['\u21d0', '\\Leftarrow'],
  ['\u221e', '\\infty'], ['\u00b1', '\\pm'], ['\u2213', '\\mp'],
  ['\u2205', '\\emptyset'], ['\u2220', '\\angle'], ['\u22a5', '\\perp'],
  ['(', '('], [')', ')'], ['[', '['], [']', ']'], ['{', '{'], ['}', '}'],
  ['|', '|'], [',', ','], [';', ';'], [':', ':'],
];

function mapOperator(opText) {
  const t = decodeEntities(opText).trim();
  if (t.length === 0) return '';
  for (const [k, v] of OP_MAP) {
    if (t === k) return v;
  }
  // 未知运算符原样透传
  return t;
}

/**
 * 对组装好的 LaTeX 做后处理：运算符控制字（\\div \\times \\le 等）后者直接
 * 紧跟一个字母时，LaTeX 会把该字母并入控制字（如从 `\\diva` 变成函数 `\\diva`），
 * 这里在这些运算符后紧跟字母的位置补一个显式间隔 `\\ ` 隔开。
 * 数字、花括号、其他控制字（frac/sqrt 等）不受影响。
 */
const OP_CONTROL_WORDS = [
  'div', 'times', 'cdot', 'otimes', 'oplus', 'le', 'ge', 'ne', 'equiv',
  'approx', 'cong', 'll', 'gg', 'notin', 'subset', 'subseteq', 'supset',
  'supseteq', 'cup', 'cap', 'int', 'sum', 'prod', 'to', 'gets', 'pm', 'mp',
  'ldots', 'cdots', 'infty', 'emptyset', 'angle', 'perp',
  'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'leftrightarrow',
];
const OP_CONTROL_WORDS_RE = new RegExp(
  '\\\\(?:' + OP_CONTROL_WORDS.join('|') + ')([A-Za-z])',
  'g'
);
function postSpaceControlWords(tex) {
  return tex.replace(OP_CONTROL_WORDS_RE, (m, c) => {
    return m.slice(0, -1) + '\\ ' + c;
  });
}

/** 解析 MathML 子元素。closeName 为该节点的闭合标签名。 */
function parseChildren(src, closeName, start) {
  const children = [];
  let i = start;
  const n = src.length;
  const closer = new RegExp('^</' + escapeRe(closeName) + '\\s*>', 'i');
  while (i < n) {
    const c = src[i];
    if (c === '<') {
      if (src.startsWith('</', i)) {
        const m = closer.exec(src.slice(i));
        if (m) return { children, nextIndex: i + m[0].length };
        // 不匹配当前节点闭合标签的其他闭合标签：跳过
        const gt = src.indexOf('>', i);
        if (gt < 0) throw new Error('Unbalanced MathML (missing >)');
        i = gt + 1;
        continue;
      }
      // 开始标签：`<name attrs...>`
      const tag = /^<([\w:-]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(src.slice(i));
      if (!tag) {
        // 形如 `<5` 之类：按字面文本处理
        i += 1;
        continue;
      }
      const name0 = tag[1];
      const attrs = tag[2];
      const innerStart = i + tag[0].length;
      const sub = parseChildren(src, name0, innerStart);
      children.push(buildElement(name0, attrs, sub.children));
      i = sub.nextIndex;
    } else {
      const lt = src.indexOf('<', i);
      const chunk = lt < 0 ? src.slice(i) : src.slice(i, lt);
      const text = normalizeText(chunk);
      if (text) children.push(text);
      i = lt < 0 ? n : lt;
    }
  }
  return { children, nextIndex: i };
}

/** 依据标签名把子元素列表组装成 LaTeX。 */
function buildElement(name, attrs, children) {
  switch (name.toLowerCase()) {
    case 'mrow':
      return children.join('');
    case 'mi': {
      const t = children.join('').trim();
      if (t in MI_FN) return MI_FN[t];
      // 单字符标识符直接透传；多字符未知词保持原样
      return t;
    }
    case 'mo':
      return mapOperator(children.join(''));
    case 'mn':
      return children.join('');
    case 'mtext':
      return children.join('');
    case 'msup': {
      const base = children[0] || '';
      const sup = children[1] || '';
      if (!base) return '^{' + sup + '}';
      if (!sup) return base;
      return groupAtom(base) + '^{' + sup + '}';
    }
    case 'msub': {
      const base = children[0] || '';
      const sub = children[1] || '';
      if (!base) return '_{' + sub + '}';
      if (!sub) return base;
      return groupAtom(base) + '_{' + sub + '}';
    }
    case 'msubsup': {
      const base = children[0] || '';
      const sub = children[1] || '';
      const sup = children[2] || '';
      let out = base ? groupAtom(base) : '';
      if (sub) out += '_{' + sub + '}';
      if (sup) out += '^{' + sup + '}';
      return out || base;
    }
    case 'mfrac': {
      const num = children[0] || '';
      const den = children[1] || '';
      return '\\frac{' + num + '}{' + den + '}';
    }
    case 'msqrt':
      return '\\sqrt{' + children.join('') + '}';
    case 'mroot': {
      const base = children[0] || '';
      const idx = children[1] || '';
      return '\\sqrt[' + idx + ']{' + base + '}';
    }
    case 'mtd':
    case 'mtr':
    case 'mtable': {
      // 若出现 `<mtable>`，用简易 \begin{matrix} 近似；否则平铺子元素
      if (/^mtable$/i.test(name)) {
        const rows = [];
        let cur = [];
        for (let k = 0; k < children.length; k++) {
          if (children[k] === '&') { cur.push('\\,\\,'); rows.push(cur.slice()); cur = []; }
          else if (children[k] === '\\\\') { rows.push(cur.slice()); cur = []; }
          else cur.push(children[k]);
        }
        if (cur.length) rows.push(cur);
        const body = rows.map((r) => r.join(' & ')).join(' \\\\ ');
        return body ? '\\begin{matrix}' + body + '\\end{matrix}' : children.join('');
      }
      return children.join('');
    }
    default:
      // math / 未知元素：平铺子元素（最佳努力，不损坏内容）
      return children.join('');
  }
}

/**
 * 把一个 `<math ...>...</math>` 片段的 LaTeX 结果求出来。
 * @param {string} tagText  外层 `<math ...>` 开始标签
 * @param {string} inner    内部内容（不含 <math> 标签）
 * @returns {string|null}   LaTeX 字符串；失败返回 null（调用方保留原文）
 */
function mathmlFragmentToLatex(tagText, inner) {
  try {
    const res = parseChildren(inner, 'math', 0);
    const latex = postSpaceControlWords(res.children.join(''));
    if (!latex.trim()) return null; // 空/无实质内容，交给调用方保留
    return latex;
  } catch (e) {
    return null;
  }
}

/** 从 MathML 文本片段得到最终锚定的 $..$ / $$..$$ 表示。失败返回 null。 */
export function mathmlToLatexInline(frag) {
  const open = /^<math\b([^>]*)>/.exec(frag);
  if (!open) return null;
  const attrs = open[1];
  const inner = frag.slice(open[0].length);
  if (/<\/math\s*>(?:\s|\u0000)*$/i.test(inner) === false) {
    const end = inner.lastIndexOf('</math');
    if (end < 0) return null;
  }
  const latex = mathmlFragmentToLatex('math' + attrs, inner);
  if (latex === null) return null;
  const block =
    /display\s*=\s*["']?\s*block/i.test(attrs) ||
    /display\s*:\s*block/i.test(attrs);
  return block ? '$$' + latex + '$$' : '$' + latex + '$';
}

/** 在文本中把所有 `\u0000F<idx>\u0000` 代码块占位恢复为原始内容 */
export function restoreFenced(text, store) {
  return text.replace(/\u0000F(\d+)\u0000/g, (_m, idx) => store[Number(idx)] || '');
}

/** 抽出围栏代码块（``` 或 ~~~），替换为占位符，并返回存储 */
function protectFenced(src) {
  const store = [];
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fm = /^\s*(`{3,}|~{3,}).*$/.exec(line);
    if (fm) {
      const fence = fm[1];
      const blockLines = [line];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const lm = lines[j];
        if (/^\s*(`{3,}|~{3,})\s*$/.test(lm) && lm.trim()[0] === fence[0] && lm.replace(/\s/g, '').length >= fence.length) {
          blockLines.push(lm);
          closed = true;
          break;
        }
        blockLines.push(lm);
        j++;
      }
      if (!closed) {
        out.push(blockLines.join('\n'));
        i = lines.length;
        continue;
      }
      const idx = store.length;
      store.push(blockLines.join('\n'));
      out.push('\u0000F' + idx + '\u0000');
      i = j + 1;
    } else {
      out.push(line);
      i++;
    }
  }
  return { text: out.join('\n'), store };
}

/** 在文本中把 `<math>..</math>` 内联 MathML 转为 $..$ / $$..$$；失败保留原文 */
function convertMathMLPass(text) {
  // 逐段扫描，避免被 placeholders 干扰
  return text.replace(/<math\b[^>]*>[\s\S]*?<\/math\s*>/gi, (frag) => {
    const res = mathmlToLatexInline(frag);
    return res === null ? frag : res;
  });
}

/* =====================================================================
 * AsciiMath（反引号形式）
 * ===================================================================== */

// 数学信号：内容里出现这些符号/词，才认为反引号中的是数学表达式。
// 注意 `_`（下划线）常出现在代码标识符（some_var）里，故不作为触发信号，以免误伤代码。
const MATH_SIGNAL = /[\^+*=<>\u00d7\u00f7/:\\]|\b(sqrt|sum|int|prod|lim|frac|infty|alpha|beta|gamma|delta|pi|theta|lambda|mu|sigma|omega|log|sin|cos|tan)\b/;

// 明显是程序代码的反引号内容（即使含 = / 等信号也不当作公式）
const CODE_KEYWORDS = /\b(const|let|var|function|class|def|import|export|return|if|else|for|while|switch|case|new|throw|async|await|yield|require|typedef|struct|enum|interface|namespace|using|then|catch|finally)\b/;
const CODE_MARKERS = /;|=>|->|::|\/\/|\/\*|#[a-z]|```|\$\{/;
// 文件/路径/带扩展名的标识符 → 视为代码
const CODE_PATHISH = /(?:\/|\.[a-zA-Z0-9]{1,6}$)/;

// 确凿的“非公式”信号：这些写法在 AsciiMath 语法里没有意义，却大量出现在
// 普通行内代码 / 命令行 / 路径里。命中即保持代码 —— 宁可漏转一个公式，
// 也绝不能把作者的代码送进 KaTeX，渲染成“公式渲染失败”卡片。
const NOT_MATH_SIGNALS = [
  /&/,                            // shell 连接符 / 逻辑与（AsciiMath 无 &）
  /\|\|/,                         // shell / 逻辑或
  /;/,                            // 语句分隔符
  /--/,                           // 命令行选项
  /\+\+/,                         // C/JS 自增（AsciiMath 无 ++ 语法）
  /\$/,                           // 已有 LaTeX 内联符 / shell 变量
  /[\\]\(|[\\]\)|[\\]\[|[\\]\]/,  // LaTeX 定界符 \( \) \[ \]
  // 整个内容就是一个“裸宏名”（\bar \mathcal \frac \sqrt \s \n …）：缺参数、
  // 不是完整表达式，KaTeX 必报 "expected '}'" / "Undefined control sequence"。
  // 注意只拒“整个内容就是宏名”这一种；`\bar{L}` `\mathrm{Tr}` `\slashed k`
  // `\frac{a}{b}` 是完整表达式，仍须按公式处理。
  /^\\[A-Za-z]+$/,
  /[A-Za-z]:[\\/]/,               // Windows 盘符路径 C:\ 或 C:/
  /"/,                            // 命令行参数 / 路径里的引号
  /^[\^_]/,                       // 以 ^ 或 _ 开头：缺少基底
  /[\^_]\s*[\^_]/,                // 连续上 / 下标算子（x^^2）
  /\^\s*[0-9A-Za-z]\s*\^/,        // 同一基底重复上标（a^b^c）
  /_\s*[0-9A-Za-z]\s*_/,          // 同一基底重复下标
  /\^\s*\{[^{}]*\}\s*\^/,         // 同一基底重复上标（a^{b}^{c}）
  /_\s*\{[^{}]*\}\s*_/,           // 同一基底重复下标
  // 英文散文：相邻两个纯字母单词（如 `Undefined control sequence: \badcommand`、
  // `npm run build`）。AsciiMath 表达式不会长成这样（`sum_(i=1)^n i`、
  // `\slashed k`、`sin x` 都不命中），作者写这类内容必然是行内代码或文档文字。
  /\b[A-Za-z]{2,}\s+[A-Za-z]{2,}\b/,
];

// 明确的独立数学记号：希腊字母名（`alpha` `pi` …）。这些词本来被
// isPlainCode 的“纯标识符”规则保护，但作为反引号内容时作者几乎必然
// 是指数学符号。刻意不含 int/sum/log/sin 等易与代码标识符混淆的词。
const MATH_WORD_ONLY = /^(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|oo|infty)$/;
// 最简分数 a/b、12/5：两侧只能是单个字母或纯数字，避免 `and/or` 之类被误判
const SIMPLE_FRACTION = /^(?:[0-9]+|[A-Za-z])\s*\/\s*(?:[0-9]+|[A-Za-z])$/;

/** 命中任一“确凿代码”信号即为行内代码，绝不转公式 */
function isDefinitelyCode(t) {
  for (const re of NOT_MATH_SIGNALS) {
    if (re.test(t)) return true;
  }
  return false;
}

function isPlainCode(content) {
  const t = content.trim();
  if (!t) return false;
  if (CODE_MARKERS.test(t)) return true;
  if (CODE_KEYWORDS.test(t)) return true;
  if (CODE_PATHISH.test(t)) return true;
  // 纯标识符/单词（字母数字下划线连字符空格组成）且不以明确数学运算符开头 → 视作代码
  if (/^[A-Za-z_$][A-Za-z0-9_$\- ]*$/.test(t)) return true;
  return false;
}

/** 识别规则：含数学信号且不是纯代码/单词 */
function looksLikeMath(content) {
  const t = content.trim();
  if (!t) return false;
  // 1) 确凿的代码信号优先：宁可保留代码，也不冒险送进 KaTeX
  if (isDefinitelyCode(t)) return false;
  // 2) 明确的独立数学记号（希腊字母名 / 最简分数）直接判为公式
  if (MATH_WORD_ONLY.test(t) || SIMPLE_FRACTION.test(t)) return true;
  // 3) 其余沿用原有规则
  if (isPlainCode(t)) return false;
  // LaTeX 定界符 / $ 兜底：反引号内容只要含 `\(` `\)` `\[` `\]` 或 `$`，
  // 就绝不会是 asciimath —— 一律原样保留，避免把 LaTeX 样式的行内代码误转成公式。
  // （asciimath 里 `$` 与 `\(` `\)` `\[` `\]` 都不参与语法，属确凿的代码信号）
  if (/[\\]\(|[\\]\)|[\\]\[|[\\]\]|\$/.test(t)) return false;
  return MATH_SIGNAL.test(t);
}

/** 内置 asciimath 子集翻译器（浏览器回退时使用） */
export function asciimathInlineFallback(src) {
  let s = src.trim();
  if (!s) return '';
  const greek = {
    alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
    epsilon: '\\epsilon', zeta: '\\zeta', eta: '\\eta',
    theta: '\\theta', iota: '\\iota', kappa: '\\kappa', lambda: '\\lambda',
    mu: '\\mu', nu: '\\nu', xi: '\\xi', pi: '\\pi', rho: '\\rho',
    sigma: '\\sigma', tau: '\\tau', upsilon: '\\upsilon', phi: '\\phi',
    chi: '\\chi', psi: '\\psi', omega: '\\omega',
    Gamma: '\\Gamma', Delta: '\\Delta', Lambda: '\\Lambda', Xi: '\\Xi',
    Pi: '\\Pi', Sigma: '\\Sigma', Phi: '\\Phi', Omega: '\\Omega',
    oo: '\\infty',
  };
  for (const [k, v] of Object.entries(greek)) {
    s = s.replace(new RegExp('\\b' + k + '(?![A-Za-z])', 'g'), v);
  }
  for (const f of _FNS) {
    s = s.replace(new RegExp('\\b' + f + '\\b', 'g'), '\\' + f);
  }
  // 分数 a/b
  s = s.replace(/([0-9]+|[A-Za-z])\s*\/\s*([0-9]+|[A-Za-z])/g, (m, a, b) => '\\frac{' + a + '}{' + b + '}');
  // 上标 / 下标（brace 形式 → 分组；单字符 → 分组成 {x} 便于后续拼接）
  s = s.replace(/([0-9A-Za-z]|})\s*_\s*\{([^}]*)\}/g, (m, a, b) => a + '_{' + b + '}');
  s = s.replace(/([0-9A-Za-z]|})\s*\^\s*\{([^}]*)\}/g, (m, a, b) => a + '^{' + b + '}');
  s = s.replace(/([0-9A-Za-z]|})\s*_\s*([0-9A-Za-z])/g, (m, a, b) => a + '_{' + b + '}');
  s = s.replace(/([0-9A-Za-z]|})\s*\^\s*([0-9A-Za-z])/g, (m, a, b) => a + '^{' + b + '}');
  s = s.replace(/\*/g, '\\cdot');
  return s;
}

/** 惰性加载并缓存 asciimath-to-latex 转换器，失败时落入内置子集 */
let amConverterCache = null;
let amConverterCacheType = null;
async function getAmConverter() {
  if (amConverterCacheType === 'ready') return amConverterCache;
  if (amConverterCacheType === 'fallback') return asciimathInlineFallback;
  try {
    const mod = await import('asciimath-to-latex');
    let fn = null;
    if (mod && mod.default) {
      if (typeof mod.default === 'function') fn = mod.default;
      else if (typeof mod.default.default === 'function') fn = mod.default.default;
    }
    if (typeof fn === 'function') {
      amConverterCache = fn;
      amConverterCacheType = 'ready';
      return fn;
    }
  } catch (e) {
    // 浏览器/无法解析依赖时回退
  }
  amConverterCache = asciimathInlineFallback;
  amConverterCacheType = 'fallback';
  return asciimathInlineFallback;
}

/**
 * 转换产物结构自检：明显会被 KaTeX 拒绝的 LaTeX 一律不用（退回代码）。
 * 只做结构性判断（不依赖 KaTeX、不解析完整语法），宁严勿松 —— 这是
 * “反引号代码永不产生公式渲染失败卡片”的最后一道闸。
 */
export function latexLooksBroken(latex) {
  const s = String(latex == null ? '' : latex).trim();
  if (!s) return true;
  if (/^[\^_]/.test(s)) return true;                // 缺基底：^x / _x
  if (/[\^_]\s*[\^_]/.test(s)) return true;         // 连续算子：x^^2
  if (/[\^_]\s*$/.test(s)) return true;             // 缺上/下标内容：x^
  if (/\^\s*\{[^{}]*\}\s*\^/.test(s)) return true;  // 重复上标：a^{b}^{c}
  if (/_\s*\{[^{}]*\}\s*_/.test(s)) return true;    // 重复下标
  if (/\^\s*[0-9A-Za-z]\s*\^/.test(s)) return true; // 重复上标：a^b^c
  if (/_\s*[0-9A-Za-z]\s*_/.test(s)) return true;   // 重复下标
  // 上/下标的操作数是“裸控制字”（x^\max）：KaTeX 报 "Got function '\max' with no
  // arguments as superscript"。asciimath 转换器对正常写法会补上花括号（x^{\max}）。
  if (/[\^_]\s*\\[A-Za-z]/.test(s)) return true;
  // 上/下标组里出现 \\（换行控制符）：转换器把源码里的单反斜杠转义成了双反斜杠，
  // 形如 `U_A(1)_{L_\mu-L_\tau}` → U_{A}(1)_{L_\\mu-L_\\tau}，KaTeX 必报错。
  if (/[\^_]\s*\{[^{}]*\\\\/.test(s)) return true;
  // 花括号必须成对（跳过转义字符 \{ \}）
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

/**
 * 扫描反引号，把“是数学”的内联代码转成 $..$；块级 ``asciimath:...`` 转成 $$..$$。
 * @param {string} text  已保护代码块、已转完 MathML 的文本
 * @param {(s:string)=>string} toLatex  已解析好的 asciimath->LaTeX 转换器
 */
function convertBackticks(text, toLatex) {
  const n = text.length;
  let out = '';
  let i = 0;
  while (i < n) {
    if (text[i] !== '`') {
      out += text[i];
      i += 1;
      continue;
    }
    // 统计反引号连续长度
    let j = i;
    while (j < n && text[j] === '`') j += 1;
    const tickLen = j - i;
    // 找等长闭合反引号序列
    let k = j;
    let closeIdx = -1;
    while (k < n) {
      if (text[k] === '`') {
        let m = k;
        while (m < n && text[m] === '`') m += 1;
        if (m - k === tickLen) { closeIdx = k; break; }
        k = m; // 跳过更长的反引号串
      } else {
        k += 1;
      }
    }
    if (closeIdx < 0) {
      // 未闭合：原样输出到结尾
      out += text.slice(i);
      break;
    }
    const content = text.slice(j, closeIdx);
    const after = closeIdx + tickLen;

    const trimmed = content.trim();
    let replacement = null;

    // 块级前置标注 ``asciimath:...``
    if (/^asciimath:/i.test(trimmed)) {
      const expr = trimmed.replace(/^asciimath:\s*/i, '');
      try {
        replacement = '$$' + toLatex(expr) + '$$';
      } catch (e) {
        replacement = null;
      }
    } else if (tickLen === 1 && looksLikeMath(content)) {
      try {
        const latex = toLatex(content.trim());
        // 最后一道闸：产物结构非法时退回代码，绝不让 KaTeX 报错
        if (!latexLooksBroken(latex)) replacement = '$' + latex + '$';
      } catch (e) {
        replacement = null;
      }
    }

    if (replacement !== null) {
      out += replacement;
      // pandoc 原生内联 TeX：`\cmd`{=tex} —— 既然已当成公式，就把紧随其后的
      // {=tex} 标记一并吃掉，否则它会作为字面文字留在正文里。
      const marker = text.slice(after).match(/^\{=\s*tex\}/);
      if (marker) i = after + marker[0].length;
      else i = after;
    } else {
      // 非数学内容原样保留
      out += '`'.repeat(tickLen) + content + '`'.repeat(tickLen);
      i = after;
    }
  }
  return out;
}

/* 已经是数学的区域：$$…$$ / \[…\] / \(…\) / $…$。
 * 在这些区域里反引号是数学文本本身（例如 pandoc 的 `…`{=tex} 原生内联），
 * 若仍按 AsciiMath 规则改写成 $…$，就会在数学里产生嵌套的 $，
 * 让整段公式变成 "Can't use function '$'" 错误卡片。 */
const MATH_REGION = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]*\$/g;

function convertBackticksOutsideMath(text, toLatex) {
  let out = '';
  let last = 0;
  MATH_REGION.lastIndex = 0;
  let m;
  while ((m = MATH_REGION.exec(text)) !== null) {
    out += convertBackticks(text.slice(last, m.index), toLatex);
    out += m[0];
    last = m.index + m[0].length;
  }
  out += convertBackticks(text.slice(last), toLatex);
  return out;
}

/* =====================================================================
 * 公开入口
 * ===================================================================== */

/**
 * 同步入口：与 preprocessMath 相同的处理流水线，但只用内置的
 * asciimathInlineFallback 子集翻译器（不做任何 dynamic import / async）。
 * 输入 markdown 源文本，返回处理后的 markdown（字符串）。
 * 顺序：保护围栏代码块 -> MathML -> AsciiMath(反引号) -> 恢复代码块。
 */
export function preprocessMathSync(src) {
  if (typeof src !== 'string') return String(src ?? '');
  const protected_ = protectFenced(src);
  const noMathML = convertMathMLPass(protected_.text);
  const withAm = convertBackticksOutsideMath(noMathML, asciimathInlineFallback);
  return restoreFenced(withAm, protected_.store);
}

/**
 * 主要转换函数（async）。
 * 输入 markdown 源文本，返回处理后的 markdown（Promise<string>）。
 * 内部优先用 asciimath-to-latex 库（能力更全）；若拿不到该库，则走
 * preprocessMathSync（内置子集），不再重复实现流水线。
 */
export async function preprocessMath(src) {
  if (typeof src !== 'string') return String(src ?? '');
  let toLatex = null;
  try {
    toLatex = await getAmConverter();
  } catch (e) {
    toLatex = null;
  }
  if (toLatex && toLatex !== asciimathInlineFallback) {
    // 拿到 asciimath-to-latex 库：走完整流水线（就地转换）
    const protected_ = protectFenced(src);
    const noMathML = convertMathMLPass(protected_.text);
    const withAm = convertBackticksOutsideMath(noMathML, toLatex);
    return restoreFenced(withAm, protected_.store);
  }
  // 库不可用：委托同步入口（内置子集）
  return preprocessMathSync(src);
}