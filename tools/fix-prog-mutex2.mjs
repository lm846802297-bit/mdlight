import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('native/Program.cs', 'utf8');
// Replace by locating the unique fragment "private const string MutexName"
const i = s.indexOf('private const string MutexName');
if (i < 0) { console.log('not found'); process.exit(1); }
// find the start of the statement: "        private const string MutexName"
const lineStart = s.lastIndexOf('\n', i) + 1;
// find the end of the statement: the line ends with ?? "default";
const j = s.indexOf('?? "default";', i);
if (j < 0) { console.log('end not found'); process.exit(1); }
const end = j + '?? "default";'.length;
const old = s.slice(lineStart, end);
console.log('OLD:', JSON.stringify(old));
const nw = 'private static readonly string MutexName = "Global\mdlight-single-" +\n            (Environment.GetEnvironmentVariable("USERNAME") ?? "default");';
s = s.slice(0, lineStart) + nw + s.slice(end);
writeFileSync('native/Program.cs', s);
console.log('fix-prog-mutex2 done');
