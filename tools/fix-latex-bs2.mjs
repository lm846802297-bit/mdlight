import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
const BS = String.fromCharCode(92);

// For lines 614–767 (mdToLatex body), scan each line character by character.
// When we find a single backslash followed by a lowercase letter that is INSIDE
// a single-quoted string literal (not in a regex literal), double it.
//
// Simpler: just look for the pattern of a single backslash + letter that is
// preceded by a single-quote context. We'll do a targeted replacement:
// for each line, find all occurrences of BS+letter that are NOT already
// part of BS+BS+letter, and double them.

let totalFixed = 0;
for (let i = 613; i < 767; i++) {
  let l = lines[i];
  // Skip lines that have no backslash at all
  if (l.indexOf(BS) < 0) continue;

  // Build result: walk through, when we see BS+letter (where letter is a-z)
  // and the preceding char is NOT another BS, insert an extra BS before it.
  let out = '';
  let j = 0;
  while (j < l.length) {
    const c = l.charCodeAt(j);
    if (c === 92) {
      const next = l.charCodeAt(j + 1);
      const prev = j > 0 ? l.charCodeAt(j - 1) : 0;
      // Is this BS part of an already-doubled pair (prev is also BS)?
      if (prev === 92) {
        // already doubled — copy both
        out += BS + BS;
        j += 2;
        continue;
      }
      // Is the next char a lowercase letter or $ or digit (regex escape)?
      // In regex literals, \s \d \w \. etc are valid.
      // In string literals, \t \n \r are valid JS escapes (single char).
      // We only want to double backslashes that are MEANT to be literal \
      // in the output string, i.e. \command for LaTeX.
      // Heuristic: if next is a-z (not a valid JS escape like t,n,r,f,v,b),
      // double it.
      if (next >= 97 && next <= 122) {
        const ch = String.fromCharCode(next);
        // valid JS single-char escapes: \b \f \n \r \t \v — don't double these
        if (!'bnrtvf'.includes(ch)) {
          out += BS + BS + ch;
          totalFixed++;
        } else {
          out += BS + ch;
        }
        j += 2;
      } else if (next === 36) {
        // $1 $2 — regex backref, don't double
        out += BS + String.fromCharCode(next);
        j += 2;
      } else {
        // other (digits, punctuation, /, etc.) — leave as is
        out += BS + String.fromCharCode(next);
        j += 2;
      }
    } else {
      out += l[j];
      j++;
    }
  }
  lines[i] = out;
}

writeFileSync('core/renderer.mjs', lines.join('\n'));
console.log('total backslash doublings:', totalFixed);
