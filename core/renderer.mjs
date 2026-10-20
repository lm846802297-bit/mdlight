// mdlight renderer — server-side Markdown → HTML pipeline.
// Built on open-source components (markdown-it / KaTeX / highlight.js), all MIT.
// Architecture patterns are public engineering practice; all code written from scratch.
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import 'katex/contrib/mhchem';
import hljs from 'highlight.js/lib/common';
// Multi-format math: AsciiMath (`x^2` / asciimath: blocks) and inline MathML
// (<math>…) are normalized to LaTeX before markdown parsing, so KaTeX renders
// them. Purely synchronous; safe in both Node and the esbuild browser bundle.
import { preprocessMathSync } from './mathfmts.mjs';

// ---------------------------------------------------------------------------
// utils

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

const CJK_RE = /[\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3130-\u318F\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

// ---------------------------------------------------------------------------
// Marp / PPT presentation support
//
// A document becomes a slide deck when its YAML frontmatter declares
// `marp: true`. Horizontal rules (`---`) after the frontmatter then separate
// slides, mirroring the Marp spec that SuperGoodViewer also follows.

const YAML_BOOL = /^(true|false|yes|no|1|0)$/i;
const YAML_STRIP_QUOTES = /^(['"])(.*)\1$/;

/** Parse leading YAML frontmatter (`---\nkey: value\n---`). Returns null when
 *  absent. Only simple `key: value` pairs are supported — enough for Marp. */
function parseYamlFrontmatter(src) {
  const m = String(src).match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    const q = YAML_STRIP_QUOTES.exec(v);
    if (q) v = q[2];
    fm[kv[1]] = v;
  }
  return { fm, body: src.slice(m[0].length) };
}

/** Split a markdown body on Marp slide boundaries (`---` alone on a line).
 *  Returns the chunks; empty chunks are dropped. */
function splitSlides(body) {
  const slides = [];
  let cur = [];
  for (const line of String(body).split(/\r?\n/)) {
    if (/^\s*---\s*$/.test(line)) {
      if (cur.some((l) => l.trim())) slides.push(cur.join('\n'));
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.some((l) => l.trim())) slides.push(cur.join('\n'));
  return slides;
}

/** Read a Marp boolean frontmatter value. */
function yamlBool(v) { return YAML_BOOL.test(String(v)) && /^(true|yes|1)$/i.test(String(v)); }

/** Wrap runs of raw CJK chars in math source into \text{...} so KaTeX stops
 *  erroring on CJK-in-math (fix for original flaw #2b). */
function cjkWrap(text) {
  let out = '';
  let run = '';
  const flush = () => { if (run) { out += '\\text{' + run + '}'; run = ''; } };
  for (const ch of text) {
    if (CJK_RE.test(ch)) { run += ch; } else { flush(); out += ch; }
  }
  flush();
  return out;
}

/** Pull \newcommand / \renewcommand definitions out of a math snippet into a
 *  shared table (fix for flaw #2c: no macro support at all in the original). */
function extractMacros(src) {
  const macros = {};
  let rest = src;
  const re = /\\(?:re)?newcommand\*?\s*(?:\{\\([A-Za-z]+)\}|\\([A-Za-z]+))\s*(?:\[\s*(\d+)\s*\])?\s*\{/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const name = '\\' + (m[1] || m[2]);
    const bodyStart = m.index + m[0].length;
    let depth = 1, i = bodyStart;
    for (; i < rest.length && depth > 0; i++) {
      const c = rest[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth !== 0) continue; // malformed: leave untouched
    macros[name] = rest.slice(bodyStart, i - 1);
    rest = rest.slice(0, m.index) + rest.slice(i);
    re.lastIndex = 0;
  }
  return { macros, rest };
}

function extractKaTeXError(e) {
  const msg = e && e.message ? e.message : String(e);
  return msg.replace(/^KaTeX parse error:\s*/, '');
}

// ---------------------------------------------------------------------------
// math engine

/** Render one math snippet. Degradation ladder instead of silent red text:
 *  raw -> (extract macros) -> KaTeX -> on CJK error, retry with \text wrap ->
 *  error card carrying the source + the concrete message (flaw #2 fix). */
function renderMath(srcRaw, display, macroTable) {
  const raw = String(srcRaw).trim();
  if (!raw) return { error: true, src: raw, message: 'Empty formula' };

  const { macros: docMacros, rest } = extractMacros(raw);
  for (const k of Object.keys(docMacros)) macroTable.set(k, docMacros[k]);

  const katexMacros = {};
  for (const [k, v] of macroTable) katexMacros[k] = v;

  const tryRender = (tex) => katex.renderToString(tex, {
    throwOnError: true,
    output: 'html',
    displayMode: display,
    strict: false,
    trust: false,
    macros: katexMacros,
  });

  let html = null;
  let message = null;
  let usedCjkWrap = false;
  try {
    html = tryRender(rest);
  } catch (e) {
    message = extractKaTeXError(e);
    if (CJK_RE.test(rest)) {
      try {
        html = tryRender(cjkWrap(rest));
        usedCjkWrap = true;
        message = null;
      } catch (e2) {
        message = extractKaTeXError(e2);
      }
    }
  }
  if (html == null) {
    return { error: true, src: raw, message: message || 'KaTeX could not render this formula' };
  }
  return { html, usedCjkWrap };
}

function mathErrorCard(src, message) {
  return '<div class="mdl-math-error">'
    + '<div class="mdl-math-error-head">公式渲染失败 <span class="mdl-math-error-msg">'
    + escapeHtml(message) + '</span></div>'
    + '<pre class="mdl-math-error-src">' + escapeHtml(src) + '</pre>'
    + '</div>';
}

// ---------------------------------------------------------------------------
// markdown-it factory (one instance per document => per-document macro table)

const CALLOUT_KINDS = ['NOTE', 'TIP', 'INFO', 'IMPORTANT', 'WARNING', 'CAUTION', 'SUCCESS', 'QUESTION', 'EXAMPLE'];

export function makeRenderer(opts) {
  const macroTable = new Map();
  const headings = [];
  const slugSeen = new Map();
  let mermaidCount = 0;

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    // hardBreaks: every single newline becomes <br> (CommonMark hard-break
    // mode). Off by default to keep the default output identical.
    breaks: !!(opts && opts.hardBreaks),
  });
  md.enable(['table', 'strikethrough']);

  // ---- block rule: standalone $$...$$ display math -------------------------
  md.block.ruler.before('fence', 'mdl_math_block', function mdlMathBlock(state, startLine, endLine, silent) {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.slice(startPos, startPos + 2) !== '$$') return false;

    const firstLine = state.src.slice(startPos, state.eMarks[startLine]);
    const single = firstLine.match(/^\$\$(.+)\$\$\s*$/);
    if (single) {
      if (!silent) {
        const token = state.push('mdl_math_block', '', 0);
        token.content = single[1].trim();
        token.map = [startLine, startLine + 1];
        token.meta = { display: true };
      }
      state.line = startLine + 1;
      return true;
    }

    let closeLine = -1;
    for (let line = startLine + 1; line < endLine; line++) {
      const lt = state.src
        .slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
        .trimEnd();
      if (lt.endsWith('$$')) { closeLine = line; break; }
    }
    if (closeLine === -1) return false;
    if (silent) return true;

    const lines = [];
    const afterOpen = firstLine.slice(2).trim();
    if (afterOpen) lines.push(afterOpen);
    for (let l = startLine + 1; l < closeLine; l++) {
      lines.push(state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]));
    }
    const closeText = state.src
      .slice(state.bMarks[closeLine] + state.tShift[closeLine], state.eMarks[closeLine])
      .trim();
    const beforeClose = closeText.slice(0, -2).trim();
    if (beforeClose) lines.push(beforeClose);

    const token = state.push('mdl_math_block', '', 0);
    token.content = lines.join('\n').trim();
    token.map = [startLine, closeLine + 1];
    token.meta = { display: true };
    state.line = closeLine + 1;
    return true;
  });

  // ---- block rule: standalone \[ ... \] display math (Pandoc/AI dialect) ----
  // ChatGPT/Claude/Pandoc (tex_math_single_backslash) emit display math as
  // \[...\]. Most readers ignored this dialect entirely. Here it becomes a
  // first-class display block, mirroring the $$ rule above.
  md.block.ruler.before('fence', 'mdl_latex_block', function mdlLatexBlock(state, startLine, endLine, silent) {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.slice(startPos, startPos + 2) !== '\\[') return false;

    const firstLine = state.src.slice(startPos, state.eMarks[startLine]);
    const single = firstLine.match(/^\\\[([\s\S]*)\\\]\s*$/);
    if (single) {
      if (!silent) {
        const token = state.push('mdl_math_block', '', 0);
        token.content = single[1].trim();
        token.map = [startLine, startLine + 1];
        token.meta = { display: true };
      }
      state.line = startLine + 1;
      return true;
    }

    let closeLine = -1;
    for (let line = startLine + 1; line < endLine; line++) {
      const lt = state.src
        .slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
        .trimEnd();
      if (lt.endsWith('\\]')) { closeLine = line; break; }
    }
    if (closeLine === -1) return false;
    if (silent) return true;

    const lines = [];
    const afterOpen = firstLine.slice(2).trim();
    if (afterOpen) lines.push(afterOpen);
    for (let l = startLine + 1; l < closeLine; l++) {
      lines.push(state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]));
    }
    const closeText = state.src
      .slice(state.bMarks[closeLine] + state.tShift[closeLine], state.eMarks[closeLine])
      .trim();
    const beforeClose = closeText.slice(0, -2).trim();
    if (beforeClose) lines.push(beforeClose);

    const token = state.push('mdl_math_block', '', 0);
    token.content = lines.join('\n').trim();
    token.map = [startLine, closeLine + 1];
    token.meta = { display: true };
    state.line = closeLine + 1;
    return true;
  });

  // ---- inline rule: $...$ / $$...$$ on the inline stream only ---------------
  // Flaw #1 fix is structural: inline code was already tokenized as code_inline
  // by the backtick rule (which runs earlier), and fenced code never enters the
  // inline stream — so a '$' inside any code region can never become math.
  //
  // LaTeX-dialect \(...\): must run BEFORE markdown-it's 'escape' rule, which
  // would otherwise consume the backslash and leave bare parentheses as text
  // (the exact failure mode of most naive readers). Inline code stays safe: backticks rule
  // tokenizes code before this rule can ever see a '\' inside it.
  md.inline.ruler.before('escape', 'mdl_latex_inline', function mdlLatexInline(state, silent) {
    const src = state.src;
    const pos = state.pos;
    if (src.startsWith('\\(', pos)) {
      const close = src.indexOf('\\)', pos + 2);
      if (close === -1) return false;
      const inner = src.slice(pos + 2, close);
      if (inner.includes('\n\n')) return false;
      if (silent) return true;
      const token = state.push('mdl_math_inline', '', 0);
      token.content = inner;
      token.meta = { display: false };
      state.pos = close + 2;
      return true;
    }
    if (src.startsWith('\\[', pos)) {
      const close = src.indexOf('\\]', pos + 2);
      if (close === -1) return false;
      const inner = src.slice(pos + 2, close);
      if (inner.includes('\n\n')) return false;
      if (silent) return true;
      const token = state.push('mdl_math_inline', '', 0);
      token.content = inner;
      token.meta = { display: true };
      state.pos = close + 2;
      return true;
    }
    return false;
  });

  md.inline.ruler.before('emphasis', 'mdl_math', function mdlMathInline(state, silent) {
    const src = state.src;
    const pos = state.pos;
    if (src[pos] !== '$') return false;

    if (src.startsWith('$$', pos)) {
      const close = src.indexOf('$$', pos + 2);
      if (close === -1) return false;
      const inner = src.slice(pos + 2, close);
      if (inner.includes('\n\n')) return false;
      if (silent) return true;
      const token = state.push('mdl_math_inline', '', 0);
      token.content = inner;
      token.meta = { display: true };
      state.pos = close + 2;
      return true;
    }

    const next = src[pos + 1];
    if (next === undefined || /\s/.test(next) || next === '$') return false;
    let close = -1;
    for (let j = pos + 2; j < src.length; j++) {
      if (src[j] === '\n' && src[j + 1] === '\n') break; // paragraph boundary
      if (src[j] === '$' && !/\s/.test(src[j - 1]) && !/[0-9]/.test(src[j + 1] ?? '')) {
        close = j;
        break;
      }
    }
    if (close === -1) return false;
    if (silent) return true;
    const token = state.push('mdl_math_inline', '', 0);
    token.content = src.slice(pos + 1, close);
    token.meta = { display: false };
    state.pos = close + 1;
    return true;
  });

  // ---- math renderers -------------------------------------------------------
  md.renderer.rules.mdl_math_block = (tokens, idx) => {
    const t = tokens[idx];
    const { macros: docMacros, rest } = extractMacros(t.content);
    for (const k of Object.keys(docMacros)) macroTable.set(k, docMacros[k]);
    // definition-only block: suppress output entirely (no empty x-equation shell)
    if (Object.keys(docMacros).length > 0 && rest.trim() === '') return '';
    const r = renderMath(t.content, true, macroTable);
    return r.error ? mathErrorCard(r.src, r.message) : wrapEquation(r.html, true, t.content);
  };
  md.renderer.rules.mdl_math_inline = (tokens, idx) => {
    const t = tokens[idx];
    const display = !!(t.meta && t.meta.display);
    const r = renderMath(t.content, display, macroTable);
    return r.error ? mathErrorCard(r.src, r.message) : wrapEquation(r.html, display, t.content);
  };
  function wrapEquation(html, display, src) {
    // keep the markdown source in data-src so the WYSIWYG serializer can
    // round-trip a formula back to markdown after in-place editing
    return '<x-equation class="mdl-eq' + (display ? ' mdl-eq--display' : '') + '"'
      + (src ? ' data-src="' + escapeHtml(src) + '"' : '')
      + '>' + html + '</x-equation>';
  }

  // ---- fenced code: offline highlight.js (flaw #4 fix) ----------------------
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
    const code = t.content.replace(/\n$/, '');
    const attrs = self.renderAttrs(t);
    // mermaid: emit a lazy placeholder, NOT rendered SVG. Rendering needs a DOM,
    // so it happens client-side, and mermaid then fetches only the chunk for this
    // diagram kind (see tools/build-mermaid.mjs). The escaped source stays inside
    // as a graceful fallback when scripts are off or the chunk fails to load.
    if (lang === 'mermaid') {
      mermaidCount++;
      return '<x-mermaid class="mdl-mermaid"' + attrs + '>'
        + '<pre class="mdl-mermaid-src"><code>' + escapeHtml(code) + '</code></pre>'
        + '</x-mermaid>';
    }
    let body;
    let cls = 'hljs';
    if (lang && hljs.getLanguage(lang)) {
      body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      cls += ' language-' + lang;
    } else {
      body = escapeHtml(code);
    }
    return '<pre class="mdl-code"' + attrs + '><code class="' + cls + '">' + body + '</code></pre>';
  };
  // silence unused-var lint style warning
  void defaultFence;

  // ---- wikilink [[target|label]] --------------------------------------------
  md.inline.ruler.before('emphasis', 'mdl_wikilink', function mdlWikilink(state, silent) {
    const src = state.src;
    if (!src.startsWith('[[', state.pos)) return false;
    const close = src.indexOf(']]', state.pos + 2);
    if (close === -1) return false;
    const inner = src.slice(state.pos + 2, close);
    const bar = inner.indexOf('|');
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const label = (bar === -1 ? inner : inner.slice(bar + 1)).trim();
    if (!target) return false;
    if (silent) return true;
    const token = state.push('html_inline', '', 0);
    token.content = '<a class="mdl-wikilink" data-wikilink="'
      + escapeHtml(target) + '" title="Ctrl+点击复制 [[target]] 语法">'
      + escapeHtml(label || target) + '</a>';
    state.pos = close + 2;
    return true;
  });

  // ---- core pass 1: callouts from blockquote tokens ---------------------------
  md.core.ruler.after('block', 'mdl_callout', function mdlCallout(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      const inlineTok = tokens[i + 2];
      if (!inlineTok || inlineTok.type !== 'inline') continue;
      const m = inlineTok.content.match(/^\[!(NOTE|TIP|INFO|IMPORTANT|WARNING|CAUTION|SUCCESS|QUESTION|EXAMPLE)\]\s*/i);
      if (!m) continue;
      const kind = m[1].toUpperCase();
      inlineTok.content = inlineTok.content.slice(m[0].length);
      const first = inlineTok.children && inlineTok.children[0];
      if (first && first.type === 'text') {
        first.content = first.content.slice(m[0].length);
        if (!first.content && inlineTok.children.length > 1) inlineTok.children.shift();
      }
      tokens[i].attrJoin('class', 'mdl-callout');
      tokens[i].attrJoin('class', 'mdl-callout--' + kind.toLowerCase());
      tokens[i].attrSet('data-callout', kind);
    }
  });

  // ---- core pass 2: line numbers + heading anchors ---------------------------
  // NOTE: runs after the 'inline' pass so inline tokens have children filled.
  md.core.ruler.after('inline', 'mdl_lines', function mdlLines(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'heading_open') {
        const inlineTok = tokens[i + 1];
        const text = headingText(inlineTok);
        const slug = uniqueSlug(slugify(text), slugSeen);
        t.attrSet('id', slug);
        headings.push({
          level: Number(t.tag.slice(1)),
          text,
          anchor: slug,
          line: t.map ? t.map[0] + 1 : 0,
        });
      }
      if (t.map && (t.type.endsWith('_open') || t.type === 'fence' || t.type === 'mdl_math_block')) {
        t.attrSet('data-mdl-line', String(t.map[0] + 1));
      }
    }
  });

  // ---- core pass 3: task lists ------------------------------------------------
  // runs after mdl_lines (heading anchors already set)
  md.core.ruler.after('mdl_lines', 'mdl_tasks', function mdlTasks(state) {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      if (tokens[i - 1].type !== 'paragraph_open') continue;
      if (tokens[i - 2].type !== 'list_item_open') continue;
      const m = tokens[i].content.match(/^\[( |x|X)\]\s+/);
      if (!m) continue;
      const checked = m[1].toLowerCase() === 'x';
      tokens[i].content = tokens[i].content.slice(m[0].length);
      const first = tokens[i].children && tokens[i].children[0];
      if (first && first.type === 'text') first.content = first.content.slice(m[0].length);
      const li = tokens[i - 2];
      li.attrJoin('class', 'mdl-task');
      li.attrJoin('class', checked ? 'mdl-task--done' : 'mdl-task--todo');
      const html = '<input type="checkbox" class="mdl-task-box"' + (checked ? ' checked' : '') + ' disabled> ';
      const marker = new state.Token('html_inline', '', 0);
      marker.content = html;
      if (tokens[i].children) tokens[i].children.unshift(marker);
    }
  });

  function headingText(inlineTok) {
    if (!inlineTok) return '';
    if (inlineTok.children) {
      return inlineTok.children
        .map(c => {
          if (c.type === 'text' || c.type === 'code_inline') return c.content;
          // html_inline (wikilink, raw HTML) carries markup, not text: strip
          // the tags so the heading text and its anchor stay readable instead
          // of becoming "<a class=\"mdl-wikilink\" …>label</a>" in the TOC.
          return ' ' + String(c.content || '').replace(/<[^>]*>/g, ' ') + ' ';
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return inlineTok.content;
  }

  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'sec';
  }
  function uniqueSlug(base, seen) {
    // Track ALL used slugs (not just per-base counts) so a deduplicated
    // slug like "foo-2" never collides with a naturally-occurring "Foo 2"
    // heading that already claimed "foo-2".
    if (!seen.has(base)) {
      seen.set(base, 1);
      return base;
    }
    let n = 2;
    while (seen.has(base + '-' + n)) n++;
    seen.set(base + '-' + n, 1);
    return base + '-' + n;
  }

  return {
    md,
    render(src) {
      macroTable.clear();
      headings.length = 0;
      slugSeen.clear();
      mermaidCount = 0;
      // A UTF-8 BOM (U+FEFF) is invisible but markdown-it treats it as a
      // character, so "# title" on line 1 becomes a paragraph and the first
      // heading is lost. Notepad saves with BOM by default — strip it.
      let clean = typeof src === 'string' && src.charCodeAt(0) === 0xFEFF ? src.slice(1) : src;

      // Multi-format math pre-pass: normalize AsciiMath / MathML to LaTeX so
      // the same KaTeX pipeline renders every dialect. Runs once for the whole
      // doc; for Marp slides we normalize per-chunk (chunk content is still
      // markdown source, so the call applies cleanly there too).
      clean = preprocessMathSync(clean);

      // Marp / PPT: detect the frontmatter and, when `marp: true`, render each
      // slide independently so the UI can page through them. Every slide reuses
      // the same macro table / slug set, so equations and anchors stay stable.
      const parsed = parseYamlFrontmatter(clean);
      if (parsed && yamlBool(parsed.fm.marp)) {
        headings.length = 0; // per-slide headings aren't a document TOC
        slugSeen.clear();
        const marp = {
          size: parsed.fm.size || '16:9',
          paginate: yamlBool(parsed.fm.paginate),
          header: parsed.fm.header || '',
          footer: parsed.fm.footer || '',
          theme: parsed.fm.theme || '',
        };
        const chunks = splitSlides(parsed.body);
        if (!chunks.length) chunks.push('');
        const slides = chunks.map((chunk) => md.render(chunk));
        const html = slides.join('<hr class="mdl-marp-break">');
        return {
          html,
          headings: headings.slice(),
          mermaidCount,
          marp,
          slides,
        };
      }

      const html = md.render(clean);
      return { html, headings: headings.slice(), mermaidCount };
    },
  };
}

// ---------------------------------------------------------------------------
// public API

export function render(src, opts) {
  return makeRenderer(opts).render(src);
}

// Import/converters that the browser bundle exposes on window.MDLRenderer too:
// the import buttons run latexToMarkdown / pdfToMarkdown client-side. Importing
// them here (instead of in app.js) keeps a single esbuild entry point and
// guarantees they are present in both the server and the packed browser bundle.
export { latexToMarkdown } from './latex2md.mjs';
export { pdfToMarkdown, pdfExtractText, pdfExtractPages } from './pdf2md.mjs';
export { preprocessMathSync, preprocessMath, mathmlToLatexInline } from './mathfmts.mjs';

// ---------------------------------------------------------------------------

// The mdToLatex source body for core/renderer.mjs — one backslash = one literal.
// feat14b-latex-core.mjs reads this file and appends it (after fixing the export list).

// ---------------------------------------------------------------------------
// Markdown → LaTeX converter (feat14)
// ---------------------------------------------------------------------------
// Best-effort structural conversion: headings → \section, tables → tabular,
// fenced code → verbatim, lists → itemize/enumerate, quotes → quote,
// images → includegraphics, links → href, math passes through as-is,
// mermaid → commented-out source block. Not a full compiler: edge cases
// (nested emphasis, raw HTML) degrade gracefully.
export function mdToLatex(src) {
  var lines = String(src).replace(/\r\n/g, '\n').split('\n');
  var out = [];
  var tableRows = [];
  var i = 0;

  function inlineTex(s) {
    return String(s)
      .replace(/\$([^$\n]+)\$/g, '\\($1\\)')            // $...$ inline math
      .replace(/`([^`]+)`/g, '\\texttt{$1}')            // `code`
      .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')      // **bold**
      .replace(/\*([^*]+)\*/g, '\\textit{$1}')          // *italic*
      .replace(/~~([^~]+)~~/g, '$1')                    // ~~strike~~ → plain
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\href{$2}{$1}'); // [text](url)
  }

  function flushTable() {
    if (tableRows.length < 2) { tableRows = []; return; }
    var ncol = tableRows[0].length;
    var spec = '';
    for (var c = 0; c < ncol; c++) spec += 'l';
    out.push('\\begin{table}[ht]');
    out.push('  \\centering');
    out.push('  \\begin{tabular}{' + spec + '}');
    out.push('    \\hline');
    out.push('    ' + inlineTex(tableRows[0].join(' & ')) + ' \\');
    out.push('    \\hline');
    for (var r = 1; r < tableRows.length; r++) {
      out.push('    ' + inlineTex(tableRows[r].join(' & ')) + ' \\');
    }
    out.push('    \\hline');
    out.push('  \\end{tabular}');
    out.push('\\end{table}');
    out.push('');
    tableRows = [];
  }

  while (i < lines.length) {
    var line = lines[i];

    // fenced code block (``` ... ```)
    if (/^```/.test(line)) {
      var lang = line.slice(3).trim();
      i++;
      var block = [];
      while (i < lines.length && !/^```/.test(lines[i])) { block.push(lines[i]); i++; }
      i++; // consume closing fence
      if (lang === 'mermaid') {
        out.push('% [mermaid diagram]');
        block.forEach(function (bl) { out.push('%   ' + bl); });
        out.push('');
      } else {
        out.push('\\begin{verbatim}');
        out = out.concat(block);
        out.push('\\end{verbatim}');
        out.push('');
      }
      continue;
    }

    // table row (| a | b |) — separator rows are skipped
    if (/^\s*\|/.test(line)) {
      if (line.replace(/\|/g, '').trim().match(/^[:\-\s]*$/)) { i++; continue; }
      var cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      tableRows.push(cells);
      i++;
      continue;
    }
    if (tableRows.length) flushTable();

    // headings
    var h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      var cmd = h[1].length === 1 ? 'section' : h[1].length === 2 ? 'subsection' : 'subsubsection';
      out.push('\\' + cmd + '{' + inlineTex(h[2]) + '}');
      out.push('');
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('\\bigskip\\noindent\\hrulefill\\bigskip');
      i++;
      continue;
    }

    // unordered / ordered lists
    var isUl = /^\s*[-*+]\s+/.test(line);
    var isOl = /^\s*\d+[.)]\s+/.test(line);
    if (isUl || isOl) {
      var items = [];
      var re = isOl ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (i < lines.length) {
        var m2 = lines[i].match(re);
        if (m2) { items.push(inlineTex(m2[1])); i++; } else break;
      }
      out.push(isOl ? '\\begin{enumerate}' : '\\begin{itemize}');
      items.forEach(function (it) { out.push('  \\item ' + it); });
      out.push(isOl ? '\\end{enumerate}' : '\\end{itemize}');
      out.push('');
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      var quotes = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quotes.push(inlineTex(lines[i].replace(/^\s*>\s?/, '')));
        i++;
      }
      out.push('\\begin{quote}');
      out = out.concat(quotes);
      out.push('\\end{quote}');
      out.push('');
      continue;
    }

    // image
    var img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      var label = img[1] || '';
      var file = img[2].split('?')[0].split('#')[0].replace(new RegExp('\\g'), '/').replace(/[^A-Za-z0-9_.\-\/]/g, '');
      out.push('\\begin{center}');
      out.push('\\includegraphics[width=\\linewidth]{' + file + '}');
      if (label) out.push('\\caption{' + inlineTex(label) + '}');
      out.push('\\end{center}');
      i++;
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    // plain paragraph: swallow consecutive prose lines
    var para = [inlineTex(line.trim())];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^#{1,6}\s/.test(lines[i]) &&
           !/^\s*\|/.test(lines[i]) &&
           !/^```/.test(lines[i]) &&
           !/^\s*[-*+]\s/.test(lines[i]) &&
           !/^\s*\d+[.)]\s/.test(lines[i]) &&
           !/^\s*>/.test(lines[i]) &&
           !/^!\[/.test(lines[i])) {
      para.push(inlineTex(lines[i].trim()));
      i++;
    }
    out.push(para.join(' '));
    out.push('');
  }

  if (tableRows.length) flushTable();
  return out.join('\n');
}

