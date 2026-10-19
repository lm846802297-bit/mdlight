import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('native/Program.cs', 'utf8');
const old = 'using System.Threading;\nusing System.IO.Pipes;\n';
if (s.indexOf(old) < 0) { console.log('anchor not found'); process.exit(1); }
s = s.replace(old, 'using System.Threading;\nusing System.IO.Pipes;\nusing System.Text;\nusing System.Runtime;\n', 1);
writeFileSync('native/Program.cs', s);
console.log('fix-prog-usings done');
