import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const BS = String.fromCharCode(92);

// We need to double single backslashes that appear inside single-quoted string
// literals on lines 614–767. The specific strings to fix (as they appear in
// the file right now, with ONE backslash):
//
// Each entry: [searchPattern (with one BS), replacementPattern (with two BS)]
// We build both patterns using BS char so no shell escaping issues.

const pairs = [
  // inlineTex replacements
  [BS + '($1' + BS + ')',        BS + BS + '($1' + BS + BS + ')'],
  [BS + 'texttt{$1}',            BS + BS + 'texttt{$1}'],
  [BS + 'textbf{$1}',            BS + BS + 'textbf{$1}'],
  [BS + 'textit{$1}',            BS + BS + 'textit{$1}'],
  [BS + 'href{$2}{$1}',         BS + BS + 'href{$2}{$1}'],
  // table
  [BS + 'begin{table}[ht]',      BS + BS + 'begin{table}[ht]'],
  [BS + 'centering',             BS + BS + 'centering'],
  [BS + 'begin{tabular}{',      BS + BS + 'begin{tabular}{'],
  [BS + 'hline',                 BS + BS + 'hline'],
  [BS + 'end{tabular}',          BS + BS + 'end{tabular}'],
  [BS + 'end{table}',            BS + BS + 'end{table}'],
  // verbatim
  [BS + 'begin{verbatim}',       BS + BS + 'begin{verbatim}'],
  [BS + 'end{verbatim}',         BS + BS + 'end{verbatim}'],
  // horizontal rule
  [BS + 'bigskip' + BS + 'noindent' + BS + 'hrulefill' + BS + 'bigskip',
   BS + BS + 'bigskip' + BS + BS + 'noindent' + BS + BS + 'hrulefill' + BS + BS + 'bigskip'],
  // lists
  [BS + 'begin{enumerate}',      BS + BS + 'begin{enumerate}'],
  [BS + 'begin{itemize}',        BS + BS + 'begin{itemize}'],
  [BS + 'item ',                 BS + BS + 'item '],
  [BS + 'end{enumerate}',        BS + BS + 'end{enumerate}'],
  [BS + 'end{itemize}',          BS + BS + 'end{itemize}'],
  // quote
  [BS + 'begin{quote}',          BS + BS + 'begin{quote}'],
  [BS + 'end{quote}',            BS + BS + 'end{quote}'],
  // image
  [BS + 'begin{center}',         BS + BS + 'begin{center}'],
  [BS + 'includegraphics[width=' + BS + 'linewidth]{',
   BS + BS + 'includegraphics[width=' + BS + BS + 'linewidth]{'],
  [BS + 'caption{',             BS + BS + 'caption{'],
  [BS + 'end{center}',           BS + BS + 'end{center}'],
];

let total = 0;
for (const [from, to] of pairs) {
  // Only replace occurrences on lines 614–767 (the mdToLatex function body).
  const lines = s.split('\n');
  let changed = 0;
  for (let i = 613; i < 767; i++) {
    let l = lines[i];
    while (l.includes(from)) {
      l = l.replace(from, to);
      changed++;
    }
    lines[i] = l;
  }
  s = lines.join('\n');
  total += changed;
  if (changed) console.log('replaced', changed, '×', JSON.stringify(from.slice(0, 20)));
}

writeFileSync('core/renderer.mjs', s);
console.log('total replacements:', total);
