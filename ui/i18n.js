// mdlight UI i18n (parity feature: zh-CN / en-US).
//
// The default language is zh-CN, so a missing key silently falls back to the
// Chinese string the code already carries — that keeps existing behaviour intact
// while en-US (and future locales) only override what they translate.
//
// Exposed as window.MDLI18N: { t(key, fallback), lang(), setLang(l), apply() }.
// setLang() rewrites the current document (data-i18n text, data-i18n-title
// tooltips, placeholders) and persists the choice to localStorage so it survives
// a reload; the native host also stores it in config.json via /api/config.
(function (global) {
  'use strict';

  var DICTS = {
    'zh-CN': {},
    'en-US': {
      // topbar
      'toc': 'Contents (Ctrl+T)',
      'theme': 'Theme (Ctrl+D)',
      'print': 'Print (Ctrl+P)',
      'external-editor': 'Open in external editor (F2)',
      'settings': 'Settings',
      'export-csv': 'Export tables to CSV',
      'export-pdf': 'Export to PDF',
      'no-table': 'No table in this document',
      'csv-exported': 'Exported {n} CSV file(s)',
      'pdf-window-only': 'PDF export needs the app window',
      'mindmap': 'Outline mind-map (Ctrl+Shift+M)',
      'to-top': 'Back to top',
      'empty-title': 'Nothing here yet',
      'empty-hint': 'Open or edit a Markdown file on the left to get started',
      'no-heading': 'No heading in this document',
      'upload-asset': 'Upload image into the document folder',
      'upload-ok': 'Uploaded ',
      'appearance': 'Appearance (skin / font / size)',
      'skin': 'Skin',
      'font-family': 'Body font',
      'font-size': 'Body size',
      'font-smaller': 'Smaller font',
      'font-larger': 'Larger font',
      'upload-failed': 'Upload failed',
      'wysiwyg': 'Edit in place (Ctrl+Shift+E)',
      'minimize': 'Minimize',
      'maximize': 'Maximize',
      'close': 'Close',
      'stat-words': 'words · {chars} chars',
      'stat-eq': 'formulas',
      'stat-err': 'errors',
      'stat-mm': 'diagrams',
      // find
      'find-placeholder': 'Find in page…',
      'ctx-find': 'Find in page (Ctrl+F)',
      'find-prev': 'Previous (Shift+Enter)',
      'find-next': 'Next (Enter)',
      'find-close': 'Close (Esc)',
      // editor
      'editor-title': 'Source',
      'editor-close': 'Close',
      'editor-save': 'Save (Ctrl+S)',
      'editor-hint': 'Ctrl+S save · Esc close · preview refreshes after save',
      'editor-hint-dual': 'Preview refreshes as you type · F3 exit',
      // wysiwyg toolbar
      'bold': 'Bold (Ctrl+B)',
      'italic': 'Italic (Ctrl+I)',
      'strike': 'Strikethrough',
      'code': 'Code',
      'quote': 'Quote',
      'list': 'List',
      'olist': 'Numbered list',
      'task': 'Task',
      'link': 'Link',
      'image': 'Image',
      'table': 'Table',
      'h1': 'Heading 1',
      'h2': 'Heading 2',
      'h3': 'Heading 3',
      'view-source': 'Source',
      'view-render': 'Preview',
      'exit-editor': 'Done (Esc)',
      // toasts
      'loaded': 'Source editor opened',
      'read-failed': 'Failed to read source',
      'saved': 'Saved',
      'save-failed': 'Save failed',
      'reload-failed': 'Reload failed',
      'reloaded': 'Reloaded',
      'copy': 'Copied ',
      'copy-formula': 'Formula source copied',
      'copy-error': 'Error message copied',
      'theme-toast': 'Theme',
      'dual': 'Split view (F3 to exit)',
      'dirty': 'File changed — your edits were not applied',
      'render-failed': 'Render failed',
      'no-service': 'Cannot reach the mdlight service',
      'table-fullscreen': 'Fullscreen table',
      // confirm
      'conflict-title': 'File changed on disk',
      'conflict-body': 'The file was modified outside the editor.\n\nClick OK to overwrite it on disk with the editor content;\nclick Cancel to discard your edits and reload the file.',
      'conflict-ok': 'OK',
      'conflict-cancel': 'Cancel',
      'renderer-missing': 'Renderer not loaded',
      'engine-failed': 'Diagram engine failed to load',
      // settings dialog
      'set-title': 'mdlight Settings',
      'set-general': 'General',
      'set-appearance': 'Appearance',
      'set-editor': 'Editing',
      'set-font': 'Font',
      'set-font-size': 'Font size',
      'set-theme': 'Theme',
      'set-theme-auto': 'Follow system',
      'set-theme-light': 'Light',
      'set-theme-dark': 'Dark',
      'set-theme-sepia': 'Sepia',
      'set-code-wrap': 'Wrap code',
      'set-code-lineno': 'Line numbers',
      'set-remember-position': 'Remember reading position',
      'set-hardbreaks': 'Hard line breaks',
      'set-language': 'Language',
      'set-cancel': 'Cancel',
      'set-save': 'Save',
      'set-saved': 'Settings saved',
      // misc strings that were hardcoded before i18n coverage
      'toc-line-hint': 'Line {n}',
      'toc-empty': '(no headings)',
      'mermaid-render-failed': 'Diagram render failed',
      'mermaid-static-hint': 'Offline export omits the diagram engine (to avoid adding ~1.4 MB) — open the .md in mdlight to render',
      'editor-opened': 'Opened in editor (line {n}{via})',
      'editor-not-found': 'No editor found — set MD_EDITOR',
    }
  };

  var KEY = 'mdl-lang';
  var lang = 'zh-CN';

  function readStored() {
    try { var v = localStorage.getItem(KEY); if (v && DICTS[v]) return v; } catch (e) {}
    return 'zh-CN';
  }

  function t(key, fallback) {
    var d = DICTS[lang];
    var v = d && d[key];
    if (v === undefined) return fallback === undefined ? '' : fallback;
    return v;
  }

  // interpolate {n} style placeholders
  function tf(key, fallback, vars) {
    var s = t(key, fallback);
    if (vars) Object.keys(vars).forEach(function (k) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    });
    return s;
  }

  function apply() {
    // Cache the original (source-language) value on first pass so that
    // switching back to 'zh-CN' restores the real Chinese, not the
    // previously-translated English (the fallback would otherwise be polluted).
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.hasAttribute('data-i18n-orig')) el.setAttribute('data-i18n-orig', el.textContent);
      var k = el.getAttribute('data-i18n');
      var s = t(k, el.getAttribute('data-i18n-orig'));
      if (s !== undefined && s !== '') el.textContent = s;
    }
    var ts = document.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < ts.length; j++) {
      var tEl = ts[j];
      if (!tEl.hasAttribute('data-i18n-orig')) tEl.setAttribute('data-i18n-orig', tEl.getAttribute('title') || '');
      var kt = tEl.getAttribute('data-i18n-title');
      var st = t(kt, tEl.getAttribute('data-i18n-orig'));
      if (st) tEl.setAttribute('title', st);
    }
    var phs = document.querySelectorAll('[data-i18n-ph]');
    for (var m = 0; m < phs.length; m++) {
      var pEl = phs[m];
      if (!pEl.hasAttribute('data-i18n-orig')) pEl.setAttribute('data-i18n-orig', pEl.getAttribute('placeholder') || '');
      var kp = pEl.getAttribute('data-i18n-ph');
      var sp = t(kp, pEl.getAttribute('data-i18n-orig'));
      if (sp) pEl.setAttribute('placeholder', sp);
    }
    global.dispatchEvent(new CustomEvent('mdl-i18n-change', { detail: { lang: lang } }));
  }

  function setLang(l) {
    if (!DICTS[l]) return false;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch (e) {}
    apply();
    return true;
  }

  lang = readStored();

  global.MDLI18N = { t: t, tf: tf, lang: function () { return lang; }, setLang: setLang, apply: apply, dicts: DICTS };
})(window);
