// Web Worker that runs the markdown renderer off the main thread.
//
// Why: the C# host has no Node runtime, so the page renders with the browser
// build of core/renderer.mjs (window.MDLRenderer). On a large document that
// pipeline — markdown-it + KaTeX (renderToString, thousands of formulas) +
// highlight.js — blocks the main thread for seconds. Everything it touches is
// pure string work (KaTeX renderToString, hljs.highlight, markdown-it token
// rules) with zero DOM dependency, so it can run here and post the HTML back,
// leaving the UI thread free to scroll and respond while the equations render.
//
// renderer.js is built as an IIFE with globalName 'MDLRenderer', so
// importScripts() exposes it as self.MDLRenderer exactly like a classic <script>.
// importScripts is used rather than an ES-module worker because the same bundle
// also serves the exported file:// page, where module imports are CORS-blocked.
importScripts('/assets/renderer.js');

self.onmessage = function (e) {
  var id = e && e.data && e.data.id;
  var source = e && e.data && e.data.source;
  var hardBreaks = !!(e && e.data && e.data.hardBreaks);
  try {
    var mod = self.MDLRenderer;
    if (!mod) throw new Error('renderer 未加载');
    var out = mod.render(String(source || ''), { hardBreaks: hardBreaks });
    self.postMessage({
      id: id,
      ok: true,
      html: out.html,
      headings: out.headings || [],
      mermaidCount: out.mermaidCount || 0,
      marp: out.marp || null,
      slides: out.slides || null,
    });
  } catch (err) {
    // Post the failure back so the main thread can fall back to a synchronous
    // render rather than leaving the placeholder up forever.
    self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};
