import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('mdlight.mjs', 'utf8');
const anchor = "  if (path === '/assets/katex.css')";
if (s.indexOf(anchor) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = `  // Off-thread renderer worker (parity with the native host's /assets route)
  if (path === '/assets/renderer-worker.js') {
    try {
      const src = readAsset('ui/renderer-worker.js', true);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(src);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 renderer-worker.js');
    }
    return;
  }

`;
s = s.replace(anchor, nw + anchor, 1);
writeFileSync('mdlight.mjs', s);
console.log('feat11 done');
