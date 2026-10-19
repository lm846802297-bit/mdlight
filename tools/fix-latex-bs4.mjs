import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const BS = String.fromCharCode(92);

// Single-pass replacement: for each pattern, replace ALL occurrences at once
// (String.replace with 'g' flag equivalent via split+join, no infinite loop).
const pairs = [
  [BS + '($1' + BS + ')',        BS + BS + '($1' + BS + BS + ')'],
  [BS + 'texttt{$1}',            BS + BS + 'texttt{$1}'],
  [BS + 'textbf{$1}',            BS + BS + 'textbf{$1}'],
  [BS + 'textit{$1}',            BS + BS + 'textit{$1}'],
  [BS + 'href{$2}{$1}',         BS + BS + 'href{$2}{$1}'],
  [BS + 'begin{table}[ht]',      BS + BS + 'begin{table}[ht]'],
  [BS + 'centering',             BS + BS + 'centering'],
  [BS + 'begin{tabular}{',      BS + BS + 'begin{tabular}{'],
  [BS + 'hline',                 BS + BS + 'hline'],
  [BS + 'end{tabular}',          BS + BS + 'end{tabular}'],
  [BS + 'end{table}',            BS + BS + 'end{table}'],
  [BS + 'begin{verbatim}',       BS + BS + 'begin{verbatim}'],
  [BS + 'end{verbatim}',         BS + BS + 'end{verbatim}'],
  [BS + 'bigskip' + BS + 'noindent' + BS + 'hrulefill' + BS + 'bigskip',
   BS + BS + 'bigskip' + BS + BS + 'noindent' + BS + BS + 'hrulefill' + BS + BS + 'bigskip'],
  [BS + 'begin{enumerate}',      BS + BS + 'begin{enumerate}'],
  [BS + 'begin{itemize}',        BS + BS + 'begin{itemize}'],
  [BS + 'item ',                 BS + BS + 'item '],
  [BS + 'end{enumerate}',        BS + BS + 'end{enumerate}'],
  [BS + 'end{itemize}',          BS + BS + 'end{itemize}'],
  [BS + 'begin{quote}',          BS + BS + 'begin{quote}'],
  [BS + 'end{quote}',            BS + BS + 'end{quote}'],
  [BS + 'begin{center}',         BS + BS + 'begin{center}'],
  [BS + 'includegraphics[width=' + BS + 'linewidth]{',
   BS + BS + 'includegraphics[width=' + BS + BS + 'linewidth]{'],
  [BS + 'caption{',             BS + BS + 'caption{'],
  [BS + 'end{center}',           BS + BS + 'end{center}'],
];

// Restrict to lines 614–767 only (the mdToLatex function body)
const allLines = s.split('\n');
const start = 613; // 0-indexed line 614
const end = 767;   // inclusive line 767

let total = 0;
for (const [from, to] of pairs) {
  for (let i = start; i <= end; i++) {
    let l = allLines[i];
    if (l.indexOf(from) < 0) continue;
    // split+join = replace all, single pass, no infinite loop
    const parts = l.split(from);
    const n = parts.length - 1;
    allLines[i] = parts.join(to);
    total += n;
    if (n) console.log('line', i + 1, 'replaced', n, '×', JSON.stringify(from.slice(0, 25)));
  }
}

writeFileSync('core/renderer.mjs', allLines.join('\n'));
console.log('total replacements:', total);
