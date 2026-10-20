// test/render-pos-check.mjs — task-2 regression test (no new dependencies, runs offline)
//
// Bug 1 (SEVERE): our custom inline rules returned `true` in markdown-it silent mode
// BEFORE advancing `state.pos`, so markdown-it threw
//   "inline rule didn't increment state.pos"  (block: "block rule didn't increment state.line")
// and the whole document failed to render. Minimal repro: render('[FeynCalc 官方 \\(B_0\\)')
// because the leading '[' makes markdown-it's link rule call skipToken(), which probes our
// rules with silent=true.
//
// Bug 2: `\slashed` (LaTeX slashed package / Feynman slash notation) was undefined in KaTeX,
// producing hundreds of "Undefined control sequence: \slashed" error cards in the user's
// physics documents. A built-in macro now maps it to KaTeX's bundled \cancel.
//
// What this test asserts:
//   A. the repros and a deterministic parser fuzz corpus never throw
//   B. every custom inline/block rule advances pos/line on every successful call,
//      silent or not (markdown-it's documented contract)
//   C. silent=false output is byte-identical to the pre-fix renderer for 24 frozen goldens
//      (frozen 2026-10-20 from `git show HEAD:core/renderer.mjs`; re-freeze only for an
//      intentional, reviewed rendering change)
//   D. `\slashed` renders with a real diagonal slash and no mdl-math-error card
//   E. the real-world documents that used to throw now render (skipped if not present)
//
// Run: node test/render-pos-check.mjs   -> exit 0

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { makeRenderer, render } from '../core/renderer.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hasErrCard = (h) => /<div class="mdl-math-error">/.test(h);

let failures = 0;
let checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) return true;
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
  return false;
}
function section(name) { console.log('\n== ' + name); }

// ---------------------------------------------------------------- A. repros
section('A. silent-mode repros do not throw');
const REPROS = [
  '[FeynCalc 官方 \\(B_0\\)',
  '[foo $x$ bar',
  '[text \\(a\\)](u)',
  '[text $a$](u)',
  'see [link](u) and \\(a\\)',
  '[ [[a]] ](u)',
  'para\n$$\nx^2\n$$\n',
  'para\n\\[\nx^2\n\\]\n',
  'text $$\nx',
  '[\\[x\\]](u)',
  '![alt \\(x\\)](img.png)',
  '[[a]] [text \\(b\\)](u)',
];
for (const src of REPROS) {
  let r = null, err = null;
  try { r = render(src); } catch (e) { err = e; }
  ok(!err, 'render does not throw: ' + JSON.stringify(src), err && (err.message + '\n' + err.stack));
  if (r) ok(!hasErrCard(r.html), 'no error card: ' + JSON.stringify(src));
}
// the exact minimal repro: the math must actually render, '[' stays literal text
{
  const h = render('[FeynCalc 官方 \\(B_0\\)').html;
  ok(h.includes('data-src="B_0"'), 'repro renders the \\(B_0\\) math', h.slice(0, 200));
  ok(!h.includes('\\(B_0\\)'), 'repro consumed the LaTeX delimiters', h.slice(0, 200));
}

// ------------------------------------------------- B. structural pos contract
section('B. custom rules advance pos/line on every successful call');
const OUR_RULES = new Set(['mdl_latex_inline', 'mdl_math', 'mdl_wikilink', 'mdl_math_block', 'mdl_latex_block']);
{
  const r = makeRenderer();
  const bad = [];
  const wrap = (ruler, key, kind) => {
    for (const rule of ruler.__rules__) {
      if (!OUR_RULES.has(rule.name)) continue;
      const orig = rule.fn;
      rule.fn = function (state, silent) {
        const before = state[key];
        const ret = orig.call(this, state, silent);
        const after = state[key];
        if (ret && !(after > before)) bad.push(kind + ' ' + rule.name + ' ret=true silent=' + !!silent + ' pos ' + before + '->' + after);
        if (!ret && after !== before) bad.push(kind + ' ' + rule.name + ' ret=false silent=' + !!silent + ' pos moved ' + before + '->' + after);
        return ret;
      };
    }
  };
  wrap(r.md.inline.ruler, 'pos', 'inline');
  wrap(r.md.block.ruler, 'line', 'block');
  const corpus = REPROS.concat([
    '$x$', '\\(x\\)', '\\[x\\]', '$$x$$', 'a [[b]] c', '![[x]]', '- $x$\n- \\(y\\)',
    '| $a$ | \\[b\\] |\n| --- | --- |', '> [[a]] $x$', '```\n$x$\n```', '**[[a]]** $x$',
  ]);
  // deterministic fuzz (no randomness across runs)
  const alpha = ['[', ']', '(', ')', '$', '\\', '{', '}', '|', 'a', 'x', '_', '^', ' ', '\n', '.', '!', '-'];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 1200; i++) {
    let s = '';
    const n = Math.floor(rnd() * 22);
    for (let j = 0; j < n; j++) s += alpha[Math.floor(rnd() * alpha.length)];
    corpus.push(s);
  }
  let thrown = 0;
  for (const src of corpus) {
    try { r.render(src); } catch (e) { thrown++; if (thrown < 4) console.log('  throw on ' + JSON.stringify(src) + ': ' + e.message); }
  }
  ok(thrown === 0, 'renderer never throws over ' + corpus.length + ' sources (12 repros + 1200 fuzz)', thrown + ' throws');
  ok(bad.length === 0, 'every custom rule call honours the pos/line contract', bad.slice(0, 6).join('\n     '));
}

