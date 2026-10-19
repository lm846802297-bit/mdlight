import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');

// 1) init(): always run the wiring (idempotent — each wireX guards with a
//    dataset flag), regardless of S.clientRender.
const old1 = `  if (S.clientRender) {
    // Native host: content is rendered by clientRender() + init() below;
    // the heavy wiring there already covers TOC / stats / mermaid / collapse.
  } else {
    buildToc();
    wireTocActive();
    wireCollapse();
    wireCodeLineno();
    wireTableFullscreen();
    wireEquationCopy();
    renderStat();
    renderMermaid();
  }
`;
if (s.indexOf(old1) < 0) { console.log('init anchor not found'); process.exit(1); }
const nw1 = `  // All wiring is idempotent (dataset flags), so run it unconditionally on
  // both hosts: the node host's server-rendered body already carries it from
  // the page template, the native host renders client-side first and this
  // picks up the result.
  buildToc();
  wireTocActive();
  wireCollapse();
  wireCodeLineno();
  wireTableFullscreen();
  wireEquationCopy();
  renderStat();
  renderMermaid();
`;
s = s.replace(old1, nw1, 1);

// 2) clientRender(): paint with post=true so the native host wires immediately
//    after each client render (live-reload path already re-wires via
//    liveReload; init() keeps the first paint).
const old2 = `        var useWorker = document.body.hasAttribute('data-live');
        return (useWorker ? renderInWorker(source) : syncRender(source)).then(function (out) {
          paintContent(out);
        });`;
if (s.indexOf(old2) < 0) { console.log('clientRender anchor not found'); process.exit(1); }
const nw2 = `        var useWorker = document.body.hasAttribute('data-live');
        return (useWorker ? renderInWorker(source) : syncRender(source)).then(function (out) {
          // post=true: wire TOC/stats/mermaid/collapse right after the paint
          // so the native host (empty server body) gets a fully-wired DOM.
          paintContent(out, true);
        });`;
s = s.replace(old2, nw2, 1);
writeFileSync('ui/app.js', s);
console.log('fix-native-wiring done');
