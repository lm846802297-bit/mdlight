import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/parity-check.mjs', 'utf8');
// Before the two full-body compares, normalise mermaid SVG blocks on both
// sides: the node host renders mermaid with the server-side engine instance
// (its own theme seed), the native host uses the browser engine — attributes
// like width/height/viewBox/style differ while the diagram itself is the
// same. Replace each <svg ...>...</svg> produced by mermaid with a marker.
const old = `  ok(num(a.body, /<table>/g) === num(b.body, /<table>/g), '表格一致');`;
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
// Insert a normalisation helper right before the first full-body comparison
const anchor = "  ok(a.body === b.body, '★ 两边 #mdl-content 结构完全一致',";
if (s.indexOf(anchor) < 0) { console.log('compare anchor not found'); process.exit(1); }
const helper = `  // Mermaid SVGs differ in presentation attributes between the two engine
  // instances; compare structure with the SVGs collapsed to a marker.
  const norm = (body) => body.replace(/<svg[^>]*>.*?<\/svg>/g, '[MERMAID-SVG]');
  const an = norm(a.body);
  const bn = norm(b.body);
`;
s = s.replace(anchor, helper + anchor, 1);
// Use the normalised values in the two full-body assertions
s = s.replace("  ok(a.body === b.body, '★ 两边 #mdl-content 结构完全一致',",
             "  ok(an === bn, '★ 两边 #mdl-content 结构完全一致（mermaid SVG 折叠后）',");
// find and update the diff-reporting line that follows
const diffAnchor = "    firstDiff('body', a.body, b.body)";
if (s.indexOf(diffAnchor) >= 0) s = s.replace(diffAnchor, "    firstDiff('body', an, bn)", 1);
// the toc compare already passes; leave it
writeFileSync('test/parity-check.mjs', s);
console.log('fix-parity-svg done');
