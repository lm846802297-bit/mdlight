import { readFileSync, writeFileSync } from 'node:fs';

// 1) core/renderer.mjs — add a mdToLatex(src) export that converts markdown to LaTeX
let core = readFileSync('core/renderer.mjs', 'utf8');
const exportAnchor = "export { makeRenderer, render }";
if (core.indexOf(exportAnchor) < 0) {
  // find the actual export line
  const expLine = core.match(/^export \{[^}]+\}$/m);
  if (!expLine) { console.log('export line not found'); process.exit(1); }
  console.log('using export line:', expLine[0]);
}

// Append the mdToLatex function before the export line
const mdToLatex = String.raw`

// ---------------------------------------------------------------------------
// Markdown → LaTeX converter
// ---------------------------------------------------------------------------
// Converts a markdown source string to LaTeX text suitable for a
// \documentclass{article} input. Headings → \section, tables → tabular,
// code blocks → verbatim, inline code → \texttt, math fences pass through,
// images → \includegraphics, links → \href. Mermaid blocks are converted to
// a text description placeholder.
export function mdToLatex(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inFence = false, fenceLang = '', inTable = false, tableSep = false;
  let i = 0;

  function flushTable() {
    // table rows are collected in `tableRows`; emit tabular
    if (tableRows.length > 1) {
      const ncol = tableRows[0].length;
      const spec = 'l'.repeat(ncol);
      out.push('\begin{table}[ht]');
      out.push('  \centering');
      out.push('  \begin{tabular}{' + spec + '}');
      out.push('    \hline');
      out.push('    ' + tableRows[0].join(' & ') + ' \\');
      out.push('    \hline');
      for (let r = 1; r < tableRows.length; r++)
        out.push('    ' + tableRows[r].join(' & ') + (r < tableRows.length - 1 ? ' \\ ' : ' \\'));
      out.push('    \hline');
      out.push('  \end{tabular}');
      out.push('\end{table}');
      out.push('');
    }
    tableRows = [];
    inTable = false;
  }

  let tableRows = [];
  function cellTex(c) {
    return String(c)
      .replace(/\$|\%/g, function (m) { return '\' + m; })
      .replace(/\*/g, '')
      .replace(/`/g, '\texttt{');
    // note: backticks are handled by the inline pass below; keep simple
  }
  function inlineTex(s) {
    return String(s)
      .replace(/\\(/g, '$')
      .replace(/\\)/g, '$')
      .replace(/\$([^\n$]+)\$/g, '\($1\)')
      .replace(/`([^`]+)`/g, '\texttt{$1}')
      .replace(/\*\*([^*]+)\*\*/g, '\textbf{$1}')
      .replace(/\*([^*]+)\*/g, '\textit{$1}')
      .replace(/~~([^~]+)~~/g, '\texttt{$1}')
      .replace(/~~/g, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\href{$2}{$1}')
      .replace(/\!/g, '');
  }

  while (i < lines.length) {
    const line = lines[i];

    // fence
    if (/^```/.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceLang = line.slice(3).trim();
        if (fenceLang === 'mermaid') {
          // collect whole mermaid block and emit as a comment
          let block = '';
          i++;
          while (i < lines.length && !/^```/.test(lines[i])) { block += lines[i] + '\n'; i++; }
          out.push('% [mermaid diagram]');
          block.trim().split('\n').forEach(function (bl) { out.push('%   ' + bl); });
          out.push('');
          continue;
        } else {
          // start verbatim
          out.push('');
          out.push('\begin{verbatim}');
          i++;
          while (i < lines.length && !/^```/.test(lines[i])) {
            out.push(lines[i]);
            i++;
          }
          out.push('\end{verbatim}');
          out.push('');
          inFence = false;
          continue;
        }
      } else {
        inFence = false;
      }
    }

    if (inFence) { out.push(line); i++; continue; }

    // table
    if (/^\s*\|/.test(line)) {
      if (line.replace(/\|/g, '').trim().match(/^[:\-\s]+$/)) {
        i++; // skip separator
        continue;
      }
      if (!inTable) { inTable = true; tableRows = []; }
      const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      tableRows.push(cells);
      i++;
      continue;
    } else if (inTable) {
      flushTable();
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const lvl = h[1].length;
      const texLvl = Math.min(lvl, 3);
      const cmd = lvl === 1 ? 'section' : lvl === 2 ? 'subsection' : 'subsubsection';
      out.push('\' + cmd + '{' + inlineTex(h[2]) + '}');
      out.push('');
      i++;
      continue;
    }

    // hr
    if (/^(\s*)(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('\bigskip\noindent\hrulefill\bigskip');
      i++;
      continue;
    }

    // list
    const li = line.match(/^(\s*)[-*+]\s+(.+)$/);
    const oi = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (li || oi) {
      const isOl = !!oi;
      const items = [];
      while (i < lines.length) {
        const m2 = isOl ? lines[i].match(/^(\s*)\d+[.)]\s+(.+)$/) : lines[i].match(/^(\s*)[-*+]\s+(.+)$/);
        if (m2) { items.push(inlineTex(m2[2])); i++; } else break;
      }
      out.push(isOl ? '\begin{enumerate}' : '\begin{itemize}');
      items.forEach(function (it) { out.push('  \item ' + it); });
      out.push(isOl ? '\end{enumerate}' : '\end{itemize}');
      out.push('');
      continue;
    }

    // blockquote
    const bq = line.match(/^\s*>\s+(.*)$/);
    if (bq) {
      out.push('\begin{quote}');
      out.push(inlineTex(bq[1]));
      i++;
      while (i < lines.length) {
        const bq2 = lines[i].match(/^\s*>\s+(.*)$/);
        if (bq2) { out.push(inlineTex(bq2[1])); i++; }
        else break;
      }
      out.push('\end{quote}');
      out.push('');
      continue;
    }

    // image
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      const label = img[1] || '';
      const file = img[2].split('?')[0].replace(/\/g, '/');
      out.push('\begin{center}');
      out.push('\includegraphics[width=\linewidth]{' + file.replace(/[^a-zA-Z0-9_./-]/g, '') + '}');
      if (label) out.push('\caption{' + inlineTex(label) + '}');
      out.push('\end{center}');
      i++;
      continue;
    }

    // blank
    if (line.trim() === '') { i++; continue; }

    // paragraph: collect consecutive non-special lines
    const para = [inlineTex(line.trim())];
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

  if (inTable) flushTable();

  return out.join('\n');
}
`;

// insert before the export line
const expIdx = core.lastIndexOf('\nexport ');
if (expIdx < 0) { console.log('export insert point not found'); process.exit(1); }
core = core.slice(0, expIdx) + mdToLatex + '\n' + core.slice(expIdx + 1);

// also update the export line to include mdToLatex
core = core.replace(/export \{ makeRenderer, render \}/, 'export { makeRenderer, render, mdToLatex }');
// or if the export line is different
const expLineMatch = core.match(/export \{([^}]+)\}/m);
if (expLineMatch && expLineMatch[1].indexOf('mdToLatex') < 0) {
  core = core.replace(expLineMatch[0], 'export { ' + expLineMatch[1] + ', mdToLatex }');
}
writeFileSync('core/renderer.mjs', core);
console.log('core/renderer.mjs: mdToLatex added');

// 2) mdlight.mjs — add POST /api/export-latex route
let mj = readFileSync('mdlight.mjs', 'utf8');
const latexRoute = String.raw`
  // POST /api/export-latex — write <docname>.tex beside the .md
  if (path === '/api/export-latex' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { mdToLatex } = await import('./core/render
