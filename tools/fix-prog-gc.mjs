import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('native/Program.cs', 'utf8');
// Gc is in System.Runtime (available on .NET but csc 4.0 may not have it wired);
// simplest fix: drop the KeepAlive call — instanceMutex is a local captured by
// the listener thread closure, which keeps it alive anyway.
const i = s.indexOf('Gc.KeepAlive(instanceMutex);');
if (i < 0) { console.log('anchor not found'); process.exit(1); }
// replace the two lines (comment + call) with a comment
const lineStart = s.lastIndexOf('\n', i - 40) + 1; // start of comment line
// be precise: replace the comment line + the call line
const old = '                    // keep the mutex alive for the process lifetime\n                    Gc.KeepAlive(instanceMutex);\n';
if (s.indexOf(old) < 0) { console.log('exact anchor not found'); process.exit(1); }
const nw = '                    // the listener thread closure keeps instanceMutex alive for the process lifetime\n';
s = s.replace(old, nw, 1);
writeFileSync('native/Program.cs', s);
console.log('fix-prog-gc done');
