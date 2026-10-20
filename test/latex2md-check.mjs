// Self-contained tests for core/latex2md.mjs
import { latexToMarkdown } from "../core/latex2md.mjs";

let pass = 0, fail = 0;
const failures = [];

function assertContains(actual, expected, label) {
  if (typeof actual !== "string" || actual.includes(expected)) {
    pass++;
  } else {
    fail++;
    failures.push({ label, expected, actual });
  }
}

function assertNotContains(actual, notExpected, label) {
  if (typeof actual !== "string" || !actual.includes(notExpected)) {
    pass++;
  } else {
    fail++;
    failures.push({ label: `(should NOT contain) ${label}`, notExpected, actual });
  }
}

function assertEq(actual, expected, label) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    failures.push({ label, expected, actual });
  }
}

// 1. Sections
{
  const md = latexToMarkdown(`\\section{Intro}\\subsection{Details}\\subsubsection{Nested}\\paragraph{Note}`);
  assertContains(md, "# Intro", "section -> #");
  assertContains(md, "## Details", "subsection -> ##");
  assertContains(md, "### Nested", "subsubsection -> ###");
  assertContains(md, "#### Note", "paragraph -> ####");
}
// 2. star section
{
  const md = latexToMarkdown(`\\section*{Unnumbered}`);
  assertContains(md, "# Unnumbered", "star section -> #");
}
// 3. itemize
{
  const md = latexToMarkdown(`\\begin{itemize}\\item One\\item Two\\end{itemize}`);
  assertContains(md, "- One", "itemize first");
  assertContains(md, "- Two", "itemize second");
}
// 4. enumeration (item with continuation line)
{
  const md = latexToMarkdown(`\\begin{enumerate}\\item First\\item Second\\end{enumerate}`);
  assertContains(md, "1. First", "enum first");
  assertContains(md, "2. Second", "enum second");
}
// 5. quote
{
  const md = latexToMarkdown(`\\begin{quote}A wise saying. More text.\\end{quote}`);
  assertContains(md, "> A wise saying. More text.", "quote -> blockquote");
}
// 6. verbatim code block
{
  const md = latexToMarkdown("```\nbefore\n```\n\\begin{verbatim}\nconst x = 1;\n\\end{verbatim}");
  assertContains(md, "```", "verbatim fence open");
  assertContains(md, "const x = 1;", "verbatim content preserved");
}
// 7. lstlisting
{
  const md = latexToMarkdown(`\\begin{lstlisting}int main() {}\n\\end{lstlisting}`);
  assertContains(md, "int main() {}", "lstlisting content");
}
// 8. center wrapper removed, content kept
{
  const md = latexToMarkdown(`\\begin{center}Hello centered\\end{center}`);
  assertContains(md, "Hello centered", "center content kept");
  assertNotContains(md, "\\begin{center}", "center begin dropped");
}
// 9. tabular -> markdown table
{
  const md = latexToMarkdown(`\\begin{tabular}{cc}\\hline A & B \\\\ C & D \\\\ \\hline\\end{tabular}`);
  assertContains(md, "| A | B |", "table header");
  assertContains(md, "| C | D |", "table row");
  assertContains(md, "---", "table separator");
  assertNotContains(md, "\\hline", "hline dropped");
}
// 10. inline formatting
{
  const md = latexToMarkdown(`\\textbf{bold} and \\textit{italic} and \\texttt{mono} and \\emph{em}`);
  assertContains(md, "**bold**", "textbf -> bold");
  assertContains(md, "*italic*", "textit -> italic");
  assertContains(md, "`mono`", "texttt -> code");
  assertContains(md, "*em*", "emph -> italic");
}
// 11. footnote stripped
{
  const md = latexToMarkdown(`Text\\footnote{a footnote}.`);
  assertNotContains(md, "a footnote", "footnote stripped");
  assertContains(md, "Text", "text kept");
}
// 12. inline math preserved
{
  const md = latexToMarkdown(`Inline $x^2 = 4$ keeps.`);
  assertContains(md, "$x^2 = 4$", "inline math preserved");
}
// 13. block math -> $$
{
  const md = latexToMarkdown(`Before\n\\[E = mc^2\\]\nAfter`);
  assertContains(md, "$$", "block math fence");
  assertContains(md, "E = mc^2", "block math body");
}
// 14. includegraphics
{
  const md = latexToMarkdown(`\\includegraphics[width=0.5\\textwidth]{img/foo.png}`);
  assertContains(md, "![](img/foo.png)", "includegraphics image");
}
// 15. href
{
  const md = latexToMarkdown(`\\href{https://example.com}{Example Site}`);
  assertContains(md, "[Example Site](https://example.com)", "href link");
}
// 16. url
{
  const md = latexToMarkdown(`See \\url{https://x.com} now.`);
  assertContains(md, "<https://x.com>", "url");
}
// 17. ref preserved / cite degraded
{
  const md = latexToMarkdown(`See \\ref{sec:two} and \\cite{knuth}.`);
  assertContains(md, "\\ref{sec:two}", "ref kept original");
  assertContains(md, "[1]", "cite -> [1]");
}
// 18. preamble cleanup
{
  const md = latexToMarkdown(`\\documentclass{article}\n\\usepackage{amsmath}\n\\title{My \\textbf{Great} Paper}\\author{Jane Doe}\\maketitle\n% a comment\n\\begin{document}\nHello\n\\end{document}`);
  assertContains(md, "# My **Great** Paper", "title -> heading with inline");
  assertContains(md, "> Jane Doe", "author -> quote");
  assertNotContains(md, "\\documentclass", "documentclass removed");
  assertNotContains(md, "\\usepackage", "usepackage removed");
  assertNotContains(md, "a comment", "comment removed");
  assertContains(md, "Hello", "body text kept");
}
// 19. abstract
{
  const md = latexToMarkdown(`\\begin{abstract}We summarize results.\\end{abstract}`);
  assertContains(md, "> **Abstract:** We summarize results.", "abstract -> quote");
}
// 20. unescape specials
{
  const md = latexToMarkdown(`A\\%B\\_C\\&D\\#E`);
  assertContains(md, "A%B_C&D#E", "unescape % _ & #");
}
// 21. tilde -> space (outside math)
{
  const md = latexToMarkdown(`Mr.~Smith`);
  assertContains(md, "Mr. Smith", "tilde to space");
}
// 22. \\ hard break and \par
{
  const md = latexToMarkdown(`Line one\\\\Line two\\par Paragraph three`);
  assertContains(md, "Line one", "break line one");
  assertContains(md, "Line two", "break line two");
  assertContains(md, "Paragraph three", "par paragraph");
}
// 23. robustness: unknown environment preserved not crashed
{
  const md = latexToMarkdown(`\\begin{mystery}Some custom content here\\end{mystery}`);
  assertContains(md, "Some custom content here", "unknown env preserved");
}
// 24. unknown command preserved
{
  const md = latexToMarkdown(`a \\unknowncmd{arg} b`);
  assertContains(md, "\\unknowncmd", "unknown command preserved");
}
// 25. CRLF normalization
{
  const md = latexToMarkdown("\\section{A}\r\nText\r\n");
  assertContains(md, "# A", "CRLF normalized");
}
// 26. escape inside math NOT broken
{
  const md = latexToMarkdown(`math $a\\_b\\%c$ done`);
  assertContains(md, "$a\\_b\\%c$", "math escapes preserved");
}
// 27. full document environment with nested sections/lists
{
  const md = latexToMarkdown(`\\begin{document}\\section{Intro}\\begin{itemize}\\item X \\item Y\\end{itemize}\\end{document}`);
  assertContains(md, "# Intro", "document recursion section");
  assertContains(md, "- X", "document recursion item");
  assertContains(md, "- Y", "document recursion second item");
}

console.log(`\nPassed: ${pass}/${pass + fail}`);
if (fail) {
  console.log("FAILED:");
  for (const f of failures) {
    console.log(" -", f.label);
    if (f.expected !== undefined) console.log("   expected:", JSON.stringify(f.expected));
    if (f.notExpected !== undefined) console.log("   must not contain:", JSON.stringify(f.notExpected));
    console.log("   actual:  ", JSON.stringify(f.actual));
  }
  process.exit(1);
} else {
  console.log("All checks passed.");
}

// Demonstrate a full conversion sample
console.log("\n--- sample conversion ---");
const sample = String.raw`\documentclass{article}
\title{A LaTeX Paper}
\author{Alice}
\begin{abstract}
We propose a method to \textbf{convert} LaTeX to Markdown.
\end{abstract}
\begin{document}
\section{Introduction}
This is \textit{important} math: $a+b=c$. \cite{key}.
\begin{itemize}
\item First point
\item Second point
\end{itemize}
\begin{verbatim}
code block
\end{verbatim}
\end{document}`;
console.log(latexToMarkdown(sample));