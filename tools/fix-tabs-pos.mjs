import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('ui/app.js', 'utf8');
const old = '    if (cur) { cur.pos = savePos(); }';
const nw = '    if (cur) {\n      var _h = document.body.scrollHeight - window.innerHeight;\n      cur.pos = _h > 0 ? window.scrollY / _h : 0;\n    }';
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
s = s.replace(old, nw, 1);
writeFileSync('ui/app.js', s);
console.log('fix-tabs-pos done');
