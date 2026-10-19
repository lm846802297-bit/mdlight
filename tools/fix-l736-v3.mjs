import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('core/renderer.mjs', 'utf8').split('\n');
const idx = 735;
// All special chars via char codes — no backslash or quote literals in this script:
const BS = String.fromCharCode(92);   // backslash
const SQ = String.fromCharCode(39);   // single quote
const two = BS + BS;
// Build the target line:
//   var file = img[2].split('?')[0].split('#')[0]
//     .replace(new RegExp('\\g'), '/')
//     .replace(/[^A-Za-z0-9_.\-\/]/g, '');
// The regex literal /[^A-Za-z0-9_.\-\/]/g in the file needs \- and \/
// where each is ONE backslash char.
const a = '      var file = img[2].split(' + SQ + '?' + SQ + ')[0].split(' + SQ + '#' + SQ + ')[0]';
const b = '.replace(new RegExp(' + SQ + two + 'g' + SQ + '), ' + SQ + '/' + SQ + ')';
const c = '.replace(/[^A-Za-z0-9_.' + BS + '-' + BS + '/]/g, ' + SQ + SQ + ');';
lines[idx] = a + b + c;
console.log('line 736 now:', JSON.stringify(lines[idx]));
writeFileSync('core/renderer.mjs', lines.join('\n'));
