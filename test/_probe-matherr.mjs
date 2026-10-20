// probe: render each .md under a directory, report every 公式渲染失败 card.
import { render } from '../core/renderer.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (/\.md$/i.test(n) && st.size < 8 * 1024 * 1024) files.push(p);
  }
})(root);

let total = 0;
for (const f of files) {
  let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
  let r; try { r = render(src, { path: f }); } catch (e) { console.log('RENDER-THROW', f, e.message); continue; }
  const re = /<div class="mdl-math-error">[\s\S]*?mdl-math-error-msg">([\s\S]*?)<\/span><\/div><pre class="mdl-math-error-src">([\s\S]*?)<\/pre>/g;
  let m; const hits = [];
  while ((m = re.exec(r.html))) hits.push({ msg: m[1], src: m[2] });
  if (hits.length) {
    total += hits.length;
    console.log('--- ' + f + '  (' + hits.length + ' errors)');
    const seen = new Set();
    for (const h of hits) {
      const k = h.msg + '|' + h.src;
      if (seen.has(k)) continue; seen.add(k);
      console.log('    MSG: ' + h.msg);
      console.log('    SRC: ' + h.src.slice(0, 200));
    }
  }
}
console.log('scanned ' + files.length + ' files, ' + total + ' error cards');
