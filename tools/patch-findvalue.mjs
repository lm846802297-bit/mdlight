import { readFileSync, writeFileSync } from 'node:fs';

let cs = readFileSync('native/Server.cs', 'utf8');

const sig = 'private static int FindValue(string json, string key)';
const sigIdx = cs.indexOf(sig);
if (sigIdx < 0) { console.log('signature not found'); process.exit(1); }

let docStart = sigIdx;
while (docStart > 0) {
  const lineStart = cs.lastIndexOf('\n', docStart - 1) + 1;
  const line = cs.slice(lineStart, docStart);
  if (line.startsWith('        ///')) docStart = lineStart;
  else break;
}

let brace = 0, endIdx = -1, started = false;
for (let i = sigIdx; i < cs.length; i++) {
  const ch = cs[i];
  if (ch === '{') { brace++; started = true; }
  if (ch === '}') { brace--; if (started && brace === 0) { endIdx = i + 1; break; } }
}
if (endIdx < 0) { console.log('could not find method end'); process.exit(1); }

const dq = String.fromCharCode(34);  // "
const bs = String.fromCharCode(92); // \

// Build the new method line by line. Each line is the exact C# source text
// that should appear in the file.
const L = [];
L.push('        /// <summary>Finds the value of a top-level key in a flat JSON object.');
L.push('        /// Walks the string once; a quoted string whose previous significant');
L.push('        /// character is { or , and which is followed by : counts as a key.');
L.push('        /// A string value that spells the key is never mistaken for the key.</summary>');
L.push('        private static int FindValue(string json, string key)');
L.push('        {');
// needle: string needle = "\"" + key + "\"";
L.push('            string needle = ' + dq + bs + dq + dq + ' + key + ' + dq + bs + dq + dq + ';');
L.push('            int n = json.Length;');
L.push('            int i = 0;');
L.push('            bool atKeyPos = true;  // true at start and right after { [ ,');
L.push('            while (i < n)');
L.push('            {');
L.push('                char c = json[i];');
L.push('                if (char.IsWhiteSpace(c)) { i++; continue; }');
L.push("                if (c == '{' || c == '[') { i++; atKeyPos = true; continue; }");
L.push("                if (c == '}' || c == ']' || c == ':') { i++; atKeyPos = false; continue; }");
L.push("                if (c == ',') { i++; atKeyPos = true; continue; }");
// if (c == '"')
L.push('                if (c == ' + dq + ')');
L.push('                {');
L.push('                    int j = i + 1;');
L.push('                    while (j < n)');
L.push('                    {');
// if (json[j] == '\\') { j += 2; continue; }
L.push('                        if (json[j] == ' + bs + bs + ') { j += 2; continue; }');
// if (json[j] == '"') break;
L.push('                        if (json[j] == ' + dq + ') break;');
L.push('                        j++;');
L.push('                    }');
L.push('                    if (atKeyPos && json.Substring(i, j - i + 1) == needle)');
L.push('                    {');
L.push('                        int k = j + 1;');
L.push('                        while (k < n && char.IsWhiteSpace(json[k])) k++;');
L.push("                        if (k < n && json[k] == ':') return k + 1;");
L.push('                    }');
L.push('                    i = j + 1;');
L.push('                    atKeyPos = false;');
L.push('                    continue;');
L.push('                }');
// bare token skip: while (i < n && json[i] != ',' && json[i] != '}' &&
//                   json[i] != ']' && json[i] != ':' && !char.IsWhiteSpace(json[i])) i++;
L.push("                while (i < n && json[i] != ',' && json[i] != '}' &&");
L.push("                       json[i] != ']' && json[i] != ':' && !char.IsWhiteSpace(json[i])) i++;");
L.push('                atKeyPos = false;');
L.push('            }');
L.push('            return -1;');
L.push('        }');

const newMethod = L.join('\n');
cs = cs.slice(0, docStart) + newMethod + cs.slice(endIdx);
writeFileSync('native/Server.cs', cs);
console.log('FindValue replaced, new Server.cs length:', cs.length);
