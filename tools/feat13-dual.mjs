import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

// 1) ui/index.html — add a split toggle button after the CSV button
let html = readFileSync('ui/index.html', 'utf8');
const anchor = '<button class="mdl-btn" id="mdl-btn-csv"';
if (html.indexOf(anchor) < 0) { console.log('html anchor not found'); process.exit(1); }
const btn = '<button class="mdl-btn" id="mdl-btn-split" title="' + '\u5de6\u53f3\u5206\u5c4f\u5bf9\u7167' + '" aria-label="split">\u2194</button>\n    ' + anchor;
html = html.replace(anchor, btn, 1);
writeFileSync('ui/index.html', html);
console.log('index.html: split button added');

// 2) ui/app.js — split view logic after the CSV export block
let s = readFileSync('ui/app.js', 'utf8');
const csvEnd = s.indexOf("  var csvBtn = document.getElementById('mdl-btn-csv');");
const csvEnd2 = s.indexOf('\n', s.indexOf('addEventListener', csvEnd)) + 1;
if (csvEnd < 0) { console.log('csv anchor not found'); process.exit(1); }
const insertAt = s.indexOf('// ---- \u{1F4C4} export PDF', csvEnd2);
if (insertAt < 0) { console.log('pdf comment anchor not found'); process.exit(1); }

const SPLIT = String.raw`
  // ---- ⇄ side-by-side dual view ------------------------------------------------
  // Split the content area into two panes. The left pane keeps the current doc;
  // the right pane is a second <div id="mdl-content-b"> that renders a chosen
  // second document (or the same doc for comparison). Each pane scrolls
  // independently. The split state is session-scoped (not persisted).
  var splitOn = false;
  var splitPane = null;   // the right-pane element
  function enableSplit() {
    if (splitOn) return;
    splitOn = true;
    document.body.classList.add('mdl-split');
    var main = document.getElementById('mdl-main') || contentEl.parentNode;
    splitPane = document.createElement('div');
    splitPane.id = 'mdl-content-b';
    splitPane.className = 'mdl-content';
    splitPane.innerHTML = '<p class="mdl-loading">\u6b63\u5728\u52a0\u8f7d\u2026</p>';
    main.insertBefore(splitPane, contentEl.nextSibling);
    // render a second doc if there is one open in tabs
    var other = openTabs.length > 1 ? openTabs.find(function (tb) { return !tb.active; }) : null;
    if (other) {
      fetchSecondDoc(other);
    } else {
      splitPane.innerHTML = '<div class="mdl-empty"><p>\u53f3\u4fa7\u7a7a\u5c55\u793a\u533a\uff1a\u70b9\u51fb\u5de6\u4fa7\u6807\u7b7e\u6253\u5f00\u4e00\u4e2a\u6587\u6863\u540e\u6b64\u5904\u4f1a\u81ea\u52a8\u540c\u6b65\u3002</p></div>';
    }
    var btn = document.getElementById('mdl-btn-split');
    if (btn) btn.classList.add('is-on');
  }
  function disableSplit() {
    if (!splitOn) return;
    splitOn = false;
    document.body.classList.remove('mdl-split');
    if (splitPane && splitPane.parentNode) splitPane.parentNode.removeChild(splitPane);
    splitPane = null;
    var btn = document.getElementById('mdl-btn-split');
    if (btn) btn.classList.remove('is-on');
  }
  function fetchSecondDoc(tab) {
    if (!splitPane) return;
    splitPane.innerHTML = '<p class="mdl-loading">\u6b63\u5728\u52a0\u8f7d\u2026</p>';
    fetch('/api/doc?path=' + encodeURIComponent(tab.path || tab.name))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var mod = window.MDLRenderer;
        if (!mod) throw new Error('renderer \u672a\u52a0\u8f7d');
        var out = mod.render((j && j.source) || '', { hardBreaks: !!(S.cfg && S.cfg.hardBreaks) });
        splitPane.innerHTML = out.html;
        splitPane.querySelectorAll('x-mermaid').forEach(function (el, i) {
          // render mermaid into the split pane too
          if (typeof mmRenderOne === 'function') mmRenderOne(window.MDLMermaid, el, i);
        });
      })
      .catch(function (e) {
        splitPane.innerHTML = '<div class="mdl-empty"><p>' + (e.message || '\u52a0\u8f7d\u5931\u8d25') + '</p></div>';
      });
  }
  var splitBtn = document.getElementById('mdl-btn-split');
  if (splitBtn) splitBtn.addEventListener('click', function () { splitOn ? disableSplit() : enableSplit(); });

`;
s = s.slice(0, insertAt) + SPLIT + s.slice(insertAt);
writeFileSync('ui/app.js', s);
console.log('app.js: split view logic added');

// 3) ui/app.css — split layout
appendFileSync('ui/app.css', String.raw`
/* feat13: side-by-side dual view */
body.mdl-split { overflow: hidden; }
body.mdl-split #mdl-main { display: flex; gap: 0; height: 100vh; }
body.mdl-split #mdl-main .mdl-content {
  flex: 1 1 50%;
  overflow-y: auto;
  border-right: 1px solid var(--mdl-border, #e0e0e0);
  min-width: 280px;
}
body.mdl-split #mdl-main #mdl-content-b { border-right: none; }
body.mdl-split #mdl-main .mdl-content:last-child { border-right: none; }
#mdl-btn-split.is-on { background: var(--mdl-accent, #5b8db8); color: #fff; }
`);
console.log('app.css: split styles added');
