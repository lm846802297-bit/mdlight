import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('core/renderer.mjs', 'utf8').split('\n');
const bs = String.fromCharCode(92);
const idx = 735;
console.log('before:', JSON.stringify(lines[idx]));
const two = bs + bs;
lines[idx] = '      var file = img[2].split('?')[0].split('#')[0]'
  .replace('??', "'?'")
  .replace('??', "'#'");
SCRIPT
echo "skip heredoc, use write tool"
