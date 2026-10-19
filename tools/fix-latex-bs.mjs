import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');

// Helper: count backslashes in a line
function bsCount(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 92) n++;
  return n;
}

const lines = s.split('\n');
const bs = String.fromCharCode(92);

// We only fix lines INSIDE the mdToLatex function (lines 614-767)
// For each string-literal that should contain \command but has one,
// replace the single backslash with two backslashes in the FILE.
// This means: in the file, the string literal becomes '\\command'
// which JS evaluates to the string '\command'.

// Patterns to fix (only in string literals, not in regex literals):
// We look for specific known strings that need the fix.
// A backslash followed by a lowercase letter in a string literal needs doubling.

let fixed = 0;
for (let i = 613; i < 767; i++) {
  let l = lines[i];
  const bsHere = bsCount(l);

  // Skip lines that are purely regex/test lines (contain '/g' or '.test(')
  // but NOT string literals with \command
  // Actually we need to be careful: regex literals like /\s*/ are fine.
  // Only string literals (between single quotes) need the backslash doubled.

  // Strategy: find each occurrence of a single backslash followed by a
  // lowercase letter that is NOT part of an already-doubled pair.
  // Replace \<letter> with \\<letter> inside single-quoted string contexts.

  // Simple approach: manually fix each known broken string literal.
  // Build a map of broken -> fixed for each specific line.

  const fixes = [];

  // Line 622: '\($1\)' should be '\\($1\\)'
  if (l.includes("'\\($1\\)'") ) {
    l = l.replace("'\\($1\\)'", "'" + bs + bs + "($1" + bs + bs + ")");
    fixed++;
  }
  // Line 623: '\texttt{$1}' → '\\texttt{$1}'
  if (l.includes("'\\texttt{$1}'")) {
    l = l.replace("'\\texttt{$1}'", "'" + bs + bs + "texttt{$1}'");
    fixed++;
  }
  // Line 624: '\textbf{$1}' → '\\textbf{$1}'
  if (l.includes("'\\textbf{$1}'")) {
    l = l.replace("'\\textbf{$1}'", "'" + bs + bs + "textbf{$1}'");
    fixed++;
  }
  // Line 625: '\textit{$1}' → '\\textit{$1}'
  if (l.includes("'\\textit{$1}'")) {
    l = l.replace("'\\textit{$1}'", "'" + bs + bs + "textit{$1}'");
    fixed++;
  }
  // Line 627: '\href{$2}{$1}' → '\\href{$2}{$1}'
  if (l.includes("'\\href{$2}{$1}'")) {
    l = l.replace("'\\href{$2}{$1}'", "'" + bs + bs + "href{$2}{$1}'");
    fixed++;
  }
  // Line 635: '\begin{table}[ht]' → '\\begin{table}[ht]'
  if (l.includes("'\\begin{table}[ht]'")) {
    l = l.replace("'\\begin{table}[ht]'", "'" + bs + bs + "begin{table}[ht]'");
    fixed++;
  }
  // Line 636: '  \centering' → '  \\centering'
  if (l.includes("'  \\centering'")) {
    l = l.replace("'  \\centering'", "'  " + bs + bs + "centering'");
    fixed++;
  }
  // Line 637: '  \begin{tabular}{...}'
  if (l.includes("'  \\begin{tabular}{'")) {
    l = l.replace("'  \\begin{tabular}{'", "'  " + bs + bs + "begin{tabular}{");
    fixed++;
  }
  // Line 638/640/644: '    \hline' → '    \\hline'
  if (l.includes("'    \\hline'")) {
    l = l.replace("'    \\hline'", "'    " + bs + bs + "hline'");
    fixed++;
  }
  // Line 645: '  \end{tabular}' → '  \\end{tabular}'
  if (l.includes("'  \\end{tabular}'")) {
    l = l.replace("'  \\end{tabular}'", "'  " + bs + bs + "end{tabular}'");
    fixed++;
  }
  // Line 646: '\end{table}' → '\\end{table}'
  if (l.includes("'\\end{table}'")) {
    l = l.replace("'\\end{table}'", "'" + bs + bs + "end{table}'");
    fixed++;
  }
  // Line 666: '\begin{verbatim}' → '\\begin{verbatim}'
  if (l.includes("'\\begin{verbatim}'")) {
    l = l.replace("'\\begin{verbatim}'", "'" + bs + bs + "begin{verbatim}'");
    fixed++;
  }
  // Line 668: '\end{verbatim}' → '\\end{verbatim}'
  if (l.includes("'\\end{verbatim}'")) {
    l = l.replace("'\\end{verbatim}'", "'" + bs + bs + "end{verbatim}'");
    fixed++;
  }
  // Line 696: '\bigskip\noindent\hrulefill\bigskip'
  if (l.includes("'\\bigskip\\noindent\\hrulefill\\bigskip'")) {
    l = l.replace(
      "'\\bigskip\\noindent\\hrulefill\\bigskip'",
      "'" + bs + bs + "bigskip" + bs + bs + "noindent" + bs + bs + "hrulefill" + bs + bs + "bigskip'"
    );
    fixed++;
  }
  // Line 711: '\begin{enumerate}' / '\begin{itemize}'
  if (l.includes("'\\begin{enumerate}'")) {
    l = l.replace("'\\begin{enumerate}'", "'" + bs + bs + "begin{enumerate}'");
    fixed++;
  }
  if (l.includes("'\\begin{itemize}'")) {
    l = l.replace("'\\begin{itemize}'", "'" + bs + bs + "begin{itemize}'");
    fixed++;
  }
  // Line 712: '  \item '
  if (l.includes("'  \\item '")) {
    l = l.replace("'  \\item '", "'  " + bs + bs + "item '");
    fixed++;
  }
  // Line 713: '\end{enumerate}' / '\end{itemize}'
  if (l.includes("'\\end{enumerate}'")) {
    l = l.replace("'\\end{enumerate}'", "'" + bs + bs + "end{enumerate}'");
    fixed++;
  }
  if (l.includes("'\\end{itemize}'")) {
    l = l.replace("'\\end{itemize}'", "'" + bs + bs + "end{itemize}'");
    fixed++;
  }
  // Line 725: '\begin{quote}'
  if (l.includes("'\\begin{quote}'")) {
    l = l.replace("'\\begin{quote}'", "'" + bs + bs + "begin{quote}'");
    fixed++;
  }
  // Line 727: '\end{quote}'
  if (l.includes("'\\end{quote}'")) {
    l = l.replace("'\\end{quote}'", "'" + bs + bs + "end{quote}'");
    fixed++;
  }
  // Line 737: '\begin{center}'
  if (l.includes("'\\begin{center}'")) {
    l = l.replace("'\\begin{center}'", "'" + bs + bs + "begin{center}'");
    fixed++;
  }
  // Line 738: '\includegraphics[width=\linewidth]{'
  if (l.includes("'\\includegraphics[width=" + bs + "linewidth]{'")) {
    l = l.replace(
      "'" + bs + "includegraphics[width=" + bs + "linewidth]{",
      "'" + bs + bs + "includegraphics[width=" + bs + bs + "linewidth]{"
    );
    fixed++;
  }
  // Line 739: '\caption{'
  if (l.includes("'\\caption{'")) {
    l = l.replace("'\\caption{'", "'" + bs + bs + "caption{");
    fixed++;
  }
  // Line 740: '\end{center}'
  if (l.includes("'\\end{center}'")) {
    l = l.replace("'\\end{center}'", "'" + bs + bs + "end{center}'");
    fixed++;
  }

  lines[i] = l;
}

writeFileSync('core/renderer.mjs', lines.join('\n'));
console.log('fixed', fixed, 'lines');
SCRIPT
node tools/fix-latex-bs.mjs 2>&1 | grep -v "^Warning"
