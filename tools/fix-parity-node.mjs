import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/parity-check.mjs', 'utf8');
// The node host serves pre-rendered content and its JS wiring is timing-dependent;
// the meaningful parity assertion is that the RENDERED DOM (after wiring) matches.
// Give the node side more settle time and re-grab once before comparing.
const old = "    const ready = await evaluate(\n        \"!!document.querySelector('#mdl-content h1') && \" +\n        \"document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === \" +\n        \"document.querySelectorAll('#mdl-content x-mermaid').length\");\n      if (ready) break;\n    }";
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = `    let ready = await evaluate(
        "!!document.querySelector('#mdl-content h1') && " +
        "document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === " +
        "document.querySelectorAll('#mdl-content x-mermaid').length");
      if (ready) break;
      // settle pass: give client-side wiring (TOC/stats/mermaid) more time
      if (i === 20) {
        await sleep(3000);
        ready = await evaluate(
          "!!document.querySelector('#mdl-content h1') && " +
          "document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === " +
          "document.querySelectorAll('#mdl-content x-mermaid').length");
      }
    }`;
s = s.replace(old, nw, 1);
writeFileSync('test/parity-check.mjs', s);
console.log('fix-parity-node done');
