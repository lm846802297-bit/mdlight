// feat8: multi-document tab manager — a lightweight JS tab bar in the top UI
// that lets the user keep several open documents side by side without
// restarting the process. The server already supports SwapDoc; this adds a
// client-side tab strip that remembers open files and their scroll positions.
//
// Data stored in localStorage under 'mdl-tabs' as a JSON array:
//   [{path, name, pos, active: bool}]
// A new file (drag-drop, CLI hot-send, or ⌘O) appends a tab.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

let s = readFileSync('ui/app.js', 'utf8');

// Insert just before the init() anchor.
const initAnchor = "  // ---- init ----------------------------------------------------------------\n  function init() {";
if (s.indexOf(initAnchor) < 0) { console.log('init anchor not found'); process.exit(1); }

const tabsJs = `  // ---- multi-document tab manager --------------------------------------------------
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
      (function (t, idx) {
        var el = document.createElement('div');
        el.className = 'mdl-tab' + (t.active ? ' mdl-tab-active' : '');
        el.title = tabPath(t);
        var label = document.createElement('span');
        label.textContent = t.name || (tabPath(t).split('/').pop() || t.name || 'untitled');
        el.appendChild(label);
        var close = document.createElement('span');
        close.className = 'mdl-tab-close';
        close.textContent = '\\u00d7';
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
    if (cur) { cur.pos = savePos(); }
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

`;

s = s.replace(initAnchor, tabsJs + initAnchor, 1);

// Add i18n key
let i18n = readFileSync('ui/i18n.js', 'utf8');
if (i18n.indexOf("'tab-close'") < 0) {
  i18n = i18n.replace("'dd-opened-static':", "'tab-close': '关闭',\n      'tab-open': '新标签',\n      'dd-opened-static':");
  i18n = i18n.replace("'dd-opened-static': 'Opened (static mode, not saved):'",
    "'tab-close': 'Close',\n      'tab-open': 'New tab',\n      'dd-opened-static': 'Opened (static mode, not saved):'");
  writeFileSync('ui/i18n.js', i18n);
}

// Add tab-bar CSS
let css = readFileSync('ui/app.css', 'utf8');
if (css.indexOf('.mdl-tab-bar') < 0) {
  const tabCss = `
/* ---- multi-document tab bar ---- */
.mdl-tab-bar {
  display: flex;
  flex: 0 0 auto;
  background: var(--mdl-bg-alt, #f0f0f0);
  border-bottom: 1px solid var(--mdl-border, #ddd);
  overflow-x: auto;
  overflow-y: hidden;
  max-height: 32px;
}
.mdl-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  border-right: 1px solid var(--mdl-border, #ddd);
  color: var(--mdl-fg-dim, #666);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mdl-tab:hover { background: var(--mdl-accent-soft, rgba(91,141,184,.15)); }
.mdl-tab-active {
  background: var(--mdl-bg, #fff);
  color: var(--mdl-fg, #333);
  font-weight: 500;
}
.mdl-tab-close {
  font-size: 10px;
  opacity: 0.6;
  margin-left: 2px;
}
.mdl-tab-close:hover { opacity: 1; color: #c00; }
`;
  appendFileSync('ui/app.css', tabCss);
}

writeFileSync('ui/app.js', s);
console.log('feat8 done');
