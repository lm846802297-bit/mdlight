import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/json-bug-check.mjs', 'utf8');
const lines = s.split('\n');
// Find the line with "const tricky2 = '# doc" and the following broken lines
const idx = lines.findIndex(l => l.includes("const tricky2 = '# doc"));
if (idx >= 0) {
  // lines idx..idx+3 are the broken literal; replace with one correct line
  lines.splice(idx, 4, "  const tricky2 = '# doc\\nbase: x\\nforce: y\\n';");
  console.log('fixed tricky2 at line', idx + 1);
}
writeFileSync('test/json-bug-check.mjs', lines.join('\n'));
