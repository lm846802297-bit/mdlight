// The mdToLatex source body for core/renderer.mjs — one backslash = one literal.
// feat14b-latex-core.mjs reads this file and appends it (after fixing the export list).

// ---------------------------------------------------------------------------
// Markdown → LaTeX converter (feat14)
// ---------------------------------------------------------------------------
// Best-effort structural conversion: headings → \section, tables → tabular,
// fenced code → verbatim, lists → itemize/enumerate, quotes → quote,
// images → includegraphics, links → href, math passes through as-is,
// mermaid → commented-out source block. Not a full compiler: edge cases
// (nested emphasis, raw HTML) degrade gracefully.
export function mdToLatex(src) {
  var lines = String(src).replace(/\r\n/g, '\n').split('\n');
  var out = [];
  var tableRows = [];
  var i = 0;

  function inlineTex(s) {
    return String(s)
      .replace(/\$([^$\n]+)\$/g, '\($1\)')            // $...$ inline math
      .replace(/`([^`]+)`/g, '\texttt{$1}')            // `code`
      .replace(/\*\*([^*]+)\*\*/g, '\textbf{$1}')      // **bold**
      .replace(/\*([^*]+)\*/g, '\textit{$1}')          // *italic*
      .replace(/~~([^~]+)~~/g, '$1')                    // ~~strike~~ → plain
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\href{$2}{$1}'); // [text](url)
  }

  function flushTable() {
    if (tableRows.length < 2) { tableRows = []; return; }
    var ncol = tableRows[0].length;
    var spec = '';
    for (var c = 0; c < ncol; c++) spec += 'l';
    out.push('\begin{table}[ht]');
    out.push('  \centering');
    out.push('  \begin{tabular}{' + spec + '}');
    out.push('    \hline');
    out.push('    ' + inlineTex(tableRows[0].join(' & ')) + ' \\');
    out.push('    \hline');
    for (var r = 1; r < tableRows.length; r++) {
      out.push('    ' + inlineTex(tableRows[r].join(' & ')) + ' \\');
    }
    out.push('    \hline');
    out.push('  \end{tabular}');
    out.push('\end{table}');
    out.push('');
    tableRows = [];
  }

  while (i < lines.length) {
    var line = lines[i];

    // fenced code block (``` ... ```)
    if (/^```/.test(line)) {
      var lang = line.slice(3).trim();
      i++;
      var block = [];
      while (i < lines.length && !/^```/.test(lines[i])) { block.push(lines[i]); i++; }
      i++; // consume closing fence
      if (lang === 'mermaid') {
        out.push('% [mermaid diagram]');
        block.forEach(function (bl) { out.push('%   ' + bl); });
        out.push('');
      } else {
        out.push('\begin{verbatim}');
        out = out.concat(block);
        out.push('\end{verbatim}');
        out.push('');
      }
      continue;
    }

    // table row (| a | b |) — separator rows are skipped
    if (/^\s*\|/.test(line)) {
      if (line.replace(/\|/g, '').trim().match(/^[:\-\s]*$/)) { i++; continue; }
      var cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      tableRows.push(cells);
      i++;
      continue;
    }
    if (tableRows.length) flushTable();

    // headings
    var h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      var cmd = h[1].length === 1 ? 'section' : h[1].length === 2 ? 'subsection' : 'subsubsection';
      out.push('\' + cmd + '{' + inlineTex(h[2]) + '}');
      out.push('');
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('\bigskip\noindent\hrulefill\bigskip');
      i++;
      continue;
    }

    // unordered / ordered lists
    var isUl = /^\s*[-*+]\s+/.test(line);
    var isOl = /^\s*\d+[.)]\s+/.test(line);
    if (isUl || isOl) {
      var items = [];
      var re = isOl ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (i < lines.length) {
        var m2 = lines[i].match(re);
        if (m2) { items.push(inlineTex(m2[1])); i++; } else break;
      }
      out.push(isOl ? '\begin{enumerate}' : '\begin{itemize}');
      items.forEach(function (it) { out.push('  \item ' + it); });
      out.push(isOl ? '\end{enumerate}' : '\end{itemize}');
      out.push('');
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      var quotes = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quotes.push(inlineTex(lines[i].replace(/^\s*>\s?/, '')));
        i++;
      }
      out.push('\begin{quote}');
      out = out.concat(quotes);
      out.push('\end{quote}');
      out.push('');
      continue;
    }

    // image
    var img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      var label = img[1] || '';
      var file = img[2].split('?')[0].split('#')[0].replace(/\/g, '/').replace(/[^A-Za-z0-9_.\-/]/g, '');
      out.push('\begin{center}');
      out.push('\includegraphics[width=\linewidth]{' + file + '}');
      if (label) out.push('\caption{' + inlineTex(label) + '}');
      out.push('\end{center}');
      i++;
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    // plain paragraph: swallow consecutive prose lines
    var para = [inlineTex(line.trim())];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^#{1,6}\s/.test(lines[i]) &&
           !/^\s*\|/.test(lines[i]) &&
           !/^```/.test(lines[i]) &&
           !/^\s*[-*+]\s/.test(lines[i]) &&
           !/^\s*\d+[.)]\s/.test(lines[i]) &&
           !/^\s*>/.test(lines[i]) &&
           !/^!\[/.test(lines[i])) {
      para.push(inlineTex(lines[i].trim()));
      i++;
    }
    out.push(para.join(' '));
    out.push('');
  }

  if (tableRows.length) flushTable();
  return out.join('\n');
}
