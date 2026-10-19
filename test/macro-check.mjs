// macro regression check after def-block suppression fix
import { readFileSync } from 'node:fs';
import { render } from '../core/renderer.mjs';

const src = readFileSync(new URL('./fixtures/macro-args.md', import.meta.url), 'utf8');
const { html } = render(src);
console.log('errors:', (html.match(/mdl-math-error/g) || []).length);
console.log('partial(∂) expanded:', html.includes('∂') ? 'yes' : 'no');
console.log('empty display shells:', (html.match(/mdl-eq--display"><\/x-equation>/g) || []).length);
console.log('equations rendered:', (html.match(/<x-equation/g) || []).length);
// RR^n should have rendered via macro
const rr = html.match(/<x-equation[\s\S]{0,300}?RR|mathbb|double-struck/g);
console.log('mathbb visible:', /𝕠|mathbb|ds-font|double-struck/i.test(html) ? 'yes(∂RR)' : 'check');
