#!/usr/bin/env node
// feat1: mermaid SVG cache in ui/app.js
const { readFileSync, writeFileSync } = await import('node:fs');
let s = readFileSync('ui/app.js', 'utf8');

// ---- 1a: insert cache helpers before mmRenderOne comment block
const anchor1 = "  // Render one <x-mermaid>; on failure show the source with the error, never a\n  // blank box (the original viewer's flaw #2 pattern).";
if (s.indexOf(anchor1) < 0) { console.log('ANCHOR1 not found'); process.exit(1); }

const cacheBlock =
  "  // ---- mermaid SVG cache (content fingerprint -> localStorage) ------------\n" +
  "  // Rendering a mermaid diagram is expensive (parse + layout). When a document\n" +
  "  // is re-opened (SSE reload, file switched back and forth) the same source\n" +
  "  // text re-renders from scratch. Cache the resulting SVG keyed by a FNV-1a\n" +
  "  // hash of (version + theme + source); on a hit the engine call is skipped.\n" +
  "  var mmCacheVersion = 1; // bump to invalidate stale entries after engine changes\n" +
  "  var MM_CACHE_PREFIX = 'mdl-mm-cv1:';\n" +
  "  function mmHash(text, theme) {\n" +
  "    var h = 0x811c9dc5;\n" +
  "    var key = mmCacheVersion + '|' + theme + '|' + text;\n" +
  "    for (var i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = (h * 0x01000193) | 0; }\n" +
  "    return 'fnv' + (h >>> 0).toString(36);\n" +
  "  }\n" +
  "  function mmCacheGet(k) {\n" +
  "    try { var v = localStorage.getItem(MM_CACHE_PREFIX + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }\n" +
  "  }\n" +
  "  function mmCacheSet(k, svg) {\n" +
  "    try { localStorage.setItem(MM_CACHE_PREFIX + k, JSON.stringify({ v: mmCacheVersion, svg: svg })); } catch (e) {}\n" +
  "    return true;\n" +
  "  }\n" +
  "  function mmCachePrune() {\n" +
  "    var keys = [];\n" +
  "    for (var i = 0; i < localStorage.length; i++) {\n" +
  "      var kk = localStorage.key(i);\n" +
  "      if (kk && kk.indexOf(MM_CACHE_PREFIX) === 0) keys.push(kk);\n" +
  "    }\n" +
  "    if (keys.length <= 300) return;\n" +
  "    keys.sort().reverse();\n" +
  "    for (var j = 300; j < keys.length; j++) {\n" +
  "      try { localStorage.removeItem(keys[j]); } catch (e) { break; }\n" +
  "    }\n" +
  "  }\n" +
  "  mmCachePrune();\n" +
  "\n" +
  "  // Render one <x-mermaid>; on failure show the source with the error, never a\n" +
  "  // blank box (the original viewer's flaw #2 pattern).";

s = s.replace(anchor1, cacheBlock, 1);

// ---- 1b: rewrite mmRenderOne to use the cache
const oldMm =
  "  function mmRenderOne(mod, el, i) {\n" +
  "    var srcEl = el.querySelector('.mdl-mermaid-src');\n" +
  "    var text = srcEl ? srcEl.textContent : el.textContent;\n" +
  "    // keep the original text so a theme change can re-render from source\n" +
  "    el.setAttribute('data-mm-src', text);\n" +
  "    var id = 'mdl-mm-' + i;\n" +
  "    return mod.renderInto(el, text, id)\n" +
  "      .then(function () {\n" +
  "        el.classList.add('mdl-mermaid--ok');\n" +
  "        el.setAttribute('data-mm-state', 'ok');\n" +
  "        mermaidState.rendered++;\n" +
  "      })\n" +
  "      .catch(function (err) {\n" +
  "        var msg = String((err && err.message) || err);\n" +
  "        el.classList.add('mdl-mermaid--err');\n" +
  "        el.setAttribute('data-mm-state', 'error');\n" +
  "        el.innerHTML = '<div class=\"mdl-mermaid-error\"><div class=\"mdl-mermaid-error-hd\">'\n" +
  "          + t('mermaid-render-failed', '\u56fe\u8868\u6e32\u67d3\u5931\u8d25') + '</div><div class=\"mdl-mermaid-error-msg\">' + mmEscape(msg)\n" +
  "          + '</div><pre class=\"mdl-mermaid-src\"><code>' + mmEscape(text)\n" +
  "          + '</code></pre></div>';\n" +
  "      });\n" +
  "  }";

const newMm =
  "  function mmRenderOne(mod, el, i) {\n" +
  "    var srcEl = el.querySelector('.mdl-mermaid-src');\n" +
  "    var text = srcEl ? srcEl.textContent : el.textContent;\n" +
  "    // keep the original text so a theme change can re-render from source\n" +
  "    el.setAttribute('data-mm-src', text);\n" +
  "    var id = 'mdl-mm-' + i;\n" +
  "    var theme = mermaidTheme();\n" +
  "    var ckey = mmHash(text, theme);\n" +
  "    var hit = mmCacheGet(ckey);\n" +
  "    if (hit && hit.v === mmCacheVersion && hit.svg) {\n" +
  "      // cache hit: skip the engine call entirely\n" +
  "      el.innerHTML = hit.svg;\n" +
  "      el.classList.add('mdl-mermaid--ok');\n" +
  "      el.setAttribute('data-mm-state', 'ok');\n" +
  "      mermaidState.rendered++;\n" +
  "      return Promise.resolve();\n" +
  "    }\n" +
  "    return mod.renderInto(el, text, id)\n" +
  "      .then(function () {\n" +
  "        el.classList.add('mdl-mermaid--ok');\n" +
  "        el.setAttribute('data-mm-state', 'ok');\n" +
  "        mermaidState.rendered++;\n" +
  "        // cache the rendered SVG (mermaidTheme() is stable within a theme,\n" +
  "        // so the key is a pure function of the visible content)\n" +
  "        mmCacheSet(ckey, el.innerHTML);\n" +
  "      })\n" +
  "      .catch(function (err) {\n" +
  "        var msg = String((err && err.message) || err);\n" +
  "        el.classList.add('mdl-mermaid--err');\n" +
  "        el.setAttribute('data-mm-state', 'error');\n" +
  "        el.innerHTML = '<div class=\"mdl-mermaid-error\"><div class=\"mdl-mermaid-error-hd\">'\n" +
  "          + t('mermaid-render-failed', '\u56fe\u8868\u6e32\u67d3\u5931\u8d25') + '</div><div class=\"mdl-mermaid-error-msg\">' + mmEscape(msg)\n" +
  "          + '</div><pre class=\"mdl-mermaid-src\"><code>' + mmEscape(text)\n" +
  "          + '</code></pre></div>';\n" +
  "      });\n" +
  "  }";

if (s.indexOf(oldMm) < 0) { console.log('old mmRenderOne not found'); process.exit(1); }
s = s.replace(oldMm, newMm, 1);

writeFileSync('ui/app.js', s);
console.log('feat1 done');
