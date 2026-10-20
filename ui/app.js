// mdlight front-end behaviors: SSE live reload with scroll preservation,
// TOC, theme toggle, print, F2 external editor jump, error-card copy.
(function () {
  'use strict';
  var S = window.__MDL__ || {};
  var tocEl = document.getElementById('mdl-toc');
  var contentEl = document.getElementById('mdl-content');
  var statEl = document.getElementById('mdl-stat');
  var toastEl = document.getElementById('mdl-toast');
  var fileEl = document.getElementById('mdl-file');
  // i18n (parity feature): ui/i18n.js supplies window.MDLI18N. t() falls back to
  // the Chinese string in the call, so a missing en-US key is harmless.
  var I18N = window.MDLI18N;
  function t(k, fb) { return I18N ? I18N.t(k, fb) : fb; }
  function tf(k, fb, vars) {
    if (!I18N) {
      var s = fb;
      if (vars) Object.keys(vars).forEach(function (key) {
        s = s.split('{' + key + '}').join(vars[key]);
      });
      return s;
    }
    return I18N.tf(k, fb, vars);
  }

  // ---- toast ----------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    toastEl.hidden = false;
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  // ---- return-to-top floating button + empty state (UI polish) -----------------
  var totopEl = document.getElementById('mdl-totop');
  function wireTotop() {
    if (!totopEl) return;
    if (!totopEl.dataset.wired) {
      totopEl.dataset.wired = '1';
      totopEl.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      window.addEventListener('scroll', updateTotop, { passive: true });
    }
    updateTotop();
  }
  function updateTotop() {
    if (!totopEl) return;
    totopEl.classList.toggle('is-visible', (window.scrollY || document.documentElement.scrollTop) > 360);
  }
  // when the rendered content is empty, show a friendly placeholder instead of a blank page
  function ensureEmptyState(el, html) {
    if (!el) return;
    if (!html || !html.replace(/<[^>]*>/g, '').trim()) {
      if (!el.querySelector('.mdl-empty')) {
        var d = document.createElement('div');
        d.className = 'mdl-empty';
        d.innerHTML = '<div class="mdl-empty-glyph">📄</div>' +
          '<div class="mdl-empty-text">' + (t('empty-title', '这里还什么都没有')) + '</div>' +
          '<div class="mdl-empty-hint">' + (t('empty-hint', '在左侧打开或编辑一个 Markdown 文件即可开始')) + '</div>';
        el.appendChild(d);
      }
    } else {
      var ex = el.querySelector('.mdl-empty');
      if (ex) ex.remove();
    }
  }

  // ---- stat line --------------------------------------------------------------
  function renderStat() {
    var eq = S.eqCount || 0, err = S.errCount || 0, mm = S.mermaidCount || 0;
    var parts = [eq + ' ' + t('stat-eq', '公式')];
    if (mm) parts.push(mm + ' ' + t('stat-mm', '图表'));
    if (err) parts.push(err + ' ' + t('stat-err', '个失败'));
    statEl.textContent = parts.join(' · ');
    statEl.className = 'mdl-stat' + (err ? ' mdl-stat--err' : '');
  }

  // ---- TOC --------------------------------------------------------------------
  function buildToc() {
    var inner = tocEl.querySelector('.mdl-toc-inner');
    if (!inner) return;
    inner.innerHTML = '';
    (S.toc || []).forEach(function (h) {
      var a = document.createElement('a');
      a.className = 'mdl-toc-item mdl-toc-l' + h.level;
      a.href = '#' + h.anchor;
      a.textContent = h.text;
      a.title = tf('toc-line-hint', '第 {n} 行', { n: h.line });
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var t = document.getElementById(h.anchor);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        markActive(a);
      });
      inner.appendChild(a);
    });
    if (!(S.toc || []).length) inner.innerHTML = '<div class="mdl-toc-empty">' + t('toc-empty', '(无标题)') + '</div>';
  }
  var tocLinks = [];
  function markActive(a) {
    tocLinks.forEach(function (l) { l.classList.remove('is-active'); });
    if (a) { a.classList.add('is-active'); a.scrollIntoView({ block: 'nearest' }); }
  }
  function wireTocActive() {
    tocLinks = Array.prototype.slice.call(tocEl.querySelectorAll('a'));
    if (!('IntersectionObserver' in window)) return;
    var heads = Array.prototype.slice.call(contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var id = en.target.id;
          var link = tocLinks.find(function (l) { return l.getAttribute('href') === '#' + id; });
          if (link) markActive(link);
        }
      });
    }, { rootMargin: '0% 0% -70% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }

  // ---- theme / skin ---------------------------------------------------------
  // parity feature: theme + a visual skin picker. cycleTheme() keeps the ◐
  // button working; the 🎨 popover lets you pick any skin directly.
  var THEMES = ['auto', 'light', 'dark', 'sepia', 'nord', 'solarized', 'dracula', 'matrix',
    'gruvbox', 'ocean', 'forest', 'rosepine', 'catppuccin', 'cyberpunk', 'tokyonight', 'monokai'];
  // skins with a dark background — mermaid must render dark for these regardless of the OS
  var DARK_SKINS = ['dark', 'nord', 'dracula', 'matrix', 'gruvbox', 'ocean', 'forest',
    'rosepine', 'catppuccin', 'cyberpunk', 'tokyonight', 'monokai'];
  var SKINS = [
    { k: 'auto', zh: '跟随系统', en: 'System', sw: ['#ffffff', '#1f2328', '#0969da'] },
    { k: 'light', zh: '浅色', en: 'Light', sw: ['#ffffff', '#1f2328', '#0969da'] },
    { k: 'dark', zh: '深色', en: 'Dark', sw: ['#0d1117', '#e6edf3', '#58a6ff'] },
    { k: 'sepia', zh: '护眼', en: 'Sepia', sw: ['#f4ecd8', '#433422', '#8a5a00'] },
    { k: 'nord', zh: '北欧', en: 'Nord', sw: ['#2e3440', '#d8dee9', '#88c0d0'] },
    { k: 'solarized', zh: '日光', en: 'Solarized', sw: ['#fdf6e3', '#586e75', '#268bd2'] },
    { k: 'dracula', zh: '德古拉', en: 'Dracula', sw: ['#282a36', '#f8f8f2', '#bd93f9'] },
    { k: 'matrix', zh: '黑客', en: 'Matrix', sw: ['#0a0f0a', '#c8f7c5', '#00ff41'] },
    { k: 'gruvbox', zh: '复古', en: 'Gruvbox', sw: ['#282828', '#ebdbb2', '#fb4934'] },
    { k: 'ocean', zh: '海洋', en: 'Ocean', sw: ['#0b1a2b', '#c9d6e3', '#4aa3df'] },
    { k: 'forest', zh: '森林', en: 'Forest', sw: ['#0f1a12', '#d4e6d0', '#4caf50'] },
    { k: 'rosepine', zh: '玫瑰松', en: 'Rose Pine', sw: ['#191724', '#e0def4', '#ebbcba'] },
    { k: 'catppuccin', zh: '猫猫', en: 'Catppuccin', sw: ['#1e1e2e', '#cdd6f4', '#cba6f7'] },
    { k: 'cyberpunk', zh: '赛博朋克', en: 'Cyberpunk', sw: ['#0e0b1a', '#e0e0ff', '#ff2a6d'] },
    { k: 'tokyonight', zh: '东京夜', en: 'Tokyo Night', sw: ['#1a1b26', '#c0caf5', '#7aa2f7'] },
    { k: 'monokai', zh: 'Monokai', en: 'Monokai', sw: ['#272822', '#f8f8f2', '#a6e22e'] }
  ];
  var FONTS = [
    ['', '系统默认', 'System default'],
    ['Microsoft YaHei', '微软雅黑', 'Microsoft YaHei'],
    ['PingFang SC', '苹方', 'PingFang SC'],
    ['Segoe UI', 'Segoe UI', 'Segoe UI'],
    ['Noto Sans SC', '思源黑体', 'Noto Sans SC'],
    ['Source Han Serif SC', '思源宋体', 'Source Han Serif SC'],
    ['SimSun', '宋体', 'SimSun'],
    ['SimHei', '黑体', 'SimHei'],
    ['KaiTi', '楷体', 'KaiTi'],
    ['Georgia', 'Georgia', 'Georgia'],
    ['Times New Roman', 'Times New Roman', 'Times New Roman'],
    ['Consolas', 'Consolas（等宽）', 'Consolas (mono)'],
    ['JetBrains Mono', 'JetBrains Mono（等宽）', 'JetBrains Mono (mono)']
  ];
  function fontLabel(f) { return (I18N && I18N.lang() === 'en-US') ? f[2] : f[1]; }
  var FONT_MIN = 12, FONT_MAX = 28;
  var themeIdx = 0;
  try {
    themeIdx = THEMES.indexOf(localStorage.getItem('mdl-theme')) || 0;
    if (themeIdx < 0) themeIdx = 0;
  } catch (e) { themeIdx = 0; }
  function applyTheme() {
    document.body.dataset.theme = THEMES[themeIdx];
    try { localStorage.setItem('mdl-theme', THEMES[themeIdx]); } catch (e) {}
  }
  applyTheme();
  function currentFontSize() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--mdl-font-size').trim();
    var n = parseFloat(v);
    if (!n || isNaN(n)) n = 15.5;
    return n;
  }
  function setFontSize(px) {
    px = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(px * 10) / 10));
    document.documentElement.style.setProperty('--mdl-font-size', px + 'px');
    try { localStorage.setItem('mdl-font-size', String(px)); } catch (e) {}
    var el = document.getElementById('mdl-size-val');
    if (el) el.textContent = px + 'px';
    postConfig({ fontSize: px });
  }
  function setFontFamily(fam) {
    var rs = document.documentElement.style;
    if (fam) rs.setProperty('--mdl-font', fam + ', "Segoe UI", "Microsoft YaHei", sans-serif');
    else rs.setProperty('--mdl-font', '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif');
    try { localStorage.setItem('mdl-font', fam || ''); } catch (e) {}
    // keep the in-memory copy in step: currentFont() trusts S.cfg first, so
    // without this the 🎨 dropdown snaps back to the old font on reopen
    if (S.cfg) S.cfg.font = fam || '';
    postConfig({ font: fam || '' });
  }
  function postConfig(patch) {
    try { fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(function () {}); } catch (e) {}
  }
  // ---- skin picker popover ---------------------------------------------------
  function skinLabel(s) { return (I18N && I18N.lang() === 'en-US') ? s.en : s.zh; }
  function renderSkinGrid(container) {
    var grid = container || document.getElementById('mdl-skin-grid');
    if (!grid) return;
    grid.innerHTML = '';
    SKINS.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mdl-skin' + (i === themeIdx ? ' mdl-skin--on' : '');
      b.dataset.skin = s.k;
      var sw = document.createElement('span');
      sw.className = 'mdl-skin-sw';
      s.sw.forEach(function (c) {
        var seg = document.createElement('i');
        seg.style.background = c;
        sw.appendChild(seg);
      });
      b.appendChild(sw);
      b.appendChild(document.createTextNode(skinLabel(s)));
      b.addEventListener('click', function () {
        themeIdx = i; applyTheme();
        postConfig({ theme: s.k });
        if (typeof toast === 'function') toast(t('skin', '皮肤') + ': ' + skinLabel(s));
        refreshMermaidTheme();
        renderSkinGrid(); // move the active highlight onto the chosen card
      });
      grid.appendChild(b);
    });
  }
  function currentFont() {
    // the settings window can set ANY system font (it only writes config.json,
    // never localStorage), so read the applied font from config → CSS var → LS
    if (S.cfg && S.cfg.font) return String(S.cfg.font);
    var css = getComputedStyle(document.documentElement).getPropertyValue('--mdl-font').trim();
    if (css && css.indexOf('Segoe UI') !== 0) return css.split(',')[0].trim();
    try { return localStorage.getItem('mdl-font') || ''; } catch (e) { return ''; }
  }
  function renderFontSelect(container) {
    var sel = container || document.getElementById('mdl-font-select');
    if (!sel) return;
    var cur = currentFont();
    var known = FONTS.some(function (f) { return f[0] === cur; });
    // a font set from the ⚙ window may not be in the built-in list; add it to a
    // local view only — pushing into FONTS made the array grow every re-render
    // Prefer system-detected fonts over the built-in list when available
    var sysF = availableFonts();
    var list = sysF.length ? sysF.map(function (f) { return [f, f, f]; }) : FONTS;
    if (cur && !known) list = FONTS.concat([[cur, cur + '（当前）', cur + ' (current)']]);
    sel.innerHTML = '';
    list.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f[0];
      o.textContent = fontLabel(f);
      if (f[0] === cur) o.selected = true;
      sel.appendChild(o);
    });
    // property assignment replaces any earlier handler, so re-rendering never
    // stacks listeners
    sel.onchange = function () { setFontFamily(sel.value); };
  }
  function toggleAppearPop(force) {
    var pop = document.getElementById('mdl-appear-pop');
    if (!pop) return;
    var show = typeof force === 'boolean' ? force : pop.hidden;
    if (show) { renderSkinGrid(); renderFontSelect(); }
    pop.hidden = !show;
  }

  // ---- config (parity feature: %APPDATA%\mdlight\config.json) ----------------
  // The native host exposes /api/config; the settings window (⚙) writes it.
  // Font / font size / theme apply as CSS variables, code wrapping and line
  // numbers as body classes, all without a re-render.
  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    S.cfg = cfg;
    var rs = document.documentElement.style;
    if (cfg.font) rs.setProperty('--mdl-font',
      String(cfg.font) + ', "Segoe UI", "Microsoft YaHei", sans-serif');
    var fs = Number(cfg.fontSize);
    // clamp to the same range the A-/A+ stepper uses, so the readout can never
    // show a value the stepper can't produce (config may carry 10-40)
    if (cfg.fontSize && !isNaN(fs)) {
      fs = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(fs * 10) / 10));
      rs.setProperty('--mdl-font-size', fs + 'px');
      var sv = document.getElementById('mdl-size-val');
      if (sv) sv.textContent = fs + 'px';
    }
    if (cfg.theme) {
      var map = { system: 'auto', light: 'light', dark: 'dark', sepia: 'sepia' };
      var want = map[String(cfg.theme)] || String(cfg.theme);
      var idx = THEMES.indexOf(want);
      if (idx >= 0) { themeIdx = idx; applyTheme(); }
    }
    if (cfg.codeWrap) document.body.classList.add('mdl-code-wrap');
    // config fetch resolves after init() already ran wireCodeLineno(), so add
    // the class and re-run it here — otherwise the line spans never appear.
    if (cfg.codeLineno) { document.body.classList.add('mdl-code-lineno'); if (typeof wireCodeLineno === 'function') wireCodeLineno(); }

    // ---- layout template switch (stream / a4 / slide) ----
    var lay = cfg.layout || 'stream';
    document.body.classList.remove('mdl-layout-a4', 'mdl-layout-slide');
    if (lay === 'a4') document.body.classList.add('mdl-layout-a4');
    else if (lay === 'slide') document.body.classList.add('mdl-layout-slide');
    if (cfg.rememberPosition === false) document.body.dataset.noRemember = '1';
    if (cfg.language && I18N && I18N.lang() !== cfg.language) I18N.setLang(cfg.language);
    // the appearance panel is rendered at startup, BEFORE this async config fetch
    // lands — refresh it so the skin/font/size controls show what config applied
    renderSkinGrid();
    renderFontSelect();
  }

  // ---- font enumeration (system fonts probe) ---------------------------------
  // document.fonts.check() returns true for fonts the system actually has.
  // We probe a list of common CJK + Latin fonts and populate a dropdown with
  // only the ones present on this machine.
  var KNOWN_FONTS = [
    ['SimSun', '仿宋体', 'SimSun'],
    ['SimHei', '黑体', 'SimHei'],
    ['Microsoft YaHei', '微软雅黑', 'Microsoft YaHei'],
    ['Microsoft YaHei UI', '微软雅黑 UI', 'Microsoft YaHei UI'],
    ['KaiTi', '楷体', 'KaiTi'],
    ['FangSong', '方正', 'FangSong'],
    ['DengXian', '等线', 'DengXian'],
    ['Consolas', 'Consolas', 'Consolas'],
    ['Courier New', 'Courier New', 'Courier New'],
    ['Segoe UI', 'Segoe UI', 'Segoe UI'],
    ['Arial', 'Arial', 'Arial'],
    ['Georgia', 'Georgia', 'Georgia'],
    ['Verdana', 'Verdana', 'Verdana'],
    ['Trebuchet MS', 'Trebuchet MS', 'Trebuchet MS'],
    ['Impact', 'Impact', 'Impact'],
    ['Comic Sans MS', 'Comic Sans MS', 'Comic Sans MS'],
    ['Lucida Console', 'Lucida Console', 'Lucida Console'],
    ['Palatino', 'Palatino', 'Palatino'],
    ['Garamond', 'Garamond', 'Garamond'],
    ['Times New Roman', 'Times New Roman', 'Times New Roman'],
    ['Menlo', 'Menlo', 'Menlo'],
    ['Monaco', 'Monaco', 'Monaco'],
    ['Source Code Pro', 'Source Code Pro', 'Source Code Pro'],
    ['Fira Code', 'Fira Code', 'Fira Code'],
    ['JetBrains Mono', 'JetBrains Mono', 'JetBrains Mono'],
    ['Noto Sans CJK SC', 'Noto Sans CJK SC', 'Noto Sans CJK SC'],
    ['Noto Serif CJK SC', 'Noto Serif CJK SC', 'Noto Serif CJK SC'],
  ];
  var fontCache = null;
  function availableFonts() {
    if (fontCache) return fontCache;
    fontCache = [];
    try {
      KNOWN_FONTS.forEach(function (f) {
        var ok = false;
        try { ok = document.fonts.check('12px ' + f[0]); } catch (e) {}
        if (ok) fontCache.push(f[0]);
      });
    } catch (e) {
      // fall back: just include the default list
      KNOWN_FONTS.forEach(function (f) { fontCache.push(f[0]); });
    }
    return fontCache;
  }

  // ---- mermaid (ON-DEMAND) ----------------------------------------------------
  // Rendering needs a DOM, so it happens here, not on the server. The bundle is
  // split (tools/build-mermaid.mjs): nothing is fetched until a document actually
  // contains a ```mermaid fence, and then only the chunk for each diagram kind
  // present. A document with no mermaid downloads ZERO extra bytes.
  // Chunk selection is mermaid's own: render() calls detectType() and dynamically
  // imports the single chunk registered for that kind, so unused kinds never load.
  var mermaidState = { loaded: null, kinds: null, rendered: 0 };
  function mermaidTheme() {
    var t = document.body.dataset.theme;
    if (t === 'dark') return 'dark';
    if (t === 'light' || t === 'sepia') return 'default';
    // skins that are dark even when the OS is light — mermaid must follow the
    // skin, not the OS, or the chart colours clash with the page
    if (DARK_SKINS.indexOf(t) >= 0) return 'dark';
    // 'auto': follow the OS
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'; }
    catch (e) { return 'default'; }
  }
  function mmEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // ---- mermaid SVG cache (content fingerprint -> localStorage) ------------
  // Rendering a mermaid diagram is expensive (parse + layout). When a document
  // is re-opened (SSE reload, file switched back and forth) the same source
  // text re-renders from scratch. Cache the resulting SVG keyed by a FNV-1a
  // hash of (version + theme + source); on a hit the engine call is skipped.
  var mmCacheVersion = 1; // bump to invalidate stale entries after engine changes
  var MM_CACHE_PREFIX = 'mdl-mm-cv1:';
  function mmHash(text, theme) {
    var h = 0x811c9dc5;
    var key = mmCacheVersion + '|' + theme + '|' + text;
    for (var i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = (h * 0x01000193) | 0; }
    return 'fnv' + (h >>> 0).toString(36);
  }
  function mmCacheGet(k) {
    try { var v = localStorage.getItem(MM_CACHE_PREFIX + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function mmCacheSet(k, svg) {
    try { localStorage.setItem(MM_CACHE_PREFIX + k, JSON.stringify({ v: mmCacheVersion, svg: svg })); } catch (e) {}
    return true;
  }
  function mmCachePrune() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var kk = localStorage.key(i);
      if (kk && kk.indexOf(MM_CACHE_PREFIX) === 0) keys.push(kk);
    }
    if (keys.length <= 300) return;
    keys.sort().reverse();
    for (var j = 300; j < keys.length; j++) {
      try { localStorage.removeItem(keys[j]); } catch (e) { break; }
    }
  }
  mmCachePrune();

  // Render one <x-mermaid>; on failure show the source with the error, never a
  // blank box (the original viewer's flaw #2 pattern).
  function mmRenderOne(mod, el, i) {
    var srcEl = el.querySelector('.mdl-mermaid-src');
    var text = srcEl ? srcEl.textContent : el.textContent;
    // keep the original text so a theme change can re-render from source
    el.setAttribute('data-mm-src', text);
    var id = 'mdl-mm-' + i;
    var theme = mermaidTheme();
    var ckey = mmHash(text, theme);
    var hit = mmCacheGet(ckey);
    if (hit && hit.v === mmCacheVersion && hit.svg) {
      // cache hit: skip the engine call entirely
      el.innerHTML = hit.svg;
      el.classList.add('mdl-mermaid--ok');
      el.setAttribute('data-mm-state', 'ok');
      mermaidState.rendered++;
      return Promise.resolve();
    }
    return mod.renderInto(el, text, id)
      .then(function () {
        el.classList.add('mdl-mermaid--ok');
        el.setAttribute('data-mm-state', 'ok');
        mermaidState.rendered++;
        // cache the rendered SVG (mermaidTheme() is stable within a theme,
        // so the key is a pure function of the visible content)
        mmCacheSet(ckey, el.innerHTML);
      })
      .catch(function (err) {
        var msg = String((err && err.message) || err);
        el.classList.add('mdl-mermaid--err');
        el.setAttribute('data-mm-state', 'error');
        el.innerHTML = '<div class="mdl-mermaid-error"><div class="mdl-mermaid-error-hd">'
          + t('mermaid-render-failed', '图表渲染失败') + '</div><div class="mdl-mermaid-error-msg">' + mmEscape(msg)
          + '</div><pre class="mdl-mermaid-src"><code>' + mmEscape(text)
          + '</code></pre></div>';
      });
  }
  function renderMermaid() {
    var nodes = contentEl.querySelectorAll('x-mermaid');
    if (!nodes.length) return Promise.resolve();
    mermaidState.rendered = 0;
    // import() resolves relative to THIS script, so the served path works in
    // live mode. A static export has no server and inlining mermaid's split
    // closure would add ~1.4 MB to a single-file export, so the source block is
    // kept and labelled with how to view it rendered.
    if (!document.body.hasAttribute('data-live')) {
      for (var k = 0; k < nodes.length; k++) {
        nodes[k].setAttribute('data-mm-state', 'static');
        var hint = document.createElement('div');
        hint.className = 'mdl-mermaid-hint';
        hint.textContent = t('mermaid-static-hint', '离线导出不含图表引擎（避免单文件增大约 1.4 MB）· 用 mdlight 打开原 .md 即可渲染');
        nodes[k].appendChild(hint);
      }
      return Promise.resolve();
    }
    return import('/assets/mermaid/mermaid-entry.js')
      .then(function (mod) {
        mermaidState.loaded = mod;
        mod.setConfig({ theme: mermaidTheme() });
        var jobs = [];
        for (var i = 0; i < nodes.length; i++) jobs.push(mmRenderOne(mod, nodes[i], i));
        return Promise.all(jobs);
      })
      .catch(function (err) {
        // chunk failed to load: leave the escaped source visible, say so once
        toast(t('engine-failed','图表引擎加载失败') + ': ' + String((err && err.message) || err));
      });
  }

  // ---- PDF header / footer macros (@page + JS replacement) -----------------
  // {title}/{page}/{total}/{date} placeholders in the configured
  // pdfHeader/pdfFooter strings are substituted at print time; an @media print
  // <style> carries @page margins so the print engine (or WebView2's
  // PrintToPdfAsync) lays out with real page geometry.
  function pdfMacro(str, title, page, total) {
    if (!str) return '';
    var d = new Date();
    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return String(str)
      .replace(/\{title\}/g, title || '')
      .replace(/\{page\}/g, String(page || 1))
      .replace(/\{total\}/g, String(total || 1))
      .replace(/\{date\}/g, date);
  }
  function estimateTotalPages() {
    var h = document.body.scrollHeight || 842;
    return Math.max(1, Math.ceil(h / 842));
  }
// feat12 replacement block for ui/app.js (spliced in by feat12-paginated-pdf.mjs)
  // ---- publisher-grade paginated PDF ------------------------------------------
  // Before printing we re-lay the document out as a stack of fixed-height A4
  // page boxes. Each top-level block is measured against the usable page
  // height and explicit page breaks are inserted so that:
  //   * no block is cut in half (orphans/widows handled at block level),
  //   * a heading is never the last line of a page (dangle guard),
  //   * header/footer live in @page margin boxes and repeat on every page.
  var PDF_PAGE_H = 1123;        // A4 usable height px at 96dpi (297mm - 40mm margins)
  var PDF_CONTENT_W = 794;      // A4 width minus 30mm margins at 96dpi
  function buildPaginatedCss(header, footer, title) {
    var q = String.fromCharCode(34); // "
    var css = [
      '@media print {',
      '  @page {',
      '    size: 210mm 297mm; margin: 20mm 15mm;',
    ];
    if (header) css.push('    @top-left { content: ' + q + header + q + '; font-size: 8px; color: #888; }');
    if (footer) css.push('    @bottom-right { content: ' + q + footer + q + '; font-size: 8px; color: #888; }');
    css.push(
      '  }',
      '  html, body { width: ' + PDF_CONTENT_W + 'px; }',
      '  #mdl-content { width: ' + PDF_CONTENT_W + 'px; }',
      '  .pdf-page { height: ' + PDF_PAGE_H + 'px; overflow: hidden; page-break-after: always; break-after: page; position: relative; }',
      '  .pdf-page:last-child { page-break-after: auto; break-after: auto; }',
      '  .pdf-page > * { orphans: 3; widows: 3; }',
      '  h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }',
      '  pre, code, table, figure, .mdl-diagram, .mdl-callout { break-inside: avoid; page-break-inside: avoid; }',
      '  .mdl-folded { display: none; }',
      '  #mdl-toc, .mdl-toolbar, .mdl-find-bar, .mdl-sc-panel, #mdl-editor, .mdl-tab-bar { display: none !important; }',
      '}'
    );
    return css.join(String.fromCharCode(10));
  }
  // Paginate: walk #mdl-content top-level blocks and group them into pages of
  // PDF_PAGE_H px. A heading never ends a page: if a heading lands within the
  // last 48px of a page with content after it, the heading moves to the next
  // page (dangle guard).
  function paginateContent() {
    var content = document.getElementById('mdl-content');
    if (!content) return;
    // remove any previous pagination wrappers (unwind them)
    content.querySelectorAll(':scope > .pdf-page').forEach(function (p) {
      while (p.firstChild) content.insertBefore(p.firstChild, p);
      p.remove();
    });
    content.classList.remove('pdf-paginated');
    var blocks = Array.prototype.slice.call(content.children);
    if (!blocks.length) return;
    var pages = [];
    var cur = null, used = 0;
    var DANGLE = 48; // heading dangle guard height
    blocks.forEach(function (blk) {
      var h = blk.getBoundingClientRect().height || 0;
      var isHeading = /^H[1-6]$/.test(blk.tagName);
      var hasFollow = blk.nextElementSibling !== null;
      // dangle guard: heading that would be the last content on a page
      if (isHeading && hasFollow && used + h > PDF_PAGE_H - DANGLE && used > 0) {
        pages.push(cur);
        cur = document.createElement('div');
        cur.className = 'pdf-page';
        used = 0;
      } else if (used + h > PDF_PAGE_H && used > 0) {
        pages.push(cur);
        cur = document.createElement('div');
        cur.className = 'pdf-page';
        used = 0;
      }
      cur.appendChild(blk);
      used += h;
    });
    if (cur) pages.push(cur);
    pages.forEach(function (pg) {
      content.insertBefore(pg, content.lastElementSibling || null);
    });
    content.classList.add('pdf-paginated');
  }
  function applyPdfMacros() {
    var cfg = S.cfg || {};
    var title = (S.toc && S.toc[0] && S.toc[0].text) || (fileEl ? fileEl.textContent : '');
    var header = (cfg.pdfHeader || '').trim();
    var footer = (cfg.pdfFooter || '').trim();
    var total = estimateTotalPages();
    header = header ? pdfMacro(header, title, 0, total) : title;
    footer = footer ? pdfMacro(footer, title, 0, total) : '';
    var style = document.getElementById('mdl-pdf-macros') || document.createElement('style');
    style.id = 'mdl-pdf-macros';
    style.textContent = buildPaginatedCss(header, footer, title);
    if (!style.parentNode) document.head.appendChild(style);
    paginateContent();
  }

  // ---- print ------------------------------------------------------------------
  var printBtn = document.getElementById('mdl-btn-print');
  if (printBtn) printBtn.addEventListener('click', function () {
    applyPdfMacros();
    // Let the paginated layout paint before the print dialog locks the DOM.
    setTimeout(function () { window.print(); }, 80);
  });
  // Undo pagination after printing so the on-screen view returns to normal flow.
  window.addEventListener('afterprint', function () {
    var content = document.getElementById('mdl-content');
    if (content) {
      content.querySelectorAll(':scope > .pdf-page').forEach(function (p) {
        while (p.firstChild) content.insertBefore(p.firstChild, p);
        p.remove();
      });
      content.classList.remove('pdf-paginated');
      var st = document.getElementById('mdl-pdf-macros');
      if (st) st.remove();
    }
  });

  // ---- 📊 export CSV (parity feature) -----------------------------------------
  // Collect every table in the document, post each as raw CSV to the host; it
  // writes <docname>-表格N.csv beside the .md file.
  function cellText(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }
  function tableToCsv(t) {
    var rows = t.querySelectorAll('tr'), lines = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll('th, td'), out = [];
      for (var j = 0; j < cells.length; j++) {
        var v = cellText(cells[j]);
        if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        out.push(v);
      }
      lines.push(out.join(','));
    }
    return lines.join('\r\n');
  }
  function exportCsv() {
    var tables = contentEl.querySelectorAll('table');
    if (!tables.length) { toast(t('no-table', '文档中没有表格')); return; }
    var base = (S.filepath || 'document').replace(/\.[^.]*$/, '');
    var jobs = [];
    for (var i = 0; i < tables.length; i++) {
      var csv = tableToCsv(tables[i]);
      var name = base + '-表格' + (i + 1) + '.csv';
      jobs.push(fetch('/api/export-csv?name=' + encodeURIComponent(name),
        { method: 'POST', body: csv }).then(function (r) { return r.json(); }));
    }
    Promise.all(jobs).then(function (rs) {
      var ok = rs.filter(function (r) { return r && r.ok; }).length;
      toast(t('csv-exported', '已导出 {n} 个 CSV 文件').replace('{n}', ok));
    }).catch(function () { toast(t('no-service', '无法联系 mdlight 服务')); });
  }
  var csvBtn = document.getElementById('mdl-btn-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportCsv);

  // ---- export current document as LaTeX (.tex) --------------------------
  function exportLatex() {
    var mod = window.MDLRenderer;
    if (!mod || typeof mod.mdToLatex !== 'function') {
      toast(t('tex-failed', 'LaTeX 导出失败')); return;
    }
    // Get the raw markdown source: prefer the in-memory source from the
    // source editor if open, otherwise fetch from the server.
    var sourceEl2 = document.getElementById('mdl-source');
    var doExport = function (source) {
      if (!source) { toast(t('tex-failed', 'LaTeX 导出失败')); return; }
      var tex;
      try { tex = mod.mdToLatex(source); }
      catch (e) { toast(t('tex-failed', 'LaTeX 导出失败')); return; }
      var base = (S.filepath || 'document').replace(/.[^.]*$/, '');
      var name = base + '.tex';
      fetch('/api/export-latex?name=' + encodeURIComponent(name),
        { method: 'POST', body: tex })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) toast(t('tex-exported', '已导出 LaTeX 文件'));
          else toast(t('tex-failed', 'LaTeX 导出失败') + ' ' + ((j && j.error) || ''));
        })
        .catch(function () { toast(t('no-service', '无法联系 mdlight 服务')); });
    };
    if (sourceEl2 && sourceEl2.value && sourceEl2.value.trim()) {
      doExport(sourceEl2.value);
    } else {
      // fetch source from the server
      fetch('/api/source', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { doExport((j && j.source) || ''); })
        .catch(function () { toast(t('no-service', '无法联系 mdlight 服务')); });
    }
  }
  var texBtn = document.getElementById('mdl-btn-tex');
  if (texBtn) texBtn.addEventListener('click', exportLatex);

  // ---- ⇣ import PDF / LaTeX → Markdown (一键导入) ----------------------------
  // Hidden file inputs let the toolbar buttons open a native picker. The file is
  // read client-side, converted with the bundled converter, written next to the
  // current doc via /api/import-md, and swapped in — so "导入" immediately yields
  // an editable .md the user can keep editing.
  function addImportPicker(id, accept, onFile) {
    var btn = document.getElementById(id);
    if (!btn) return;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) onFile(f);
      input.value = ''; // allow re-picking the same file
    });
    btn.addEventListener('click', function () { input.click(); });
  }

  function importToMd(name, markdown, srcLabel) {
    fetch('/api/import-md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, content: markdown }),
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) toast(t('imported', '已导入并打开 {src} → {name}').replace('{src}', srcLabel).replace('{name}', name));
        else toast(t('import-failed', '导入失败') + ': ' + ((j && j.error) || ''));
      })
      .catch(function () { toast(t('no-service', '无法联系 mdlight 服务')); });
  }

  addImportPicker('mdl-btn-import-tex', '.tex,.bbl,.latex', function (f) {
    var fr = new FileReader();
    fr.onload = function () {
      var tex = String(fr.result || '');
      var io = (f.name || 'import').replace(/\.[^.]*$/, '') + '.md';
      var mod = window.MDLRenderer;
      if (!mod || typeof mod.latexToMarkdown !== 'function') { toast(t('import-failed', '导入失败') + ': latexToMarkdown 未加载'); return; }
      var md;
      try { md = mod.latexToMarkdown(tex); }
      catch (e) { toast(t('import-failed', '导入失败') + ': ' + (e && e.message || e)); return; }
      importToMd(io, md, f.name);
    };
    fr.readAsText(f, 'utf-8');
  });
  addImportPicker('mdl-btn-import-pdf', '.pdf', function (f) {
    var fr = new FileReader();
    fr.onload = function () {
      var bytes = new Uint8Array(fr.result);
      var io = (f.name || 'import').replace(/\.[^.]*$/, '') + '.md';
      var mod = window.MDLRenderer;
      if (!mod || typeof mod.pdfToMarkdown !== 'function') { toast(t('import-failed', '导入失败') + ': pdfToMarkdown 未加载'); return; }
      var r = mod.pdfToMarkdown(bytes);
      Promise.resolve(r).then(function (res) {
        if (res && res.markdown) importToMd(io, res.markdown, f.name);
        else toast(t('import-failed', '导入失败') + ': ' + ((res && res.warnings && res.warnings.join('; ')) || '无文本'));
      }).catch(function (e) {
        toast(t('import-failed', '导入失败') + ': ' + (e && e.message || e));
      });
    };
    fr.readAsArrayBuffer(f);
  });

  
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

