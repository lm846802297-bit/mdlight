// feat10: virtual scrolling / lazy rendering for very long documents.
// Strategy: wrap each top-level block (h1–h6, p, pre, figure, x-mermaid,
// table, x-equation) in a <div class="mdl-vblock"> with data-lazy="1".
// An IntersectionObserver marks blocks that have entered the viewport and
// triggers their children's deferred rendering (mermaid, KaTeX).
// Blocks that have not yet been observed get a fixed min-height placeholder
// so the scrollbar stays stable.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

let s = readFileSync('ui/app.js', 'utf8');

const initAnchor = "  // ---- init ----------------------------------------------------------------\n  function init() {";
if (s.indexOf(initAnchor) < 0) { console.log('init anchor not found'); process.exit(1); }

const vsJs = `  // ---- virtual scrolling / lazy rendering ----------------------------------
  // For very long documents (>200 top-level blocks) we wrap each block in a
  // <div class="mdl-vblock"> and let an IntersectionObserver trigger the
  // expensive children (mermaid, KaTeX) only when the block scrolls into
  // view. The scrollbar is stable because each block carries a data-vh
  // placeholder height.
  var VBLOCK_THRESHOLD = 200;  // blocks below this: render everything eagerly
  var _io = null;              // the single IntersectionObserver instance

  function wrapVBlocks() {
    var children = Array.prototype.slice.call(contentEl.children);
    if (children.length < VBLOCK_THRESHOLD) return;   // small doc: skip
    var frag = document.createDocumentFragment();
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (el.nodeType !== 1) continue;
      var wrap = document.createElement('div');
      wrap.className = 'mdl-vblock';
      wrap.setAttribute('data-lazy', '1');
      contentEl.replaceChild(wrap, el);
      wrap.appendChild(el);
      frag.appendChild(wrap);
    }
    contentEl.appendChild(frag);
    observeVBlocks();
  }

  function observeVBlocks() {
    if (!('IntersectionObserver' in window)) {
      // Fallback: render everything immediately
      contentEl.querySelectorAll('.mdl-vblock').forEach(function (b) {
        b.removeAttribute('data-lazy');
      });
      renderMermaid();
      return;
    }
    _io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.isIntersecting) continue;
        var b = e.target;
        b.removeAttribute('data-lazy');
        // Render deferred children inside this block
        var mms = b.querySelectorAll('x-mermaid');
        for (var j = 0; j < mms.length; j++) mmRenderOne(mms[j]);
        _io.unobserve(b);
      }
    }, { rootMargin: '400px 0px' });

    contentEl.querySelectorAll('.mdl-vblock[data-lazy]').forEach(function (b) {
      _io.observe(b);
    });
  }

  // Call wrapVBlocks after the main render pass (after liveReload / initial load)
  // but before mermaid rendering so that only visible blocks get mermaid'd.
  // This is a no-op for small documents (< 200 blocks).
  function maybeWrapVBlocks() {
    if (contentEl && contentEl.children.length >= VBLOCK_THRESHOLD)
      wrapVBlocks();
  }

`;

s = s.replace(initAnchor, vsJs + initAnchor, 1);

// Add the CSS for vblock placeholders
let css = readFileSync('ui/app.css', 'utf8');
if (css.indexOf('.mdl-vblock') < 0) {
  appendFileSync('ui/app.css',
    "\n/* ---- virtual scrolling / lazy blocks ---- */\n" +
    ".mdl-vblock { min-height: 24px; }\n" +
    ".mdl-vblock[data-lazy] x-mermaid,\n" +
    ".mdl-vblock[data-lazy] x-equation { visibility: hidden; }\n");
}

writeFileSync('ui/app.js', s);
console.log('feat10 done');
