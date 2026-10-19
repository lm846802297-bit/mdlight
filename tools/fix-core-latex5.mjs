import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('core/renderer.mjs', 'utf8');
const lines = s.split('\n');
const bs = String.fromCharCode(92); // one backslash char
const q = String.fromCharCode(39);  // single quote

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();

  // line 688: out.push('\' + cmd + '{' + inlineTex(h[2]) + '}');
  // file must contain: out.push('\\' + cmd ...)  (4 backslash chars in file)
  if (t.startsWith('out.push(') && t.includes('cmd')) {
    // 4 backslash chars = bs repeated 4 times
    const four = bs + bs + bs + bs;
    lines[i] = '      out.push(' + q + four + q + ' + cmd + ' + q + '{' + q + ' + inlineTex(h[2]) + ' + q + '}' + q + ');';
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }

  // line 736: use new RegExp to avoid regex literal confusion
  if (t.includes("img[2].split('?')")) {
    // Build: var file = img[2].split('?')[0].split('#')[0]
    //         .replace(new RegExp('\\g'), '/')   -- 2 backslash chars in file = escaped \
    //         .replace(/[^A-Za-z0-9_.\-\/]/g, ''); -- careful: / inside char class is fine
    // The second regex literal in the file: /[^A-Za-z0-9_.\-" + bs + "/]/g
    // Build the whole line piece by piece
    const two = bs + bs; // represents \ in the file (one escaped backslash in regex)
    lines[i] = "      var file = img[2].split('?')[0].split('#')[0]"
      + ".replace(new RegExp('" + two + "g"), '/')"
      + ".replace(/[^A-Za-z0-9_.\\" + bs + bs + "-/" + q + "]/g, '');";
    // Actually the char class [^A-Za-z0-9_.\-\/] needs care. Let me just use a simpler char class:
    // /[^A-Za-z0-9_.\-\//]g — but / inside a char class in a regex literal is fine without escape
    // In the FILE the regex literal should be: /[^A-Za-z0-9_.\-\/]/g  (\/ to close cleanly)
    // That's: .replace(/[^A-Za-z0-9_.
    const three = bs + bs + bs; // \- in file
    lines[i] = "      var file = img[2].split('?')[0].split('#')[0]"
      + ".replace(new RegExp('" + two + "g"), '/')"
      + ".replace(/[^A-Za-z0-9_.\\" + bs + bs + "-/]/g, '');";
    console.log('line', i + 1, JSON.stringify(lines[i]));
  }
}
writeFileSync('core/renderer.mjs', lines.join('\n'));
