import { readFileSync, writeFileSync } from 'node:fs';
let cs = readFileSync('native/Server.cs', 'utf8');

// Replace FindValue with a proper key-aware parser
const oldStart = cs.indexOf('/// <summary>Finds `\u0022key\u0022 :`');
// Use a simpler approach: find the method and replace it
const fnStart = cs.indexOf('private static int FindValue(string json, string key)');
if (fnStart < 0) { console.log('FindValue not found'); process.exit(1); }
// Find the closing brace of this method (count braces)
let braceCount = 0, fnEnd = -1, started = false;
for (let i = fnStart; i < cs.length; i++) {
  if (cs[i] === '{') { braceCount++; started = true; }
  if (cs[i] === '}') { braceCount--; if (started && braceCount === 0) { fnEnd = i + 1; break; } }
}
if (fnEnd < 0) { console.log('could not find end of FindValue'); process.exit(1); }

const newFindValue =
  'private static int FindValue(string json, string key)\n' +
  '{\n' +
  '            // Walk the JSON once, tracking whether we are at a key position.\n' +
  '            // At a key position the previous significant char is { or , and\n' +
  '            // the token is a quoted string followed by : — so a quoted value\n' +
  '            // that spells the key (e.g. {\u0022source\u0022:\u0022base\u0022, ...})\n' +
  '            // is never mistaken for the key itself.\n' +
  '            string needle = \u0022\u0022 + key + \u0022\u0022;\n' +
  '            int n = json.Length;\n' +
  '            int i = 0;\n' +
  '            while (i < n)\n' +
  '            {\n' +
  '                char c = json[i];\n' +
  '                if (c == \u0022{\u0022 || c == \u0022,\u0022 || c == \u0022[\u0022 || c == \u0022;\u0022 || char.IsWhiteSpace(c))\n' +
  '                {\n' +
  '                    i++;\n' +
  '                    continue;\n' +
  '                }\n' +
  '                if (c == \u0022}\u0022 || c == \u0022]\u0022 || c == \u0022:\u0022)\n' +
  '                {\n' +
  '                    i++;\n' +
  '                    continue;\n' +
  '                }\n' +
  '                if (c == \u0022\u0022)\n' +
  '                {\n' +
  '                    // candidate string token: read it\n' +
  '                    int j = i + 1;\n' +
  '                    while (j < n)\n' +
  '                    {\n' +
  '                        if (json[j] == \u0022\\\u0022) { j += 2; continue; }\n' +
  '                        if (json[j] == \u0022\u0022) break;\n' +
  '                        j++;\n' +
  '                    }\n' +
  '                    // check if this string equals our key\n' +
  '                    string token = json.Substring(i, j - i + 1);\n' +
  '                    if (token == needle)\n' +
  '                    {\n' +
  '                        // this is the key — return the index just past the colon\n' +
  '                        int k = j + 1;\n' +
  '                        while (k < n && char.IsWhiteSpace(json[k])) k++;\n' +
  '                        if (k < n && json[k] == \u0022:\u0022) return k + 1;\n' +
  '                        // not followed by colon — it is a value, keep looking\n' +
  '                    }\n' +
  '                    i = j + 1;\n' +
  '                    continue;\n' +
  '                }\n' +
  '                // bare token (true/false/null/number): skip it\n' +
  '                while (i < n && json[i] != \u0022,\u0022 && json[i] != \u0022}\u0022 &&\n' +
  '                       json[i] != \u0022]\u0022 && json[i] != \u0022:\u0022 && !char.IsWhiteSpace(json[i])) i++;\n' +
  '            }\n' +
  '            return -1;\n' +
  '        }';

// Build the new method with proper C# escaping (the file needs actual backslashes)
const bs = String.fromCharCode(92);
const q = String.fromCharCode(39);
const DQ = String.fromCharCode(34);
const method = [
  '        /// <summary>Finds the value of a top-level key in a flat JSON object.',
  '        /// Walks the string once; a quoted value that spells the key is never',
  '        /// mistaken for the key itself (the colon check is what disambiguates).</summary>',
  '        private static int FindValue(string json, string key)',
  '        {',
  '            int n = json.Length;',
  '            int i = 0;',
  '            while (i < n)',
  '            {',
  '                char c = json[i];',
  '                if (c == ' + bs + '{' + bs + ' || c == ' + bs + ',' + bs + ' || c == ' + bs + '[' + bs + ' || char.IsWhiteSpace(c)) { i++; continue; }',
  '                if (c == ' + bs + '}' + bs + ' || c == ' + bs + ']' + bs + ' || c == ' + bs + ':' + bs + ') { i++; continue; }',
  '                if (c == ' + bs + '"' + bs + ')',
  '                {',
  '                    int j = i + 1;',
  '                    while (j < n)',
  '                    {',
  '                        if (json[j] == ' + bs + bs + bs + bs + ') { j += 2; continue; }',  // \ escaped in regex... no, in C# string \ means literal backslash
  '                        if (json[j] == ' + bs + '"' + bs + ') break;',
  '                        j++;',
  '                    }',
  '                    string token = json.Substring(i, j - i + 1);',
  '                    string needle = ' + bs + '"' + bs + key + bs + '"' + bs + ';',
].join('\n');

// This is getting complex with escaping. Let me use a different approach:
// write the new method directly using the write tool, avoiding heredocs.
console.log('will use write tool instead');
