import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('mdlight.mjs', 'utf8');
const anchor = "  // Off-thread renderer worker (parity with the native host's /assets route)\n  if (path === '/assets/renderer-worker.js')";
if (s.indexOf(anchor) < 0) { console.log('anchor not found'); process.exit(1); }
const nw = `  // Browser build of core/renderer.mjs — the classic <script> the page loads
  // AND the importScripts() target inside the renderer worker.
  if (path === '/assets/renderer.js') {
    try {
      const src = readAsset('ui/renderer.js', true);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(src);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 renderer.js');
    }
    return;
  }

`;
s = s.replace(anchor, nw + anchor, 1);
writeFileSync('mdlight.mjs', s);
console.log('fix-node-renderer-route done');