// ------------------------------------------------- C. frozen golden parity
section('C. silent=false output byte-identical to the pre-fix renderer');
// sha256(render(src).html) with `git show HEAD:core/renderer.mjs` + current core/mathfmts.mjs.
const GOLD = {
  '[[a]]': 'fea8b29b39db066e5e88fc1e576bc0e0b17ce30d31f58312fef66022f3edbc90',
  '[[a|label]]': '8a0a03838540c1ce8ffc76c1f6c0ae53d15362e49dafc44c6be641c52aed1ef6',
  'x [[a]] y [[b|c]] z': '0c14a1698b63d09eda4f711a12dc5414b4fb8062775c8321835611697aa903a1',
  '![[a]]': '34574194279abda58e89853f2f254fb68840509ac22a7a0adf5360fb2e586d06',
  '[[a]] and [[b]]': 'b4484d1e6e459608e2963f1f4461379854de74083a8d721e276a1e9102738365',
  '$x$': '889550bd794546062026fa76e994faba05ae69b308fc7c3ebe2f7c48611ac67d',
  '\\(x\\)': '889550bd794546062026fa76e994faba05ae69b308fc7c3ebe2f7c48611ac67d',
  'a $x^2$ b': 'ab4eaaf35fba1a2265ad397d4b3c22041e0034f25ab8256c4d644c3212b5986f',
  '$x_1$': '29630df77aa12d9a668f48cf7af31a99a5334928fe02e8baa912befa1e5ca944',
  '$$x^2$$': '9fd94994cee575fbe15b7174fa5ccc26b268e61553b84ace96cc89c6f3124658',
  '$$\nx^2\n$$': '9fd94994cee575fbe15b7174fa5ccc26b268e61553b84ace96cc89c6f3124658',
  '\\[x\\]': '94bf496a26a3de044c5c8483916bd6bd770e6e7fbc6efb07c10b19ea0fb787cf',
  '\\[\nx^2\n\\]': '9fd94994cee575fbe15b7174fa5ccc26b268e61553b84ace96cc89c6f3124658',
  '100$ and $200': 'a44e3c3d7421c39818f7da10b8ea574e60e8a4bb191349cfe6407c639b88495f',
  '$5 and $6': 'e38cda5f87e88a1a8e2fc0145cdbd4accaa5e9f48678a192f112a187ad2dff51',
  // re-frozen 2026 for task-5: "$ x$" is now math (a space after the opener is allowed so
  // that the author's real "$ (m_i^2+m_j^2-p^2)B_0/2$" renders); the content test rejects prose.
  '$ x$': '5e4a3621ca552152ce46f375dde6818fdbd26390c385629dd36fa0fc922f3cf6',
  '$x $': '9becd49852251c7e672f27c9a23f823b85719ecc621b140e807c4f1132f4f99c',
  '`$x$` and `\\(y\\)`': 'fa9338d8ef231a0ca6da4835b38fa7fd4da27739cac607f1c7c68444bd4a14ab',
  '# Head [[a]] $x$': '295bd2e1de986ff4219fee3f23c020e6a872e3bfe670e7cf4ea81b8db61a4430',
  '| a | b |\n| --- | --- |\n| $x$ | \\[y\\] |': '95b234efff0d3c4ee76c8a9159eb559d6bbc2ce90fee3ec599f489f286057252',
  '```\n$x$ \\(y\\) $$z$$\n```': '32f0e08b99babb6d2ed3302246d62a722bc89140626891b6cf759168bb64b4cc',
  '*a* **b** ~~c~~': '88f0482182b385a2fb7d93cf9a4a25d730bccff8f91551fb7ad075edcb3e46fb',
  '\\slashed{p}': '2bffe503a568bf6ecc9b885aafc562abb39bf2408abd093c782194fd7f101469', // bare, NOT math -> still literal text
  '\\bar L_\\ell^i\\slashed kL_\\ell^j': '0c035c3fee4a8fafc4a295bf793aa7168e87816df995efecaab26d7ef8c54619',
};
for (const [src, want] of Object.entries(GOLD)) {
  let got = null;
  try { got = sha(render(src).html); } catch (e) { ok(false, 'golden render threw: ' + JSON.stringify(src), e.message); continue; }
  ok(got === want, 'golden html ' + JSON.stringify(src), 'want ' + want + '\n     got  ' + got);
}

