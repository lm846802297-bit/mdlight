import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');
// Call maybeWrapVBlocks() right after paintContent's post-wiring line
const anchor = "if (post) { buildToc(); renderStat(); renderMermaid(); wireCollapse(); wireCodeLineno(); wireTableFullscreen(); wireTocActive(); wireEquationCopy(); }";
if (s.indexOf(anchor) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = anchor + "\n    maybeWrapVBlocks();";
s = s.replace(anchor, nw, 1);
writeFileSync('ui/app.js', s);
console.log('feat10b done');
