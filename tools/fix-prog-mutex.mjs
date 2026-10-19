import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('native/Program.cs', 'utf8');
const old = '        private const string MutexName = "Global\mdlight-single-" +\n            Environment.GetEnvironmentVariable("USERNAME") ?? "default";';
const nw = '        private static readonly string MutexName = "Global\mdlight-single-" +\n            (Environment.GetEnvironmentVariable("USERNAME") ?? "default");';
if (s.indexOf(old) < 0) { console.log('anchor still not found'); process.exit(1); }
s = s.replace(old, nw, 1);
writeFileSync('native/Program.cs', s);
console.log('fix-prog-mutex done');