// ------------------------------------------------- D. \slashed macro
section('D. \\slashed built-in macro');
// sha256(render(src).html) with the fixed renderer. Before the fix each of these produced an
// "Undefined control sequence: \\slashed" card and no <line> slash at all.
const SLASH = {
  '$\\slashed{p}$': '51136fd74197d830088e9f638028b5cbdb99072dfb4db48851131f4f496bda51',
  '$\\bar L_\\ell^i\\slashed kL_\\ell^j$': 'a3a83f9760d5028ff9b5968c062b75964aeaea05719e222f22308748d5b73201',
  '$\\frac1{\\slashed p-M_E}$': 'e4079489899c129cef0cf09b2fa4a484b2ad987105fd60ef8c2cc0004a333208',
  '$V_S=-\\sum_\\ell\\frac{s_\\ell v_\\ell}{k^2-M_\\ell^2}\\bar\\ell_R\\slashed k\\ell_R.$': 'd1fde614ff31f71e28e1dd9e8df0d049fda8a0ef30d48874f217f09edc8b385c',
  '$$\\slashed p = \\gamma^\\mu p_\\mu$$': 'c53cd867cf09ea60285935f72e2156b771666d4bee3181802357b6299a2cb16d',
  '$i\\slashed D$': '0f1c52ca52b4c4c89d1a21ba23da36f500ac3dcef12f9382fb9b4afb29887058',
  '$\\slashed k+\\slashed p$': '518822667902fe033422d0afe7bbd146992b270b1cfcfa3596459271ff8e267e',
};
const SLASH_LINE = /<line x1="0" y1="100%" x2="100%" y2="0"/;
for (const [src, want] of Object.entries(SLASH)) {
  let h = null;
  try { h = render(src).html; } catch (e) { ok(false, 'slashed render threw: ' + src, e.message); continue; }
  ok(!hasErrCard(h), 'no mdl-math-error card: ' + src, h.slice(0, 300));
  ok(SLASH_LINE.test(h), 'emits a diagonal slash (<line x1="0" y1="100%" x2="100%" y2="0">): ' + src);
  ok(sha(h) === want, 'slashed html ' + src, 'want ' + want + '\n     got  ' + sha(h));
}
{ // two slashes -> two slash marks; repeated renders stay stable (no macro-table duplication/leak)
  const a = render('$\\slashed k+\\slashed p$').html;
  const b = render('$\\slashed k+\\slashed p$').html;
  ok((a.match(/<line x1="0" y1="100%"/g) || []).length === 2, 'two \\slashed -> two slash marks');
  ok(a === b, 'repeated renders are stable (macro table does not grow)');
  const c = render('$\\slashed p$').html;
  ok(!hasErrCard(c) && SLASH_LINE.test(c), '\\slashed still defined after a multi-macro document');
}
{ // a document-level \newcommand may still override the built-in without breaking rendering
  const h = render('\\newcommand{\\slashed}[1]{\\not #1}\n\n$\\slashed p$').html;
  ok(!hasErrCard(h), 'user \\newcommand{\\slashed} override still renders');
}

// ------------------------------------------------- E. real documents
section('E. real-world documents that used to throw');
// Optional: point MDLIGHT_REAL_DOCS at your own corpus (a ';'-separated list of
// .md files) to run these two assertions against documents that really broke
// the renderer. Absent files are skipped, so the suite stays green everywhere.
const DOCS = (process.env.MDLIGHT_REAL_DOCS || '').split(';').map((s) => s.trim()).filter(Boolean);
if (!DOCS.length) console.log('SKIP (set MDLIGHT_REAL_DOCS to run)');
for (const p of DOCS) {
  if (!existsSync(p)) { console.log('SKIP (not present) ' + p); continue; }
  const src = readFileSync(p, 'utf8');
  let err = null, h = null;
  try { h = render(src, { path: p }).html; } catch (e) { err = e; }
  ok(!err, 'renders without throwing: ' + p.split('\\').pop(), err && err.message);
  ok(!err && !/Undefined control sequence: \\slashed/.test(h), 'no \\slashed cards: ' + p.split('\\').pop());
}

console.log('\n' + (failures ? 'FAILED ' + failures + '/' + checks + ' checks' : 'OK — ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
