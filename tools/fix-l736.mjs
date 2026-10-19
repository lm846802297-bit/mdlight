import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('core/renderer.mjs', 'utf8').split('\n');
const bs = String.fromCharCode(92);
const two = bs + bs;
const idx = 735;
lines[idx] = '      var file = img[2].split(' + "'" + '?' + "'" + ')[0].split(' + "'" + '#' + "'" + ')[0]'
  + '.replace(new RegExp(' + "'" + two + 'g' + "'" + '), ' + "'" + '/' + "'" + ')'
  + '.replace(/[^A-Za-z0-9_.\' + bs + '-/' + ']/g, ' + "'" + "'" + ');';
console.log('after:', JSON.stringify(lines[idx]));
writeFileSync('core/renderer.mjs', lines.join('\n'));
