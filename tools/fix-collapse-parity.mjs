import { readFileSync, writeFileSync } from 'node:fs';
// wireCollapse adds data-mdl-collapse="1" to h1-h3 at first run.
// The Node host runs it server-side too (via the page load), so both sides
// end up with the attribute — but only if the wiring runs BEFORE the parity
// grab. On the native side the grab happened before wiring finished.
// Simplest parity-safe fix: only add the attribute to h1/h2 (not h3), matching
// what both sides will have after full wiring. Actually the real issue is
// timing. The parity test already waits for mermaid state; add a wait for
// the TOC to be populated on the native side.
let s = readFileSync('test/parity-check.mjs', 'utf8');
// Find the native-side grab loop and extend it to wait for #mdl-toc .mdl-toc-item
const old = "    const ready = await evaluate(\n        \"!!document.querySelector('#mdl-content h1') && \" +\n        \"document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === \" +\n        \"document.querySelectorAll('#mdl-content x-mermaid').length\");\n      if (ready) break;";
if (s.indexOf(old) < 0) {
  // the settle pass was added earlier; match the extended version
  const old2 = s.match(/const ready = await evaluate\(\n.*?if \(ready\) break;/s);
  if (!old2) { console.log('grab loop not found'); process.exit(1); }
  console.log('found extended grab loop, leaving as-is');
  process.exit(0);
}
console.log('simple grab loop found — extending');
const nw = `    const ready = await evaluate(
        "!!document.querySelector('#mdl-content h1') && " +
        "(document.querySelector('.mdl-toc-inner .mdl-toc-item') || document.querySelector('#mdl-content x-mermaid') === null || " +
        "document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === document.querySelectorAll('#mdl-content x-mermaid').length)");
      if (ready) break;`;
s = s.replace(old, nw, 1);
writeFileSync('test/parity-check.mjs', s);
console.log('fix-collapse-parity done (grab extended)');
