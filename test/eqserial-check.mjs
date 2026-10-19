// eqserial-check.mjs — verify equationSrc round-trips inline/display correctly
// after the W2 fix (inline math no longer promoted to display just because it
// contains a LaTeX command).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);

const api = require('../ui/mdserial.js');
const { equationSrc } = api;

// minimal DOM shim: only what equationSrc touches
function node(src, display) {
  return {
    getAttribute: (k) => (k === 'data-src' ? src : null),
    classList: { contains: (c) => c === 'mdl-eq--display' && !!display },
  };
}

const cases = [
  // [src, display, expected, label]
  ['x^2', false, '$x^2$', 'inline simple'],
  ['f(x)=\\frac{a}{b}', false, '$f(x)=\\frac{a}{b}$', 'inline with LaTeX cmd (W2: was wrongly promoted to display)'],
  ['\\int_0^1 x dx', false, '$\\int_0^1 x dx$', 'inline with backslash int'],
  ['E=mc^2', true, '$$E=mc^2$$', 'display block'],
  ['a & b', true, '$$a & b$$', 'display keeps ampersand'],
  ['\\begin{aligned}\n x &= 1\n\\end{aligned}', true, '$$\\begin{aligned}\n x &= 1\n\\end{aligned}$$', 'display keeps newlines'],
];

let pass = 0;
for (const [src, display, exp, label] of cases) {
  const got = equationSrc(node(src, display), false);
  const ok = got === exp;
  if (ok) pass++;
  else console.log(`  ✗ ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(exp)}`);
}
console.log(`${pass}/${cases.length} equationSrc round-trip cases pass`);

// also verify serialize() rejects the old buggy regex is gone
const src = require('node:fs').readFileSync(
  new URL('../ui/mdserial.js', import.meta.url), 'utf8');
assert.ok(!src.includes('\\\\[a-zA-Z]+\\\\s*\\\\'),
  'old "promote LaTeX-cmd formula to display" heuristic removed');
console.log('old heuristic removed: yes');

assert.equal(pass, cases.length, 'all cases must pass');
process.exit(pass === cases.length ? 0 : 1);
