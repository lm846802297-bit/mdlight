import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
const bs = String.fromCharCode(92);

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();

  // Line 688: heading out.push — need file to contain exactly:
  //   out.push('\\' + cmd + '{' + inlineTex(h[2]) + '}');
  // i.e. two backslash chars between the single quotes.
  if (t.startsWith('out.push(') && t.includes('cmd')) {
    const two = bs + bs;
    lines[i] = '      out.push(\'' + two + '\' + cmd + \'{\'' + ' + inlineTex(h[2]) + \'}\');';
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  // Lines 695-699: horizontal rule — \bigskip\noindent\hrulefill\bigskip
  // Each LaTeX command needs the backslash preserved: \bigskip \noindent \hrulefill \bigskip
  if (t.includes('bigskip') && t.includes('noindent')) {
    lines[i] = "      out.push('" + bs + "bigskip" + bs + "noindent" + bs + "hrulefill" + bs + "bigskip');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  // Line 711: list commands \begin{enumerate} etc.
  if (t.includes('begin{enumerate}')) {
    lines[i] = "      out.push(isOl ? '" + bs + "begin{enumerate}' : '" + bs + "begin{itemize}');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
  if (t.includes('end{enumerate}') && t.includes('end{itemize}')) {
    lines[i] = "      out.push(isOl ? '" + bs + "end{enumerate}' : '" + bs + "end{itemize}');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
  // Line 712: \item
  if (t.includes('items.forEach') && t.includes('item')) {
    lines[i] = "      items.forEach(function (it) { out.push('  " + bs + "item ' + it); });";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  // Line 725/727: quote env
  if (t.includes("out.push('" + bs + "begin{quote}')")) {
    // already fine — skip
  } else if (t.trim() === "out.push('\\begin{quote}');") {
    lines[i] = "      out.push('" + bs + "begin{quote}');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
  if (t.trim() === "out.push('\\end{quote}');") {
    lines[i] = "      out.push('" + bs + "end{quote}');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  // Line 736: image path sanitisation
  if (t.includes("img[2].split('?')")) {
    const two = bs + bs;
    lines[i] = "      var file = img[2].split('?')[0].split('#')[0]"
      + ".replace(new RegExp('" + two + "g"), '/')"
      + ".replace(/[^A-Za-z0-9_.\\" + bs + bs + "-/]/g, '');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  // Line 737/738: includegraphics
  if (t.includes('includegraphics[width=')) {
    lines[i] = "      out.push('" + bs + "includegraphics[width=" + bs + "linewidth]{' + file + '}'
      + "'
      );";
    // Actually simpler: just replace the string
    lines[i] = "      out.push('" + bs + "includegraphics[width=" + bs + "linewidth]{' + file + '}'
      + "'
      );";
    // That has a newline — not what we want. Let me build it properly:
    lines[i] = "      out.push('" + bs + "includegraphics[width=" + bs + "linewidth]{' + file + '}');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
  if (t.includes('caption')) {
    lines[i] = "      if (label) out.push('" + bs + "caption{' + inlineTex(label) + '}');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
console.log('done');
