import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/parity-check.mjs', 'utf8');
// Replace the grab loop: wait for h1 + TOC items (if server-side TOC present) + mermaid done
const old = `    for (let i = 0; i < 40; i++) {
      await sleep(500);
      let ready = await evaluate(
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
if (s.indexOf(old) < 0) { console.log('grab loop anchor not found'); process.exit(1); }
const nw = `    for (let i = 0; i < 40; i++) {
      await sleep(500);
      // Ready when: h1 exists, all mermaid settled, AND either the TOC is
      // populated (client-side host) or there is no server-side TOC JSON
      // (i.e. the node host always has a TOC in the page for the test doc).
      let ready = await evaluate(
        "!!document.querySelector('#mdl-content h1') && " +
        "(document.querySelector('.mdl-toc-inner .mdl-toc-item') || " +
        " !document.body.hasAttribute('data-live')) && " +
        "document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === " +
        "document.querySelectorAll('#mdl-content x-mermaid').length");
      if (ready) break;
      if (i === 20) {
        await sleep(3000);
        ready = await evaluate(
          "!!document.querySelector('#mdl-content h1') && " +
          "(document.querySelector('.mdl-toc-inner .mdl-toc-item') || " +
          " !document.body.hasAttribute('data-live')) && " +
          "document.querySelectorAll('#mdl-content x-mermaid[data-mm-state]').length === " +
          "document.querySelectorAll('#mdl-content x-mermaid').length");
        if (ready) break;
      }
    }`;
s = s.replace(old, nw, 1);
writeFileSync('test/parity-check.mjs', s);
console.log('fix-parity-grab done');
