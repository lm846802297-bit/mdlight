import { readFileSync, writeFileSync } from 'node:fs';
let cs = readFileSync('native/Server.cs', 'utf8');
const lines = cs.split('\n');
const dq = String.fromCharCode(34); // "
const bs = String.fromCharCode(92); // \

// Fix line 1182: if (c == ")  →  if (c == '"')
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === 'if (c == ')') {
    lines[i] = lines[i].replace(t, "if (c == '" + dq + "')");
    console.log('line', i + 1, 'fixed:', lines[i].trim());
  }
  // Fix line 1187: if (json[j] == \\) { j += 2; continue; }
  // The file currently has:  if (json[j] == \\) { ... }  (raw backslash, not in a char literal)
  // It needs to be:          if (json[j] == '\\') { ... }  (\\ inside single quotes = C# escaped backslash)
  if (t.includes('json[j] == ' + bs + bs + ')')) {
    lines[i] = lines[i].replace('json[j] == ' + bs + bs, "json[j] == '" + bs + bs + "'");
    console.log('line', i + 1, 'fixed:', lines[i].trim());
  }
  // Fix line 1188: if (json[j] == ") break;  →  if (json[j] == '"')  break;
  if (t === 'if (json[j] == ') break;'.trim().slice(0, t.length)) {
    // just match by content pattern
  }
  if (t.startsWith('if (json[j] == ') && t.endsWith(') break;')) {
    lines[i] = lines[i].replace(t, "if (json[j] == '" + dq + "') break;");
    console.log('line', i + 1, 'fixed:', lines[i].trim());
  }
}
writeFileSync('native/Server.cs', lines.join('\n'));
console.log('done');
