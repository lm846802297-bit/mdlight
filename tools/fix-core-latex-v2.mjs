import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
const bs = String.fromCharCode(92);

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();

  // Line 688: heading out.push — bs=2 is correct, skip
  if (t.startsWith('out.push(') && t.includes('cmd')) continue;

  // Line 696: horizontal rule — bs=4 correct
  if (t.includes('bigskip') && t.includes('noindent')) continue;

  // Line 711: enumerate/itemize begin — bs=2 correct
  if (t.includes('begin{enumerate}') && t.includes('begin{itemize}')) continue;
  // Line 713: enumerate/itemize end — bs=2 correct
  if (t.includes('end{enumerate}') && t.includes('end{itemize}')) continue;

  // Line 712: \item — bs=1, correct
  if (t.includes('items.forEach')) continue;

  // Line 725: \begin{quote} — bs=1, correct
  // Line 727: \end{quote} — bs=1, correct
  if (t.includes('out.push(') && (t.includes('begin{quote}') || t.includes('end{quote}'))) continue;

  // Line 736: image path — bs=2, the broken line
  if (t.includes("img[2].split('?')")) {
    // Current broken content: .replace(/\/g, '/')
    // We need: .replace(new RegExp('\\g'), '/')
    // But that's also wrong — \g isn't a valid regex.
    // Actually the INTENT was: replace backslash-slash sequences with forward slash
    // i.e. replace(/\\/g, '/')  where in the file that's 2 backslash chars
    const two = bs + bs;
    lines[i] = "      var file = img[2].split('?')[0].split('#')[0]"
      + ".replace(new RegExp('" + two + "g"), '/')"
      + ".replace(/[^A-Za-z0-9_.\\" + bs + bs + "-/]/g, '');";
    console.log('fixed line 736, new bs count:',
      lines[i].split(bs).length - 1,
      JSON.stringify(lines[i].slice(0, 80)));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
console.log('done');
