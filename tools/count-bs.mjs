import { readFileSync } from 'node:fs';
const lines = readFileSync('core/renderer.mjs', 'utf8').split('\n');
// lines 620-740 (the whole mdToLatex function body)
for (let n = 620; n <= 740; n++) {
  const l = lines[n-1];
  let bs = 0;
  for (let i = 0; i < l.length; i++) if (l.charCodeAt(i) === 92) bs++;
  if (bs > 0 || l.includes('out.push') || l.includes('inlineTex')) {
    console.log(n, 'bs=' + bs, JSON.stringify(l.slice(0, 80)));
  }
}
