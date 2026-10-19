// feat9: custom layout templates (streaming / A4 / slide) — switch between
// three body classes that re-style the content column. The template is chosen
// in the settings panel and persisted in config.json (layout: 'stream'|'a4'|'slide').
// CSS lives in app.css; app.js just toggles the body class on config apply.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

// --- app.js: extend applyConfig to set the layout body class ---
let s = readFileSync('ui/app.js', 'utf8');

// Find the applyConfig function and add the layout toggle at the end of it.
// The safest anchor is the line that sets the font-size CSS variable, which is
// the last line before the closing brace of the theme / font section.
const anchor = "    if (cfg.codeLineno) { document.body.classList.add('mdl-code-lineno'); if (typeof wireCodeLineno === 'function') wireCodeLineno(); }";
if (s.indexOf(anchor) < 0) { console.log('applyConfig anchor not found'); process.exit(1); }

const layoutBlock = `
    // ---- layout template switch (stream / a4 / slide) ----
    var lay = cfg.layout || 'stream';
    document.body.classList.remove('mdl-layout-a4', 'mdl-layout-slide');
    if (lay === 'a4') document.body.classList.add('mdl-layout-a4');
    else if (lay === 'slide') document.body.classList.add('mdl-layout-slide');`;

s = s.replace(anchor, anchor + '\n' + layoutBlock, 1);
writeFileSync('ui/app.js', s);

// --- app.css: add the three layout templates ---
let css = readFileSync('ui/app.css', 'utf8');
const layoutCss = `
/* ---- custom layout templates (stream / a4 / slide) ---- */
/* A4: centred fixed-width column mimicking a printed page */
body.mdl-layout-a4 .mdl-content {
  max-width: 794px;  /* 210 mm @ 96 dpi */
  margin: 0 auto;
  background: #fff;
  padding: 60px 72px;
  box-shadow: 0 0 12px rgba(0,0,0,.1);
}
body.mdl-layout-a4 .mdl-content p,
body.mdl-layout-a4 .mdl-content li {
  orphans: 3; widows: 3;
}
/* Slide: full-viewport pages, each section fills the viewport height */
body.mdl-layout-slide .mdl-content {
  max-width: none;
  padding: 0;
}
body.mdl-layout-slide section,
body.mdl-layout-slide article {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px 64px;
  page-break-after: always;
}
body.mdl-layout-slide h1 {
  font-size: 2.4em;
  margin-bottom: .4em;
}
/* Default streaming layout: no extra rules (existing styles apply) */
`;
if (css.indexOf('mdl-layout-a4') < 0)
  appendFileSync('ui/app.css', layoutCss);

console.log('feat9 done');