// ---- 📄 export PDF (parity feature) -----------------------------------------
  // The native host renders the page to PDF via WebView2 PrintToPdfAsync, so
  // mermaid / KaTeX come out exactly as on screen. Only available in a real
  // window (a plain Edge --app has no chrome.webview).
  var pdfBtn = document.getElementById('mdl-btn-pdf');
  if (pdfBtn) pdfBtn.addEventListener('click', function () {
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage('export:pdf');
    else toast(t('pdf-window-only', 'PDF 导出需要窗口模式'));
  });

  // ---- 🧠 outline mind-map (parity feature: markmap) ---------------------------
  // A zero-dependency SVG renderer: build a tree out of the document's headings
  // and lay it out as a horizontal tree, markmap-style. Full-screen with
  // pan + zoom. Uses the same heading source as the TOC.
  var mm = { open: false, scale: 1, tx: 0, ty: 0, dragging: false, px: 0, py: 0 };
  function buildTree(nodes) {
    // The first heading IS the root — start the walk at index 1, otherwise it
    // also becomes a child of itself and the mind-map shows it twice.
    var first = nodes[0];
    var root = {
      text: first ? first.text : '',
      children: [],
      // one level above the first heading, so a later heading of the same level
      // is pushed under the root instead of nesting inside the previous one
      level: (first ? first.level : 1) - 1
    };
    var stack = [root];
    for (var i = 1; i < nodes.length; i++) {
      var n = nodes[i], node = { text: n.text, children: [], level: n.level };
      while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    return root;
  }
  function layout(root, colW, rowH) {
    var y = 0;
    (function walk(n, depth) {
      n.x = depth * colW;
      n.depth = depth;
      if (!n.children.length) { n.y = y; y += rowH; return; }
      var first = null, last = null;
      for (var i = 0; i < n.children.length; i++) {
        walk(n.children[i], depth + 1);
        if (first === null) first = n.children[i].y;
        last = n.children[i].y;
      }
      // centre the parent on the span of its children — averaging pair by pair
      // drifts the node downward on trees with 3+ children
      n.y = (first + last) / 2;
    })(root, 0);
    return y;
  }
  function mmEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function renderMindmap() {
    var nodes = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (!nodes.length) { toast(t('no-heading', '文档没有标题，无法生成脑图')); return; }
    var arr = [];
    for (var i = 0; i < nodes.length; i++) {
      arr.push({ text: nodes[i].textContent.trim(), level: Number(nodes[i].tagName[1]) });
    }
    var root = buildTree(arr);
    var COL_W = 240, ROW_H = 44;
    var totalH = layout(root, COL_W, ROW_H);
    // measure max depth for width
    var maxD = 0;
    (function d(n) { maxD = Math.max(maxD, n.depth || 0); if (n.children) n.children.forEach(d); })(root);
    var W = (maxD + 1) * COL_W + 200;
    var H = Math.max(totalH + 80, 300);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">';
    var g = '<g transform="translate(80,40)">';
    var defs = '', links = '', labels = '';
    (function draw(n, parent) {
      if (parent) {
        var mid = (n.y + parent.y) / 2;
        var path = 'M' + parent.x + ' ' + parent.y +
          ' C' + (parent.x + 60) + ' ' + parent.y + ' ' + (n.x - 60) + ' ' + mid + ' ' + n.x + ' ' + mid +
          ' L' + n.x + ' ' + n.y;
        links += '<path d="' + path + '" fill="none" stroke="var(--border)" stroke-width="1.6"/>';
      }
      var w = Math.min(n.text.length * 13 + 18, 220);
      var cx = n.x + 4, cy = n.y - 12;
      defs += '<rect x="' + cx + '" y="' + cy + '" width="' + w + '" height="24" rx="6" fill="var(--code-bg)"/>';
      labels += '<text x="' + (cx + 9) + '" y="' + (cy + 16) + '" fill="var(--fg)" font-size="13">' + mmEscape(n.text) + '</text>';
      if (n.children) n.children.forEach(function (c) { draw(c, n); });
    })(root, null);
    svg += g + defs + links + labels + '</g></svg>';
    document.getElementById('mdl-mindmap-title').textContent = root.text || '';
    document.getElementById('mdl-mindmap-body').innerHTML = svg;
    mm.scale = 1; mm.tx = 0; mm.ty = 0;
    applyMindmapTransform();
    document.getElementById('mdl-mindmap').hidden = false;
    mm.open = true;
  }
  function applyMindmapTransform() {
    var svg = document.querySelector('#mdl-mindmap-body svg');
    if (!svg) return;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = 'translate(' + mm.tx + 'px,' + mm.ty + 'px) scale(' + mm.scale + ')';
  }
  function closeMindmap() {
    mm.open = false;
    document.getElementById('mdl-mindmap').hidden = true;
  }
  function openMindmap() { renderMindmap(); }
  var mindmapBtn = document.getElementById('mdl-btn-mindmap');
  if (mindmapBtn) mindmapBtn.addEventListener('click', openMindmap);
  var marpBtn = document.getElementById('mdl-btn-marp');
  if (marpBtn) marpBtn.addEventListener('click', function () { if (marpState.slides && marpState.slides.length) enterMarp(); });
  var mmClose = document.getElementById('mdl-mindmap-close');
  if (mmClose) mmClose.addEventListener('click', closeMindmap);
  var mmBody = document.getElementById('mdl-mindmap-body');
  if (mmBody) {
    mmBody.addEventListener('wheel', function (e) {
      e.preventDefault();
      var d = e.deltaY > 0 ? 0.9 : 1.1;
      mm.scale = Math.max(0.3, Math.min(3, mm.scale * d));
      applyMindmapTransform();
    }, { passive: false });
    mmBody.addEventListener('mousedown', function (e) { mm.dragging = true; mm.px = e.clientX; mm.py = e.clientY; });
    window.addEventListener('mousemove', function (e) {
      if (!mm.dragging) return;
      mm.tx += e.clientX - mm.px; mm.ty += e.clientY - mm.py;
      mm.px = e.clientX; mm.py = e.clientY;
      applyMindmapTransform();
    });
    window.addEventListener('mouseup', function () { mm.dragging = false; });
  }

  // ---- F2 / external editor ---------------------------------------------------
  // Jump to the line of the block nearest the top of the viewport.
  function nearestLine() {
    var best = 1, bestTop = Infinity;
    contentEl.querySelectorAll('[data-mdl-line]').forEach(function (el) {
      var top = el.getBoundingClientRect().top;
      if (top >= -40 && top < bestTop) { bestTop = top; best = el.getAttribute('data-mdl-line'); }
    });
    return parseInt(best, 10) || 1;
  }
  function openEditor() {
    var line = nearestLine();
    fetch('/api/open-editor?line=' + line)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        toast(j.ok ? tf('editor-opened', '已在编辑器打开 (第 {n} 行{via})', { n: line, via: j.via ? ', ' + j.via : '' }) : t('editor-not-found', '未找到编辑器，请设置 MD_EDITOR'));
      })
      .catch(function () { toast(t('no-service','无法联系 mdlight 服务')); });
  }
  var editBtn = document.getElementById('mdl-btn-edit');
  if (editBtn) editBtn.addEventListener('click', openEditor);

  // ---- settings dialog (v0.7.2) ----------------------------------------------
  // The ⚙ button asks the native host to pop its WinForms settings dialog. It
  // saves straight into %APPDATA%\mdlight\config.json and the host broadcasts a
  // reload; once the fetch resolves, refresh so the new font/theme/... apply.
  var settingsBtn = document.getElementById('mdl-btn-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', function () {
    fetch('/api/settings', { method: 'POST', body: '{}' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        // only the native host has a WinForms dialog; fetch() resolves on 404
        // too, so without this check the click silently reloads the page
        if (j && j.ok) { liveReload(); return; }
        toast((j && j.error) || t('no-service', '无法联系 mdlight 服务'));
      })
      .catch(function () { toast(t('no-service', '无法联系 mdlight 服务')); });
  });

  // ---- language toggle (parity feature: zh-CN / en-US) ------------------------
  var langBtn = document.getElementById('mdl-btn-lang');
  if (langBtn) langBtn.addEventListener('click', function () {
    var cur = I18N ? I18N.lang() : 'zh-CN';
    var next = cur === 'zh-CN' ? 'en-US' : 'zh-CN';
    if (I18N) I18N.setLang(next);
    langBtn.title = next === 'zh-CN' ? 'English' : '中文';
    // persist alongside the rest of the settings
    fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: next })
    }).catch(function () {});
  });
  // reflect the stored language on first paint (i18n.js keeps its own choice)
  if (I18N) { I18N.apply(); if (langBtn) langBtn.title = I18N.lang() === 'zh-CN' ? 'English' : '中文'; }

  // ---- internal source editor (v0.3.0) ---------------------------------------
  // For users without an external editor: edit the markdown source directly,
  // save with conflict detection (sha256), then auto-refresh the preview.
  var editorEl = document.getElementById('mdl-editor');
  var sourceEl = document.getElementById('mdl-source');
  var editorOpen = false;
  var editorSha = null;

  function openSourceEditor() {
    fetch('/api/source')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) {
          sourceEl.value = j.source;
          editorSha = j.sha;
          editorEl.hidden = false;
          setTimeout(function () { editorEl.classList.add('open'); }, 20);
          editorOpen = true;
          sourceEl.focus();
          toast(t('loaded','源码编辑已打开'));
        } else {
          toast(t('read-failed','读取源码失败'));
        }
      })
      .catch(function () { toast(t('no-service','无法联系 mdlight 服务')); });
  }
  function closeSourceEditor() {
    editorEl.classList.remove('open');
    setTimeout(function () { editorEl.hidden = true; }, 220);
    editorOpen = false;
    if (dualMode) exitDual();
  }

  // ---- F3 dual view ----------------------------------------------------------
  // F3: source editor and rendered preview side by side, re-rendering
  // live as you type. Reuses the same editor panel (left) and content area
  // (right); a body class flips the layout via CSS.
  var dualMode = false;
  var dualTimer = null;
  function toggleDual() {
    if (dualMode) { exitDual(); return; }
    if (!editorOpen) openSourceEditor();
    dualMode = true;
    editorEl.hidden = false;
    editorEl.classList.add('dual');
    document.body.classList.add('mdl-dual');
    // Drop the panel-open animation so the side-by-side swap is instant.
    editorEl.classList.add('open');
    sourceEl.addEventListener('input', onDualInput);
    toast(t('dual','双栏分屏 (F3 退出)'));
  }
  function exitDual() {
    dualMode = false;
    if (dualTimer) { clearTimeout(dualTimer); dualTimer = null; }
    sourceEl.removeEventListener('input', onDualInput);
    editorEl.classList.remove('dual');
    document.body.classList.remove('mdl-dual');
    editorEl.classList.remove('open');
    setTimeout(function () { editorEl.hidden = true; }, 220);
    editorOpen = false;
  }
  function onDualInput() {
    if (dualTimer) clearTimeout(dualTimer);
    dualTimer = setTimeout(function () {
      dualTimer = null;
      if (!dualMode) return;
      // No placeholder in dual view — the editor already shows the source, so
      // a stale <pre> would just flicker behind it.
      (document.body.hasAttribute('data-live') ? renderInWorker(sourceEl.value) : syncRender(sourceEl.value))
        .then(function (out) { if (dualMode) paintContent(out, true); })
        .catch(function () {});
    }, 350);
  }
  function saveSource(force, baseSha) {
    fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ source: sourceEl.value, base: baseSha || editorSha, force: !!force })
    })
    .then(function (r) {
      if (r.status === 409) return r.json().then(function (j) { throw { conflict: true, sha: j.sha }; });
      return r.json();
    })
    .then(function (j) {
      if (j.ok) {
        editorSha = j.sha;
        toast(t('saved','已保存'));
        closeSourceEditor();
        liveReload();
      }
    })
    .catch(function (err) {
      if (err && err.conflict) {
        var override = confirm(t('conflict-body', '文件在编辑时已被外部修改。\n\n点击“确定”用编辑器内容覆盖磁盘文件；\n点击“取消”放弃编辑并重新加载磁盘文件。'));
        if (override) {
          saveSource(true, err.sha);
        } else {
          fetch('/api/source')
            .then(function (r) { return r.json(); })
            .then(function (j) {
              if (j.ok) {
                sourceEl.value = j.source;
                editorSha = j.sha;
                toast(t('reloaded','已重新加载磁盘文件'));
              }
            });
        }
      } else {
        toast(t('save-failed','保存失败'));
      }
    });
  }

  // The editor panel only exists once its markup has been parsed. If a node is
  // missing (markup changed, export layout), skip the wiring instead of throwing
  // — an exception here would abort the rest of init and kill every other
  // behavior on the page. (The topbar's standalone 源码 button was removed in
  // v0.7.1 — source editing now lives behind the ✍ toolbar, so there is no
  // srcBtnEl to wire here.)
  var closeBtnEl = document.getElementById('mdl-editor-close');
  var saveBtnEl = document.getElementById('mdl-editor-save');
  if (closeBtnEl) closeBtnEl.addEventListener('click', closeSourceEditor);
  if (saveBtnEl) saveBtnEl.addEventListener('click', function () { saveSource(); });

  // Expose the source panel to the WYSIWYG toolbar's "源码" button: direct
  // editing reuses the very same textarea + save pipeline. The source view is
  // for the cases WYSIWYG serialization is lossy (complex tables, nesting).
  if (typeof window !== 'undefined') window.__mdlOpenSource = openSourceEditor;
  if (typeof window !== 'undefined') window.__mdlMermaidTheme = mermaidTheme;

  // ---- wikilink: ctrl+click copies [[target]] ----------------------------------
  contentEl.addEventListener('click', function (e) {
    var a = e.target.closest('.mdl-wikilink');
    if (!a) return;
    e.preventDefault();
    var target = a.getAttribute('data-wikilink');
    var text = '[[' + target + ']]';
    navigator.clipboard.writeText(text).then(function () {
      toast(t('copy','已复制 ') + text);
    }, function () {
      toast(target);
    });
  });

  // ---- error card copy buttons ---------------------------------------------------
  contentEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.mdl-math-error-src');
    if (!btn) return;
    navigator.clipboard.writeText(btn.textContent).then(function () { toast(t('copy-formula','已复制公式源码')); });
  });
  // clicking the error message area copies it too
  contentEl.addEventListener('click', function (e) {
    var head = e.target.closest('.mdl-math-error-head');
    if (!head) return;
    navigator.clipboard.writeText(head.textContent).then(function () { toast(t('copy-error','已复制错误信息')); });
  });

  // ---- copy a rendered formula as LaTeX source -----------------------------
  // Selecting a rendered equation and pressing Ctrl+C (or right-click → Copy)
  // puts the *rendered* text into the clipboard. Users expect the original
  // LaTeX, so if the whole selection sits inside one x-equation we rewrite the
  // clipboard to its data-src. Works for inline and display math alike.
  function equationFromRange(range) {
    if (!range || range.collapsed) return null;
    var c = range.commonAncestorContainer;
    var el = (c.nodeType === 3) ? c.parentNode : c;
    if (!el || !el.closest) return null;
    // The selection may start inside the equation's KaTeX markup; walk up.
    var eq = el.closest('x-equation');
    if (!eq) return null;
    // …but only when the whole selection is inside the same equation, so a
    // drag across text-plus-formula still copies what the user actually
    // selected (the text node comparison handles the partial-selection case).
    var s = range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;
    var e2 = range.endContainer.nodeType === 3 ? range.endContainer.parentNode : range.endContainer;
    if (!eq.contains(s) || !eq.contains(e2)) return null;
    return eq;
  }
  document.addEventListener('copy', function (e) {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var eq = equationFromRange(sel.getRangeAt(0));
    if (!eq) return;
    var latex = eq.getAttribute('data-src');
    if (!latex) return;
    e.preventDefault();
    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', latex);
      // keep the rich text out of Word/Outlook pastes
      e.clipboardData.setData('text/html', '<span>' + String(latex).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>');
    }
    toast(t('copy-formula','已复制公式源码'));
  }, true);

  // hover copy button on every rendered equation (discoverability)
  function wireEquationCopy() {
    var eqs = contentEl.querySelectorAll('x-equation');
    for (var i = 0; i < eqs.length; i++) {
      if (eqs[i].querySelector('.mdl-eq-copy')) continue;
      var latex = eqs[i].getAttribute('data-src');
      if (!latex) continue;
      var b = document.createElement('button');
      b.className = 'mdl-eq-copy';
      b.type = 'button';
      b.title = t('copy-formula','已复制公式源码');
      b.textContent = '⧉';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var src = this.closest('x-equation').getAttribute('data-src');
        if (!src) return;
        navigator.clipboard.writeText(src).then(function () { toast(t('copy-formula','已复制公式源码')); });
      });
      eqs[i].appendChild(b);
    }
  }
  if (typeof window !== 'undefined') window.__mdlWireEquationCopy = wireEquationCopy;

  // ---- frameless window controls (native host only) --------------------------
  // The C# host opens the page with ?frameless=1 and no OS title bar. The topbar
  // becomes the drag region (CSS -webkit-app-region) and these buttons drive the
  // window through WebView2's postMessage. Elsewhere the controls stay hidden.
  if (document.body) {
    var mdlFrameless = false;
    try { mdlFrameless = /[?&]frameless=1/.test(location.search); } catch (e) {}
    if (mdlFrameless) {
      document.body.classList.add('mdl-frameless');
      var wc = document.getElementById('mdl-win-ctls');
      if (wc) wc.hidden = false;
      var send = function (cmd) {
        try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(cmd); } catch (e) {}
      };
      var wmin = document.getElementById('mdl-win-min');
      var wmax = document.getElementById('mdl-win-max');
      var wclose = document.getElementById('mdl-win-close');
      if (wmin) wmin.addEventListener('click', function () { send('win:min'); });
      if (wmax) wmax.addEventListener('click', function () { send('win:max'); });
      if (wclose) wclose.addEventListener('click', function () { send('win:close'); });
    }
  }

  // ---- keyboard ---------------------------------------------------------------
  // in-page find bar (parity feature): Ctrl+F, highlight all, Enter/Shift+Enter
  // step through the hits. Marks are injected into text nodes with splitText so
  // the original DOM (and any mermaid SVG) is untouched apart from the wrapping.
  var findBar = document.getElementById('mdl-find');
  var findInput = document.getElementById('mdl-find-input');
  var findCount = document.getElementById('mdl-find-count');
  var findHits = [];
  var findIdx = -1;
  function clearFindMarks() {
    findHits.forEach(function (h) {
      var p = h.parentNode;
      if (!p || !p.isConnected) return;
      p.replaceChild(document.createTextNode(h.textContent), h);
      p.normalize();
    });
    findHits = [];
    findIdx = -1;
  }
  function openFind() {
    if (!findBar) return;
    findBar.hidden = false;
    // prefill with the current selection if there is one
    var sel = '';
    try { sel = String(window.getSelection() || ''); } catch (e) {}
    if (sel && sel.trim()) { findInput.value = sel.slice(0, 200); }
    findInput.focus();
    findInput.select();
    if (findInput.value) doFind();
  }
  function closeFind() {
    if (!findBar) return;
    findBar.hidden = true;
    clearFindMarks();
    if (findCount) findCount.textContent = '';
  }
  function doFind() {
    clearFindMarks();
    if (!contentEl || !findInput) return;
    var q = findInput.value;
    if (findCount) findCount.textContent = '';
    if (!q) return;
    var needle = q.toLowerCase();
    // Collect the candidate text nodes first: mutating the DOM while the
    // TreeWalker is live can make it skip or loop forever.
    var targets = [];
    var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (p && p.className && /mdl-source-preview|mdl-find-hit/.test(String(p.className))) return NodeFilter.FILTER_REJECT;
        var tn = p && p.tagName ? p.tagName.toLowerCase() : '';
        if (tn === 'script' || tn === 'style' || tn === 'x-mermaid') return NodeFilter.FILTER_REJECT;
        return n.nodeValue.toLowerCase().indexOf(needle) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var node;
    while ((node = walker.nextNode())) targets.push(node);
    targets.forEach(function (node) {
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var pos = 0;
      while ((pos = lower.indexOf(needle, pos)) !== -1) {
        // split: node=[before], rest=[match][after]
        var rest = node.splitText(pos);
        var after = rest.splitText(needle.length);
        var mark = document.createElement('mark');
        mark.className = 'mdl-find-hit';
        mark.textContent = rest.nodeValue;
        node.parentNode.replaceChild(mark, rest);
        findHits.push(mark);
        // keep searching the remainder in the same text node
        node = after;
        lower = after.nodeValue.toLowerCase();
        pos = 0;
      }
    });
    if (findCount) findCount.textContent = findHits.length ? ('1/' + findHits.length) : '0/0';
    if (findHits.length) gotoHit(0);
  }
  function gotoHit(i) {
    if (!findHits.length) return;
    findIdx = ((i % findHits.length) + findHits.length) % findHits.length;
    findHits.forEach(function (h, k) { h.classList.toggle('mdl-find-hit--active', k === findIdx); });
    if (findCount) findCount.textContent = (findIdx + 1) + '/' + findHits.length;
    var h = findHits[findIdx];
    try { h.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { h.scrollIntoView(); }
  }
  if (findBar && findInput) {
    findInput.addEventListener('input', doFind);
    findInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); gotoHit(findIdx + 1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    var fp = document.getElementById('mdl-find-prev');
    var fn = document.getElementById('mdl-find-next');
    var fc = document.getElementById('mdl-find-close');
    if (fp) fp.addEventListener('click', function () { gotoHit(findIdx - 1); });
    if (fn) fn.addEventListener('click', function () { gotoHit(findIdx + 1); });
    if (fc) fc.addEventListener('click', closeFind);
  }

  // ---- custom keyboard shortcuts (Cmd/Ctrl+K panel) ------------------------
  // Default actions; a user override lives in config.json (shortcuts map) and
  // in localStorage 'mdl-shortcuts'. Format: { '<action>': 'mod+key' } where
  // mod = ctrl|cmd|alt and key is a single character or F1..F12.
  var SHORTCUT_DEFAULTS = {
    'toc': 'ctrl+t',
    'theme': 'ctrl+d',
    'find': 'ctrl+f',
    'wysiwyg': 'ctrl+shift+e',
    'mindmap': 'ctrl+shift+m',
    'dual': 'f3',
    'marp': 'f5',
    'editor': 'f2',
    'source': 'ctrl+e',
  };
  var SC_KEY = 'mdl-shortcuts';
  function shortcuts() {
    var user = {};
    try { user = JSON.parse(localStorage.getItem(SC_KEY) || '{}'); } catch (e) {}
    var cfg = (S.cfg && S.cfg.shortcuts) || {};
    return Object.assign({}, SHORTCUT_DEFAULTS, cfg, user);
  }
  // Parse 'ctrl+shift+f' / 'f5' into {ctrl, shift, alt, key}.
  function parseSc(sh) {
    var mods = { ctrl: false, shift: false, alt: false };
    var parts = String(sh || '').toLowerCase().split('+');
    var key = '';
    parts.forEach(function (p) {
      if (p === 'ctrl' || p === 'cmd') mods.ctrl = true;
      else if (p === 'shift') mods.shift = true;
      else if (p === 'alt') mods.alt = true;
      else key = p;
    });
    return { mods: mods, key: key };
  }
  function matchesSc(e, sh) {
    var p = parseSc(sh);
    if (!p.key) return false;
    var ok = p.key;
    if (p.key !== 'f1' && p.key !== 'f2' && p.key !== 'f3' && p.key !== 'f5' && p.key !== 'escape') {
      ok = (e.key || '').toLowerCase();
    } else {
      ok = (e.key || '').toLowerCase();
    }
    if (ok !== p.key) return false;
    if (p.mods.ctrl && !(e.ctrlKey || e.metaKey)) return false;
    if (p.mods.shift && !e.shiftKey) return false;
    if (p.mods.alt && !e.altKey) return false;
    if (!p.mods.ctrl && e.ctrlKey && !e.metaKey) return false;
    return true;
  }
  function runShortcutAction(a) {
    switch (a) {
      case 'toc': toggleToc(); break;
      case 'theme': cycleTheme(); break;
      case 'find': openFind(); break;
      case 'wysiwyg': if (W) W.enter(); break;
      case 'mindmap': mm.open ? closeMindmap() : openMindmap(); break;
      case 'dual': toggleDual(); break;
      case 'marp': if (marpState.slides && marpState.slides.length) enterMarp(); break;
      case 'editor': openEditor(); break;
      case 'source': if (editorOpen) closeSourceEditor(); else openSourceEditor(); break;
    }
  }
  // Cmd/Ctrl+K: show the shortcut panel listing every mapping.
  var scPanel = null;
  function buildScPanel() {
    if (scPanel) return scPanel;
    scPanel = document.createElement('div');
    scPanel.id = 'mdl-sc-panel';
    scPanel.className = 'mdl-sc-panel';
    scPanel.hidden = true;
    var map = shortcuts();
    Object.keys(map).forEach(function (action) {
      var row = document.createElement('div');
      row.className = 'mdl-sc-row';
      var lbl = document.createElement('span');
      lbl.className = 'mdl-sc-lbl';
      lbl.textContent = action;
      var val = document.createElement('span');
      val.className = 'mdl-sc-val';
      val.textContent = map[action];
      row.appendChild(lbl); row.appendChild(val);
      scPanel.appendChild(row);
    });
    var btns = document.createElement('div');
    btns.className = 'mdl-sc-btns';
    var reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'mdl-btn';
    reset.textContent = t('sc-reset', '恢复默认');
    reset.addEventListener('click', function () {
      try { localStorage.removeItem(SC_KEY); } catch (e) {}
      // also clear any config-level overrides the host persisted
      postConfig({ shortcuts: null });
      buildScPanel(true);
      toast(t('sc-reset-done', '已恢复默认快捷键'));
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'mdl-btn';
    close.textContent = t('sc-close', '关闭');
    close.addEventListener('click', function () { scPanel.hidden = true; });
    btns.appendChild(reset); btns.appendChild(close);
    scPanel.appendChild(btns);
    document.body.appendChild(scPanel);
    return scPanel;
  }
  buildScPanel();
  function openScPanel() { buildScPanel().hidden = false; }
  function closeScPanel() { if (scPanel) scPanel.hidden = true; }
  function bindShortcutKeys() {
    var map = shortcuts();
    Object.keys(map).forEach(function (action) {
      var sh = map[action];
      var p = parseSc(sh);
      if (!p.key) return;
      var ev = p.key.charAt(0) === 'f' && p.key.length === 2 ? 'keydown' : 'keydown';
      document.addEventListener('mdl-sc-' + action, function () { runShortcutAction(action); });
    });
  }
  document.addEventListener('keydown', function (e) {
    // Custom shortcut layer (cmd/ctrl+k opens the panel; other bound combos
    // dispatch to the actions they were remapped to). Marp presentation still
    // takes priority over everything while active.
    var scMap = shortcuts();
    var foundAction = null;
    Object.keys(scMap).forEach(function (a) {
      if (!foundAction && matchesSc(e, scMap[a])) foundAction = a;
    });
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      scPanel ? (scPanel.hidden ? openScPanel() : closeScPanel()) : null;
      return;
    }
    if (marpState.active) {
      if (e.key === 'F5' || e.key === 'Escape') { e.preventDefault(); exitMarp(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextMarpSlide(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); prevMarpSlide(); }
      return;
    }
    if (foundAction) {
      e.preventDefault();
      runShortcutAction(foundAction);
      return;
    }
    if (W && W.isActive()) {
      if (e.key === 'Escape') { e.preventDefault(); W.exit(false); }
      else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); W.save(); }
      return; // let the editor handle everything else (undo/redo/bold/...)
    }
    if (editorOpen && e.key === 'Escape') { e.preventDefault(); closeSourceEditor(); return; }
    else if (e.key === 'Escape') {
      var aPop = document.getElementById('mdl-appear-pop');
      if (aPop && !aPop.hidden) { e.preventDefault(); aPop.hidden = true; return; }
      if (mm.open) { e.preventDefault(); closeMindmap(); }
      else if (findBar && !findBar.hidden) { e.preventDefault(); closeFind(); }
      else if (!tocEl.classList.contains('is-hidden')) toggleToc();
    }
    else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    else if (e.key === 'F3') { e.preventDefault(); toggleDual(); }
    else if (e.key === 'F5') { e.preventDefault(); if (marpState.slides && marpState.slides.length) enterMarp(); }
    else if (e.key === 'F2') { e.preventDefault(); openEditor(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); toggleToc(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); cycleTheme(); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); if (W) { W.enter(); } }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); mm.open ? closeMindmap() : openMindmap(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); if (editorOpen) closeSourceEditor(); else openSourceEditor(); }
    else if (editorOpen && e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveSource(); }
    else if (e.key === 'Escape') { if (!tocEl.classList.contains('is-hidden')) toggleToc(); }
  });
  function toggleToc() {
    tocEl.classList.toggle('is-hidden');
    try { localStorage.setItem('mdl-toc-hidden', tocEl.classList.contains('is-hidden') ? '1' : ''); } catch (e) {}
  }
  function refreshMermaidTheme() {
    // mermaid bakes colors into the SVG, so re-render with the new theme
    if (mermaidState.loaded && mermaidState.rendered) {
      mermaidState.loaded.setConfig({ theme: mermaidTheme() });
      var nodes = contentEl.querySelectorAll('x-mermaid[data-mm-state="ok"]');
      for (var i = 0; i < nodes.length; i++) {
        var src = nodes[i].getAttribute('data-mm-src');
        if (src != null) {
          nodes[i].innerHTML = '<pre class="mdl-mermaid-src"><code></code></pre>';
          nodes[i].querySelector('code').textContent = src;
        }
      }
      renderMermaid();
    }
  }
  function cycleTheme() {
    themeIdx = (themeIdx + 1) % THEMES.length;
    applyTheme();
    postConfig({ theme: THEMES[themeIdx] }); // persist like a skin click, else it reverts on reload
    toast(t('theme-toast','主题') + ': ' + THEMES[themeIdx]);
    refreshMermaidTheme();
  }
  if ((function () { try { return localStorage.getItem('mdl-toc-hidden') === '1'; } catch (e) { return false; } })()) {
    tocEl.classList.add('is-hidden');
  }

  // Wire the toolbar buttons. The keyboard shortcuts alone are not discoverable,
  // and clicking the visible button must work like pressing the shortcut.
  var tocBtn = document.getElementById('mdl-btn-toc');
  if (tocBtn) tocBtn.addEventListener('click', function () { toggleToc(); });
  var themeBtn = document.getElementById('mdl-btn-theme');
  if (themeBtn) themeBtn.addEventListener('click', function () { cycleTheme(); });

  // ---- appearance popover + font size (🎨 / A- / A+) --------------------------
  var appearBtn = document.getElementById('mdl-btn-appear');
  if (appearBtn) appearBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleAppearPop(); });
  var sizeMinus = document.getElementById('mdl-btn-smaller') || document.getElementById('mdl-size-minus');
  var sizePlus = document.getElementById('mdl-btn-larger') || document.getElementById('mdl-size-plus');
  if (sizeMinus) sizeMinus.addEventListener('click', function () { setFontSize(currentFontSize() - 1); });
  if (sizePlus) sizePlus.addEventListener('click', function () { setFontSize(currentFontSize() + 1); });
  if (document.addEventListener) {
    document.addEventListener('click', function (e) {
      var pop = document.getElementById('mdl-appear-pop');
      if (!pop || pop.hidden) return;
      if (pop.contains(e.target) || (appearBtn && appearBtn.contains(e.target))) return;
      pop.hidden = true;
    });
  }

  // ---- right-click context menu ----------------------------------------------
  // A reading-first tool buries its actions in the top row of buttons; a right
  // click surfaces the appearance panel (skin / font / size) plus every action,
  // so nothing needs hunting and no keyboard shortcut must be memorized.
  var ctxMenu = document.getElementById('mdl-ctx');
  var ctxAppearOpen = false;
  function ctxClose() { if (ctxMenu) ctxMenu.hidden = true; }
  function ctxOpen(x, y) {
    if (!ctxMenu) return;
    buildCtxMenu();
    ctxMenu.hidden = false;
    // clamp so the menu never hangs off the window edge
    var w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    var nx = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8));
    var ny = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8));
    ctxMenu.style.left = nx + 'px';
    ctxMenu.style.top = ny + 'px';
  }
  function ctxItem(ico, label, keyHint, fn, disabled) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mdl-ctx-item';
    if (disabled) b.disabled = true;
    b.innerHTML = '<span class="mdl-ctx-ico">' + ico + '</span><span>' + label + '</span>' +
      (keyHint ? '<span class="mdl-ctx-key">' + keyHint + '</span>' : '');
    b.addEventListener('click', function () { ctxClose(); if (!disabled && fn) fn(); });
    return b;
  }
  function ctxSep() { var s = document.createElement('div'); s.className = 'mdl-ctx-sep'; return s; }
  function ctxSizeRefresh() {
    var v = document.getElementById('mdl-ctx-size-val');
    if (v) v.textContent = currentFontSize() + 'px';
  }
  function buildCtxMenu() {
    ctxMenu.innerHTML = '';
    ctxAppearOpen = false; // fresh panel starts collapsed; a stale true flag would swallow the next 🎨 click
    var live = document.body.hasAttribute('data-live');
    var webview = !!(window.chrome && window.chrome.webview);

    // 外观：expand inline so skin / font / size live inside the menu itself
    var appear = document.createElement('button');
    appear.type = 'button';
    appear.className = 'mdl-ctx-item';
    appear.innerHTML = '<span class="mdl-ctx-ico">🎨</span><span>' +
      t('appearance', '外观（皮肤 / 字体 / 字号）') + '</span><span class="mdl-ctx-arrow">▸</span>';
    ctxMenu.appendChild(appear);
    var panel = document.createElement('div');
    panel.className = 'mdl-ctx-sub';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="mdl-pop-label">' + t('skin', '皮肤模式') + '</div>' +
      '<div class="mdl-skin-grid" id="mdl-ctx-skin-grid"></div>' +
      '<div class="mdl-pop-label">' + t('font-family', '正文字体') + '</div>' +
      '<select class="mdl-font-select" id="mdl-ctx-font-select"></select>' +
      '<div class="mdl-pop-label">' + t('font-size', '正文字号') + '</div>' +
      '<div class="mdl-size-row">' +
        '<button class="mdl-size-btn" id="mdl-ctx-size-minus">A-</button>' +
        '<span class="mdl-size-val" id="mdl-ctx-size-val"></span>' +
        '<button class="mdl-size-btn" id="mdl-ctx-size-plus">A+</button>' +
      '</div>';
    ctxMenu.appendChild(panel);
    appear.addEventListener('click', function () {
      ctxAppearOpen = !ctxAppearOpen;
      panel.hidden = !ctxAppearOpen;
      if (ctxAppearOpen) {
        renderSkinGrid(document.getElementById('mdl-ctx-skin-grid'));
        renderFontSelect(document.getElementById('mdl-ctx-font-select'));
        ctxSizeRefresh();
      }
    });
    (function () {
      var mn = document.getElementById('mdl-ctx-size-minus');
      var pl = document.getElementById('mdl-ctx-size-plus');
      if (mn) mn.addEventListener('click', function () { setFontSize(currentFontSize() - 1); ctxSizeRefresh(); });
      if (pl) pl.addEventListener('click', function () { setFontSize(currentFontSize() + 1); ctxSizeRefresh(); });
    })();

    ctxMenu.appendChild(ctxSep());
    ctxMenu.appendChild(ctxItem('◐', t('theme', '主题'), 'Ctrl+D', function () { cycleTheme(); }));
    ctxMenu.appendChild(ctxItem('☰', t('toc', '目录'), 'Ctrl+T', function () { toggleToc(); }));
    ctxMenu.appendChild(ctxItem('🔍', t('ctx-find', '在页面中查找'), 'Ctrl+F', function () { openFind(); }));
    ctxMenu.appendChild(ctxSep());
    ctxMenu.appendChild(ctxItem('▥', t('dual', '双栏分屏'), 'F3', function () { toggleDual(); }));
    ctxMenu.appendChild(ctxItem('🧠', t('mindmap', '大纲脑图'), 'Ctrl+Shift+M', function () { if (mm.open) closeMindmap(); else openMindmap(); }));
    ctxMenu.appendChild(ctxItem('⟨/⟩', t('view-source', '源码视图'), 'Ctrl+E', function () { if (editorOpen) closeSourceEditor(); else openSourceEditor(); }));
    ctxMenu.appendChild(ctxItem('✍', t('wysiwyg', '直接编辑'), 'Ctrl+Shift+E', function () { if (W) W.enter(); }, !W));
    ctxMenu.appendChild(ctxItem('✎', t('external-editor', '外部编辑器'), 'F2', function () { openEditor(); }, !live));
    ctxMenu.appendChild(ctxSep());
    ctxMenu.appendChild(ctxItem('⎙', t('print', '打印'), 'Ctrl+P', function () { window.print(); }));
    ctxMenu.appendChild(ctxItem('📊', t('export-csv', '导出表格为 CSV'), '', function () { exportCsv(); }));
    ctxMenu.appendChild(ctxItem('TeX', t('export-tex', '导出为 LaTeX (.tex)'), '', function () { exportLatex(); }));
    ctxMenu.appendChild(ctxItem('📄', t('export-pdf', '导出为 PDF'), '', function () {
      if (webview) window.chrome.webview.postMessage('export:pdf');
      else toast(t('pdf-window-only', 'PDF 导出需窗口模式'));
    }, !webview));
    ctxMenu.appendChild(ctxSep());
    ctxMenu.appendChild(ctxItem('⚙', t('settings', '设置'), '', function () {
      var b = document.getElementById('mdl-btn-settings'); if (b) b.click();
    }, !live));
    ctxMenu.appendChild(ctxItem('🌐', '中文 / English', '', function () {
      var b = document.getElementById('mdl-btn-lang'); if (b) b.click();
    }));
  }

  document.addEventListener('contextmenu', function (e) {
    var t = e.target;
    // keep the native menu where editing/input lives — users need paste and
    // spellcheck there, and a custom menu would block them
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable], .mdl-editor, .mdl-mindmap, .mdl-wysiwyg-bar')) return;
    e.preventDefault();
    ctxOpen(e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', function (e) {
    if (e.button === 2) return; // the contextmenu event owns the right button
    if (ctxMenu && !ctxMenu.hidden && !ctxMenu.contains(e.target)) ctxClose();
  });
  window.addEventListener('scroll', ctxClose, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ctxMenu && !ctxMenu.hidden) { e.preventDefault(); ctxClose(); }
  });
  if (typeof window !== 'undefined') window.__mdlCtxOpen = ctxOpen;
  // seed the font-size readout and re-apply the saved font family (config fetch
  // lands later and calls applyConfig, which sets the same CSS variables)
  (function () {
    try {
      // localStorage fallback: the Node server has no /api/config, so without
      // this a font size picked with A-/A+ is forgotten on every reload
      var fs = parseFloat(localStorage.getItem('mdl-font-size'));
      if (fs && !isNaN(fs)) {
        fs = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(fs * 10) / 10));
        document.documentElement.style.setProperty('--mdl-font-size', fs + 'px');
      }
    } catch (e) {}
    var v = document.getElementById('mdl-size-val');
    if (v) v.textContent = currentFontSize() + 'px';
    try {
      var ff = localStorage.getItem('mdl-font');
      if (ff) document.documentElement.style.setProperty('--mdl-font', ff + ', "Segoe UI", "Microsoft YaHei", sans-serif');
    } catch (e) {}
    renderSkinGrid();
    renderFontSelect();
  })();

  // ---- direct editing (WYSIWYG) --------------------------------------------
  var W = (typeof window !== 'undefined' && window.MDLWysiwyg) || null;
  var wysiwygBar = document.getElementById('mdl-wysiwyg-bar');
  if (W && wysiwygBar) {
    W.init({ contentEl: contentEl, toolbarEl: wysiwygBar, onReload: function () { liveReload(); }, onCancel: function () { liveReload(true); } });
    var wysBtn = document.getElementById('mdl-btn-wysiwyg');
    if (wysBtn) wysBtn.addEventListener('click', function () {
      if (W.isActive()) W.exit(false); else W.enter();
    });
  }

  // ---- 🖼 upload an image into the document's folder (parity feature) ----------
  // The editor's upload button pops a file dialog; each image is POSTed raw to
  // the host, which writes it to <docdir>/assets and hands back the relative
  // path. We then insert ![](assets/X.png) at the cursor.
  var uploadBtn = document.getElementById('mdl-btn-upload');
  var fileInput = document.getElementById('mdl-file-input');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (fileInput.value) fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;
      files.forEach(function (f) {
        var reader = new FileReader();
        reader.onload = function () {
          var buf = new Uint8Array(reader.result);
          fetch('/api/upload-asset?name=' + encodeURIComponent(f.name), { method: 'POST', body: buf })
            .then(function (r) { return r.json(); })
            .then(function (j) {
              if (!j || !j.ok) { toast(t('upload-failed', '上传失败')); return; }
              var stem = f.name.replace(/\.[^.]+$/, '');
              var md = '![' + stem + '](' + j.path + ')';
              try {
                // the file name is user input: escape it before it goes into
                // HTML, otherwise a name containing `"` breaks out of the
                // attribute (a downloaded file can be named that way)
                var esc = function (s) {
                  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
                };
                document.execCommand('insertHTML', false,
                  '<img src="' + esc(j.path) + '" alt="' + esc(stem) + '">');
                // also drop the markdown syntax into the source editor if it's open
                var srcEl = document.getElementById('mdl-source');
                if (srcEl && !srcEl.closest('[hidden]')) {
                  srcEl.value = (srcEl.value ? srcEl.value + '\n' : '') + md;
                }
              } catch (err) { toast(t('upload-failed', '插入失败')); }
              toast(t('upload-ok', '已上传 ') + j.path);
            })
            .catch(function () { toast(t('no-service', '无法联系 mdlight 服务')); });
        };
        reader.readAsArrayBuffer(f);
      });
    });
  }

  // ---- in-body heading fold (parity feature) ------------------------------------
  // Clicking an h1-h3 folds everything after it up to the next heading of the
  // same-or-higher level. Live reload rebuilds the DOM so folding is re-applied
  // only after the render; a reload clears it (kept simple on purpose).
  function wireCollapse() {
    contentEl.querySelectorAll('h1, h2, h3').forEach(function (h) {
      if (h.dataset.mdlCollapse === '1') return;
      h.dataset.mdlCollapse = '1';
      var level = Number(h.tagName[1]);
      h.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('a, button, input')) return;
        var folded = h.classList.toggle('mdl-folded');
        var n = h.nextElementSibling;
        while (n) {
          var tn = n.tagName || '';
          if (/^H[1-6]$/.test(tn) && Number(tn[1]) <= level) break;
          n.style.display = folded ? 'none' : '';
          n = n.nextElementSibling;
        }
      });
    });
  }

  function wireCodeLineno() {
    if (!document.body.classList.contains('mdl-code-lineno')) return;
    contentEl.querySelectorAll('pre code').forEach(function (code) {
      if (code.dataset.mdlLineno === '1') return;
      code.dataset.mdlLineno = '1';
      var text = code.textContent;
      if (text.indexOf('\n') === -1) return;
      // Split into one <span class="line"> per source line. The CSS gutter uses
      // counters, so no numbering has to be kept in sync here. The highlight
      // spans are flattened to plain text by textContent; line numbers and
      // highlighting are mutually exclusive, which is fine for the toggle.
      code.textContent = '';
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (i > 0) code.appendChild(document.createTextNode('\n'));
        var s = document.createElement('span');
        s.className = 'line';
        s.textContent = lines[i];
        code.appendChild(s);
      }
    });
  }

  function wireTableFullscreen() {
    contentEl.querySelectorAll('table').forEach(function (tbl) {
      if (tbl.dataset.mdlFs === '1') return;
      tbl.dataset.mdlFs = '1';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mdl-tbl-fs';
      btn.textContent = '⛶';
      btn.title = t('table-fullscreen','表格全屏');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var on = tbl.classList.toggle('mdl-tbl-fs-on');
        btn.textContent = on ? '✕' : '⛶';
        if (on) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
      });
      tbl.appendChild(btn);
    });
  }

  function posKey() {
    return 'mdl-pos-' + (S.filepath || window.location.pathname);
  }
  // Cross-session read position (parity feature: LibraryData.positions). Saves a
  // ratio on scroll / unload, restores it after the document is rendered.
  function savePos() {
    if (document.body.dataset.noRemember === '1') return;
    var h = document.body.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    try { localStorage.setItem(posKey(), String(window.scrollY / h)); } catch (e) {}
  }
  function restorePos() {
    if (document.body.dataset.noRemember === '1') return;
    try {
      var v = Number(localStorage.getItem(posKey()));
      if (!isFinite(v) || v < 0 || v > 1) return;
      window.scrollTo(0, v * (document.body.scrollHeight - window.innerHeight));
    } catch (e) {}
  }
  function preserveScroll(fn) {
    // remember the anchor nearest the viewport top, then restore after reload
    var lines = contentEl.querySelectorAll('[data-mdl-line]');
    var refEl = null, refTop = 0;
    lines.forEach(function (el) {
      var top = el.getBoundingClientRect().top;
      if (top >= -60 && (!refEl || top < refTop)) { refEl = el; refTop = top; }
    });
    var scrollRatio = window.scrollY / Math.max(1, document.body.scrollHeight);
    fn(function () {
      if (refEl && refEl.id && document.getElementById(refEl.id)) {
        document.getElementById(refEl.id).scrollIntoView({ block: 'start' });
      } else {
        window.scrollTo(0, scrollRatio * document.body.scrollHeight);
      }
    });
  }
  function liveReload(silent) {
    preserveScroll(function (restore) {
      if (S.clientRender) {
        clientRender().then(function () {
          buildToc(); wireTocActive(); wireCollapse(); wireCodeLineno(); wireTableFullscreen();
          renderStat();
          renderMermaid();
          restore();
          if (!silent) toast(t('reloaded','已重载'));
        }).catch(function () { if (!silent) toast(t('reload-failed','重载失败')); });
        return;
      }
      fetch(location.href, { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var fresh = doc.getElementById('mdl-content');
          var cfgEl = doc.getElementById('mdl-cfg');
          if (cfgEl) {
            try {
              var cfg = JSON.parse(cfgEl.textContent
                .replace(/^\s*window\.__MDL__\s*=\s*/, '')
                .replace(/;\s*$/, ''));
              S.toc = cfg.toc; S.eqCount = cfg.eqCount; S.errCount = cfg.errCount;
              S.mermaidCount = cfg.mermaidCount;
            } catch (e) {}
          }
          if (fresh) contentEl.innerHTML = fresh.innerHTML;
          buildToc(); wireTocActive(); wireCollapse(); wireCodeLineno(); wireTableFullscreen();
          renderStat();
          renderMermaid();
          restore();
          if (!silent) toast(t('reloaded','已重载'));
        })
        .catch(function () { if (!silent) toast(t('reload-failed','重载失败')); });
    });
  }

  if (document.body.hasAttribute('data-live')) {
    if ('EventSource' in window) {
      var es = new EventSource('/events');
      es.addEventListener('message', function (ev) {
        if (ev.data !== 'reload') return;
        // Never clobber in-progress edits: a WYSIWYG session is a live DOM
        // that this reload would replace, and an open source panel holds
        // unsaved textarea content. Refreshing the preview behind them is
        // fine (the disk copy is authoritative), but overwriting the editor
        // loses the user's work silently.
        if ((W && W.isActive()) || editorOpen) { toast(t('dirty','文件已变更，编辑内容未覆盖')); return; }
        liveReload();
      });
      es.onerror = function () { /* auto-reconnect; server may be restarting */ };
    }
  }

  // ---- client-side rendering (native host only) --------------------------------
  // The C# host embeds no Node runtime, so it cannot render on the server. It
  // ships the browser build of core/renderer.mjs as a classic script
  // (window.MDLRenderer) and lets the page render — same markdown-it + KaTeX +
  // highlight.js pipeline, identical output. A classic script rather than a
  // module is deliberate: exported single files are opened from file://, where
  // ES module imports are blocked by CORS.
  //
  // Two sources are supported:
  //   live native host -> GET /api/doc returns the markdown text
  //   exported file    -> window.__MDL_SRC__ already holds it inline
  function clientRender() {
    var ready;
    if (window.__MDL_SRC__ !== undefined) {
      ready = Promise.resolve(window.__MDL_SRC__);
    } else {
      ready = fetch('/api/doc', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.path) S.filepath = j.path;
          return (j && j.source) || '';
        });
    }
    return ready.then(function (source) {
      var mod = window.MDLRenderer;
      if (!mod) throw new Error(t('renderer-missing','渲染器未加载'));
      // 渐进渲染：先把 markdown 原文放进 <pre>，让浏览器 paint 一帧，用户
      // 立刻看到文档已加载（而不是白屏以为卡死）；随后再跑完整的
      // markdown-it + KaTeX + highlight.js 管线替换成渲染 HTML。
      // 这是为 native 端服务的——C# 宿主无 Node，只能在浏览器里渲染，
      // 几千个公式会同步阻塞主线程数秒；没有这层占位，>1MB 的文档打开
      // 期间用户看到的是一整块空白。
      var placeholder = document.createElement('pre');
      placeholder.className = 'mdl-source-preview';
      placeholder.textContent = source;
      contentEl.innerHTML = '';
      contentEl.appendChild(placeholder);
      return new Promise(function (resolve) { setTimeout(resolve, 0); }).then(function () {
        // 优先在 Web Worker 里渲染：KaTeX / hljs / markdown-it 全是纯字符串
        // 工作，不碰 DOM，所以能在后台线程跑，主线程保持可滚动、可交互。
        // 只在 live（native host 或 Node 服务器）下尝试 Worker；导出的单
        // 文件从 file:// 打开，Worker 受 CORS 限制，直接走同步渲染。
        var useWorker = document.body.hasAttribute('data-live');
        return (useWorker ? renderInWorker(source) : syncRender(source)).then(function (out) {
          // post=true: wire TOC/stats/mermaid/collapse right after the paint
          // so the native host (empty server body) gets a fully-wired DOM.
          paintContent(out, true);
        });
      });
    });
  }

  // Shared by clientRender and the F3 dual-view live preview: paint a render
  // result into the content area and refresh the derived counters / TOC.
  function paintContent(out, post) {
    contentEl.innerHTML = out.html;
    S.toc = out.headings || [];
    S.mermaidCount = out.mermaidCount || 0;
    // Same counting rules as the Node server (mdlight.mjs:310-311)
    S.eqCount = contentEl.querySelectorAll('x-equation').length;
    S.errCount = contentEl.querySelectorAll('.mdl-math-error').length;
    // clientRender leaves these to init() so mermaid is not rendered twice
    // (a second render yields a different SVG); the dual-view live preview
    // paints into an already-initialised page, so it must re-run them.
    if (post) { buildToc(); renderStat(); renderMermaid(); wireCollapse(); wireCodeLineno(); wireTableFullscreen(); wireTocActive(); wireEquationCopy(); }
    maybeWrapVBlocks();
    // UI polish: friendly placeholder for an empty doc + scroll-to-top button
    ensureEmptyState(contentEl, out.html || '');
    wireTotop();
    // Marp deck? The renderer returns slides when the doc declared marp: true.
    if (out && out.marp && out.slides && out.slides.length) {
      marpState.slides = out.slides;
      marpState.marp = out.marp;
      setupMarp();
    } else {
      marpState.slides = null;
      marpState.marp = null;
    }
  }

  // One cached Worker reused across live-reloads; a request id tags each reply
  // so a stale response (e.g. the document changed mid-render) is dropped.
  var workerCache = null;
  var workerSeq = 0;
  var workerCallbacks = {};
  var workerBlob = null;
  function wireWorker(w) {
    w.onmessage = function (e) {
      var cid = e.data && e.data.id;
      var cb = workerCallbacks[cid];
      if (cb) { delete workerCallbacks[cid]; cb(e.data); }
    };
    w.onerror = function () {
      var ids = Object.keys(workerCallbacks);
      workerCallbacks = {};
      ids.forEach(function (id) { cbSync(id); });
      try { w.terminate(); } catch (e2) {}
      workerCache = null;
      if (workerBlob) { URL.revokeObjectURL(workerBlob); workerBlob = null; }
    };
    workerCache = w;
  }
  function getWorker() {
    if (workerCache) return workerCache;
    // Load the worker via fetch + Blob so it works on both the Node host
    // (which serves /assets/renderer-worker.js) and the native host without
    // any cross-origin restrictions.
    if (workerBlob) {
      var w = new Worker(workerBlob, { type: 'classic' });
      wireWorker(w);
      return w;
    }
    fetch('/assets/renderer-worker.js', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        workerBlob = URL.createObjectURL(new Blob([txt], { type: 'application/javascript' }));
        var w = new Worker(workerBlob, { type: 'classic' });
        wireWorker(w);
        workerCache = w;
      })
      .catch(function () {
        // fall back to sync render for all pending + future requests
        var ids = Object.keys(workerCallbacks);
        ids.forEach(function (id) { cbSync(id); });
      });
    return null;
  }
  function cbSync(id) {
    var cb = workerCallbacks[id];
    if (!cb) return;
    delete workerCallbacks[id];
    cb(null); // null 表示走同步回退
  }
  function renderInWorker(source) {
    if (typeof Worker === 'undefined') return syncRender(source);
    var id;
    return new Promise(function (resolve, reject) {
      var w = getWorker();
      id = ++workerSeq;
      var timer = setTimeout(function () { // 超时回退，防 Worker 卡死
        cbSync(id);
      }, 60000);
      workerCallbacks[id] = function (data) {
        clearTimeout(timer);
        if (!data) { resolve(syncRender(source)); return; }
        if (data.ok) resolve({ html: data.html, headings: data.headings, mermaidCount: data.mermaidCount, marp: data.marp, slides: data.slides });
        else resolve(syncRender(source));
      };
      try {
        w.postMessage({ id: id, source: source, hardBreaks: !!(S.cfg && S.cfg.hardBreaks) });
      } catch (err) {
        clearTimeout(timer);
        cbSync(id);
      }
    });
  }
  function syncRender(source) {
    var out = window.MDLRenderer.render(String(source || ''), { hardBreaks: !!(S.cfg && S.cfg.hardBreaks) });
    return Promise.resolve({ html: out.html, headings: out.headings || [], mermaidCount: out.mermaidCount || 0, marp: out.marp || null, slides: out.slides || null });
  }

  // ---- Marp / PPT presentation mode ------------------------------------------
  // When a document declares `marp: true` in YAML frontmatter, the renderer
  // returns per-slide HTML (`out.slides`) plus deck config (`out.marp`). We then
  // show a full-screen overlay paged with F5 / arrows / space — the same UX
  // SuperGoodViewer and Marp offer. Header/footer support the Marp macros
  // {title} {page} {total} {date}.
  var marpState = { active: false, slides: null, marp: null, idx: 0, timer: null, timerStart: 0, notified: false };
  var marpOverlay = null, marpSlideEl = null, marpHudEl = null;
  var marpPageEl = null, marpTimerEl = null, marpHeaderEl = null, marpFooterEl = null;

  function marpRatio(size) {
    var m = String(size || '16:9').toLowerCase().replace(/\s+/g, '');
    if (m === 'a4' || m === 'a4-landscape') return { w: 297, h: 210 };
    if (m === 'a4-portrait') return { w: 210, h: 297 };
    var parts = String(m).split(':');
    var w = parseFloat(parts[0]), h = parseFloat(parts[1]);
    if (!w || !h) return { w: 16, h: 9 };
    return { w: w, h: h };
  }

  function marpMacro(str, idx, total, title) {
    if (!str) return '';
    return String(str)
      .replace(/\{title\}/g, title || '')
      .replace(/\{page\}/g, String(idx + 1))
      .replace(/\{total\}/g, String(total))
      .replace(/\{date\}/g, new Date().toLocaleDateString());
  }

  function buildMarpOverlay() {
    marpOverlay = document.createElement('div');
    marpOverlay.id = 'mdl-marp-overlay';
    marpOverlay.hidden = true;
    marpOverlay.tabIndex = -1;
    var stage = document.createElement('div');
    stage.id = 'mdl-marp-stage';
    marpSlideEl = document.createElement('div');
    marpSlideEl.id = 'mdl-marp-slide';
    stage.appendChild(marpSlideEl);
    marpOverlay.appendChild(stage);
    var hud = document.createElement('div');
    hud.id = 'mdl-marp-hud';
    marpHeaderEl = document.createElement('div');
    marpHeaderEl.id = 'mdl-marp-hud-header';
    marpHeaderEl.className = 'mdl-marp-hud-slot mdl-marp-hud--header';
    marpFooterEl = document.createElement('div');
    marpFooterEl.id = 'mdl-marp-hud-footer';
    marpFooterEl.className = 'mdl-marp-hud-slot mdl-marp-hud--footer';
    marpPageEl = document.createElement('div');
    marpPageEl.id = 'mdl-marp-hud-page';
    marpPageEl.className = 'mdl-marp-hud-page';
    marpTimerEl = document.createElement('div');
    marpTimerEl.id = 'mdl-marp-hud-timer';
    marpTimerEl.className = 'mdl-marp-hud-timer';
    hud.appendChild(marpHeaderEl);
    hud.appendChild(marpFooterEl);
    hud.appendChild(marpPageEl);
    hud.appendChild(marpTimerEl);
    marpOverlay.appendChild(hud);
    document.body.appendChild(marpOverlay);
    // Click anywhere advances (common in presenter tools)
    marpOverlay.addEventListener('click', nextMarpSlide);
    marpOverlay.addEventListener('dblclick', function (e) { e.stopPropagation(); exitMarp(); });
  }

  function renderMarpSlide() {
    if (!marpState.slides || !marpState.slides.length) return;
    var marp = marpState.marp || {};
    var html = marpState.slides[marpState.idx] || '';
    marpSlideEl.innerHTML = html;
    marpSlideEl.className = 'mdl-slide--' + String(marp.size || '16:9').replace(/\s+/g, '-').toLowerCase();
    marpPageEl.textContent = (marpState.idx + 1) + ' / ' + marpState.slides.length;
    marpHeaderEl.textContent = marpMacro(marp.header, marpState.idx, marpState.slides.length, marpState.title);
    marpFooterEl.textContent = marpMacro(marp.footer, marpState.idx, marpState.slides.length, marpState.title);
    // Render mermaid inside the visible slide (lazy, only the active page)
    if (typeof renderMermaid === 'function') renderMermaid();
  }

  function enterMarp() {
    if (!marpState.slides || !marpState.slides.length) return;
    if (!marpOverlay) buildMarpOverlay();
    marpState.active = true;
    marpState.idx = 0;
    marpOverlay.hidden = false;
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen(); } catch (e) { /* fullscreen may be denied */ }
    renderMarpSlide();
    startMarpTimer();
  }

  function exitMarp() {
    marpState.active = false;
    if (marpOverlay) marpOverlay.hidden = true;
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* ignore */ }
    stopMarpTimer();
  }

  function nextMarpSlide() {
    if (!marpState.active) return;
    if (marpState.idx < marpState.slides.length - 1) { marpState.idx++; renderMarpSlide(); }
  }
  function prevMarpSlide() {
    if (!marpState.active) return;
    if (marpState.idx > 0) { marpState.idx--; renderMarpSlide(); }
  }
  function startMarpTimer() {
    marpState.timerStart = Date.now();
    clearInterval(marpState.timer);
    marpState.timer = setInterval(function () {
      if (!marpState.active || !marpTimerEl) return;
      var s = Math.floor((Date.now() - marpState.timerStart) / 1000);
      var m = Math.floor(s / 60);
      marpTimerEl.textContent = m + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
  }
  function stopMarpTimer() {
    clearInterval(marpState.timer);
    marpState.timer = null;
    if (marpTimerEl) marpTimerEl.textContent = '';
  }

  function setupMarp() {
    if (!marpState.notified) {
      marpState.notified = true;
      toast(tf('marp-ready', '检测到 Marp 幻灯片（{n} 页），按 F5 放映', { n: String(marpState.slides.length) }));
    }
    var btn = document.getElementById('mdl-btn-marp');
    if (btn) btn.hidden = false;
  }

  // ---- drag-and-drop file open --------------------------------------------------
  function wireDragDrop() {
    var dragDepth = 0;
    document.addEventListener('dragenter', function (e) {
      e.preventDefault(); dragDepth++; document.body.classList.add('mdl-drag-over');
    });
    document.addEventListener('dragleave', function () {
      dragDepth--; if (dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('mdl-drag-over'); }
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('mdl-drag-over');
      var files = e.dataTransfer ? e.dataTransfer.files : null;
      if (!files || !files.length) return;
      var f = files[0];
      if (!/\.md$|\.markdown$/i.test(f.name)) {
        toast(t('dd-not-md', '仅支持 .md / .markdown 文件'));
        return;
      }
      var isNative = !!(window.chrome && window.chrome.webview);
      var reader = new FileReader();
      reader.onload = function () {
        var text = reader.result;
        if (isNative) {
          // POST the dropped file's name + content to /api/open-file so the
          // C# server swaps its Doc and re-navigates WebView2.
          fetch('/api/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: f.name, content: text })
          }).then(function (r) { return r.json(); })
            .then(function (j) {
              if (j && j.ok) location.reload();
              else toast(t('dd-open-failed', '无法打开文件：') + (j && j.error ? j.error : f.name));
            })
            .catch(function () { toast(t('dd-open-failed', '无法打开文件：') + f.name); });
        } else {
          toast(t('dd-opened-static', '已打开（静态模式，不保存）：') + f.name);
        }
      };
      reader.onerror = function () { toast(t('dd-open-failed', '无法打开文件：') + f.name); };
      reader.readAsText(f);
    });
  }
  wireDragDrop();

  // ---- multi-document tab manager --------------------------------------------------
  // A lightweight tab strip under the top bar. Each tab remembers its scroll
  // position; switching tabs swaps the doc via /api/open-file (native) or
  // re-renders from the saved source (static). Stored in localStorage.
  var TABS_KEY = 'mdl-tabs-v1';
  var openTabs = loadTabs();

  function loadTabs() {
    try {
      var raw = localStorage.getItem(TABS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveTabs() {
    try { localStorage.setItem(TABS_KEY, JSON.stringify(openTabs)); } catch (e) { }
  }
  function getActiveTab() {
    for (var i = 0; i < openTabs.length; i++)
      if (openTabs[i].active) return openTabs[i];
    return openTabs[0] || null;
  }
  function tabPath(t) { return t.path || t.name || ''; }
  function renderTabStrip() {
    var bar = document.getElementById('mdl-tab-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mdl-tab-bar';
      bar.className = 'mdl-tab-bar';
      var titleRow = document.getElementById('mdl-title-row');
      if (titleRow) titleRow.parentNode.insertBefore(bar, titleRow.nextSibling);
      else document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.innerHTML = '';
    for (var i = 0; i < openTabs.length; i++) {
      (function (tab, idx) {
        var el = document.createElement('div');
        el.className = 'mdl-tab' + (tab.active ? ' mdl-tab-active' : '');
        el.title = tabPath(tab);
        var label = document.createElement('span');
        label.textContent = tab.name || (tabPath(tab).split('/').pop() || tab.name || 'untitled');
        el.appendChild(label);
        var close = document.createElement('span');
        close.className = 'mdl-tab-close';
        close.textContent = '\u00d7';
        close.title = t('tab-close', '关闭');
        close.addEventListener('click', function (e) {
          e.stopPropagation();
          closeTab(idx);
        });
        el.addEventListener('click', function () { switchTab(idx); });
        bar.appendChild(el);
      })(openTabs[i], i);
    }
  }
  function switchTab(idx) {
    var target = openTabs[idx];
    if (!target) return;
    // Save current scroll position before leaving
    var cur = getActiveTab();
    if (cur) {
      var _h = document.body.scrollHeight - window.innerHeight;
      cur.pos = _h > 0 ? window.scrollY / _h : 0;
    }
    // Mark the new tab active
    for (var i = 0; i < openTabs.length; i++)
      openTabs[i].active = (i === idx);
    saveTabs();
    renderTabStrip();
    // Navigate to the new doc: native host POSTs /api/open-file; static host re-renders.
    var isNative = !!(window.chrome && window.chrome.webview);
    if (isNative && target.path && tabPath(target) !== tabPath(getActiveTab())) {
      fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target.path })
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) location.reload();
        }).catch(function () { });
    } else if (target.source) {
      // Static mode: re-render the saved source in place
      if (typeof clientRender === 'function') clientRender(target.source);
      else location.reload();
    } else if (target.path) {
      location.href = location.pathname + '?doc=' + encodeURIComponent(tabPath(target));
    }
    // Restore scroll position after paint
    setTimeout(function () {
      if (target.pos) restorePosFrom(target.pos);
    }, 200);
  }
  function closeTab(idx) {
    openTabs.splice(idx, 1);
    if (!openTabs.length) { openTabs = [{ path: S.filepath || '', name: S.name || '', active: true }]; }
    else openTabs[idx < openTabs.length ? idx : 0].active = true;
    saveTabs();
    renderTabStrip();
  }
  function openTab(path, name, source) {
    // Deduplicate: if already open, just switch to it
    for (var i = 0; i < openTabs.length; i++) {
      if (tabPath(openTabs[i]) === path) { switchTab(i); return; }
    }
    for (var j = 0; j < openTabs.length; j++) openTabs[j].active = false;
    openTabs.push({ path: path, name: name, source: source, active: true, pos: null });
    saveTabs();
    renderTabStrip();
  }
  function restorePosFrom(v) {
    if (isFinite(v) && v >= 0 && v <= 1) {
      var h = document.body.scrollHeight - window.innerHeight;
      if (h > 0) window.scrollTo(0, v * h);
    }
  }
  // Initialise the tab strip with the current document
  if (S.filepath || S.name) {
    openTabs = [{ path: S.filepath || '', name: S.name || 'untitled', active: true, pos: null }];
    saveTabs();
  }
  renderTabStrip();

  // ---- virtual scrolling / lazy rendering ----------------------------------
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

  // ---- init ----------------------------------------------------------------
  function init() {
  if (document.body.hasAttribute('data-live')) {
    // /api/config only exists on the native host; Node falls back to defaults.
    // Apply early so font/theme land before the first paint of the document.
    fetch('/api/config', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(applyConfig).catch(function () {});
  }
  var posT = null;
  window.addEventListener('scroll', function () {
    if (posT) return;
    posT = setTimeout(function () { posT = null; savePos(); }, 300);
  }, { passive: true });
  window.addEventListener('beforeunload', savePos);
  // All wiring is idempotent (dataset flags), so run it unconditionally on
  // both hosts: the node host's server-rendered body already carries it from
  // the page template, the native host renders client-side first and this
  // picks up the result.
  buildToc();
  wireTocActive();
  wireCollapse();
  wireCodeLineno();
  wireTableFullscreen();
  wireEquationCopy();
  renderStat();
  renderMermaid();
  // UI polish: friendly placeholder + scroll-to-top (server-rendered path)
  ensureEmptyState(contentEl, contentEl.innerHTML);
  wireTotop();
  fileEl.textContent = (S.filepath || '').split(/[\\\\/]/).pop() || '';
  marpState.title = (S.toc && S.toc[0] && S.toc[0].text) || fileEl.textContent;
  // Restore the read position after the rendered DOM settles (KaTeX / images
  // change height asynchronously).
  setTimeout(restorePos, 200);

  // Static (exported) files have no server behind them: the external-editor
  // jump and direct editing would just fail. The export also strips
  // mdserial.js / wysiwyg.js from the markup, so the ✍ button has no handler
  // wired here (W stays null) — a visible-but-dead button is worse than none,
  // so hide it along with the F2 one. (The old mdl-btn-source is gone since
  // v0.7.1 folded source editing into the ✍ toolbar.)
  if (!document.body.hasAttribute('data-live')) {
    ['mdl-btn-edit', 'mdl-btn-wysiwyg'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.hidden = true;
    });
  }
  }

  if (S.clientRender) {
    // native host: live page fetches /api/doc, exported file carries
    // window.__MDL_SRC__ inline — clientRender handles both
    clientRender().then(init).catch(function (err) {
      toast(t('render-failed','渲染失败') + ': ' + String((err && err.message) || err));
    });
  } else {
    init();
  }
})();
