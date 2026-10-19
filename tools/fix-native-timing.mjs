import { readFileSync, writeFileSync } from 'node:fs';
// In the native (client-side) host, the page has data-live and __CLIENT_RENDER__=true,
// but the initial-load path (line ~2207-2214) assumes server-rendered content.
// Fix: when S.clientRender, run the full wiring after clientRender finishes (init does this),
// and skip the premature buildToc/renderStat/renderMermaid when client-side.
let s = readFileSync('ui/app.js', 'utf8');
const old = '  buildToc();\n  wireTocActive();\n  wireCollapse();\n  wireCodeLineno();\n  wireTableFullscreen();\n  wireEquationCopy();\n  renderStat();\n  renderMermaid();\n';
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = '  if (S.clientRender) {\n    // Native host: content is rendered by clientRender() + init() below;\n    // the heavy wiring there already covers TOC / stats / mermaid / collapse.\n  } else {\n    buildToc();\n    wireTocActive();\n    wireCollapse();\n    wireCodeLineno();\n    wireTableFullscreen();\n    wireEquationCopy();\n    renderStat();\n    renderMermaid();\n  }\n';
s = s.replace(old, nw, 1);
writeFileSync('ui/app.js', s);
console.log('fix-native-timing done');
