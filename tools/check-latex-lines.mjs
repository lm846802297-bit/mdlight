import { readFileSync } from 'node:fs';
const lines = readFileSync('core/renderer.mjs', 'utf8').split('\n');
const target = [688, 696, 711, 712, 713, 725, 727, 736, 737, 738, 739, 740];
for (const n of target) {
  const l = lines[n - 1];
  let bs = 0;
  for (let i = 0; i < l.length; i++) if (l.charCodeAt(i) === 92) bs++;
  console.log(n, 'bs=' + bs, JSON.stringify(l.slice(0, 70)));
}
