import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('core/renderer.mjs', 'utf8').split('\n');
const idx = 735;
const bs = String.fromCharCode(92);
const two = bs + bs;
// Build the target line piece by piece, each piece a simple string with no escapes:
// Target:
//   var file = img[2].split('?')[0].split('#')[0]
//     .replace(new RegExp('\\g'), '/')
//     .replace(/[^A-Za-z0-9_.\-\/]/g, '');
// Note: in the FILE, '\\g' means two backslash chars followed by g.
// And /[^A-Za-z0-9_.\-\/]/g is a regex literal where \- and \/ are escaped.
//
// Build it as an array of plain pieces:
const p1 = "      var file = img[2].split('" + "?" + "')[0].split('" + "#" + "')[0]";
const p2 = ".replace(new RegExp('" + two + "g'), '" + "/" + "')";
const p3 = ".replace(/[^A-Za-z0-9_.\\" + bs + "-" + bs + "/]/g, '" + "'' + "');";
lines[idx] = p1 + p2 + p3;
console.log('line 736 now:', JSON.stringify(lines[idx]));
writeFileSync('core/renderer.mjs', lines.join('\n'));
