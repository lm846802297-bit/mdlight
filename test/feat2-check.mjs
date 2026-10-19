// feat-check: verify the SuperGoodViewer-portable features are wired in.
// Run: node test/feat2-check.mjs
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const files = {
  appJs:      path.join(ROOT, 'ui', 'app.js'),
  appCss:     path.join(ROOT, 'ui', 'app.css'),
  i18n:       path.join(ROOT, 'ui', 'i18n.js'),
  indexHtml:  path.join(ROOT, 'ui', 'index.html'),
  serverCs:   path.join(ROOT, 'native', 'Server.cs'),
  nwCs:       path.join(ROOT, 'native', 'NativeWindow.cs'),
  progCs:     path.join(ROOT, 'native', 'Program.cs'),
};
const read = f => readFileSync(f, 'utf8');
const appJs  = read(files.appJs);
const appCss = read(files.appCss);
const i18n   = read(files.i18n);
const server = read(files.serverCs);
const nw     = read(files.nwCs);
const prog   = read(files.progCs);

let pass = 0, fail = 0;
function check(name, ok) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name); }
}

console.log('feat2-check (SuperGoodViewer portable features):');

// ── feat1: mermaid SVG cache ──────────────────────────────────────────────
check('feat1: MM_CACHE_PREFIX constant', appJs.includes("MM_CACHE_PREFIX"));
check('feat1: mmHash FNV-1a', appJs.includes('mmHash'));
check('feat1: mmCacheGet / mmCacheSet / mmCachePrune',
      appJs.includes('mmCacheGet') && appJs.includes('mmCacheSet') && appJs.includes('mmCachePrune'));
check('feat1: mmCacheVersion', appJs.includes('mmCacheVersion'));

// ── feat2: font enumeration ───────────────────────────────────────────────
check('feat2: KNOWN_FONTS list', appJs.includes('KNOWN_FONTS'));
check('feat2: availableFonts()', appJs.includes('availableFonts'));
check('feat2: document.fonts.check', appJs.includes("document.fonts.check"));

// ── feat3: PDF header/footer macros ────────────────────────────────────────
check('feat3: pdfMacro()', appJs.includes('pdfMacro'));
check('feat3: applyPdfMacros()', appJs.includes('applyPdfMacros'));
check('feat3: estimateTotalPages()', appJs.includes('estimateTotalPages'));
check('feat3: @media print CSS', appJs.includes('@media print'));

// ── feat4: custom keyboard shortcuts ───────────────────────────────────────
check('feat4: SHORTCUT_DEFAULTS', appJs.includes('SHORTCUT_DEFAULTS'));
check('feat4: parseSc()', appJs.includes('parseSc'));
check('feat4: matchesSc()', appJs.includes('matchesSc'));
check('feat4: buildScPanel()', appJs.includes('buildScPanel'));
check('feat4: Ctrl/Cmd+K panel toggle', appJs.includes('KeyK') || appJs.includes("'k'"));

// ── feat5: drag-and-drop file open ─────────────────────────────────────────
check('feat5: wireDragDrop()', appJs.includes('wireDragDrop'));
check('feat5: mdl-drag-over CSS', appCss.includes('mdl-drag-over'));
check('feat5: /api/open-file route in Server.cs', server.includes('/api/open-file'));
check('feat5: SwapDoc() in Server.cs', server.includes('SwapDoc'));
check('feat5: StopWatcher() in Server.cs', server.includes('StopWatcher'));
check('feat5: open: handler in NativeWindow.cs', nw.includes('msg.StartsWith("open:")') || nw.includes('"open:"'));

// ── feat6: single-instance + CLI hot-send ──────────────────────────────────
check('feat6: NamedMutex single-instance', prog.includes('Global\\\\mdlight-single') || prog.includes('MutexName'));
check('feat6: ForwardToPrimary()', prog.includes('ForwardToPrimary'));
check('feat6: StartPipeListener()', prog.includes('StartPipeListener'));
check('feat6: NamedPipeClientStream', prog.includes('NamedPipeClientStream'));
check('feat6: NamedPipeServerStream', prog.includes('NamedPipeServerStream'));
check('feat6: System.IO.Pipes using', prog.includes('System.IO.Pipes'));

// ── feat7: publish-quality PDF layout ──────────────────────────────────────
check('feat7: break-after avoid on headings', appJs.includes('break-after: avoid') || appJs.includes('page-break-after: avoid'));
check('feat7: break-inside avoid on tables', appJs.includes('break-inside: avoid'));
check('feat7: orphans/widows', appJs.includes('orphans'));

// ── feat8: multi-document tab manager ─────────────────────────────────────
check('feat8: TABS_KEY localStorage', appJs.includes("TABS_KEY") || appJs.includes("mdl-tabs"));
check('feat8: renderTabStrip()', appJs.includes('renderTabStrip'));
check('feat8: switchTab()', appJs.includes('switchTab'));
check('feat8: closeTab()', appJs.includes('closeTab'));
check('feat8: openTab()', appJs.includes('openTab'));
check('feat8: .mdl-tab-bar CSS', appCss.includes('mdl-tab-bar'));

// ── feat9: layout templates (stream/a4/slide) ────────────────────────────
check('feat9: mdl-layout-a4 body class', appJs.includes('mdl-layout-a4'));
check('feat9: mdl-layout-slide body class', appJs.includes('mdl-layout-slide'));
check('feat9: A4 CSS in app.css', appCss.includes('mdl-layout-a4'));
check('feat9: slide CSS in app.css', appCss.includes('mdl-layout-slide'));

// ── feat10: virtual scrolling / lazy rendering ───────────────────────────
check('feat10: VBLOCK_THRESHOLD', appJs.includes('VBLOCK_THRESHOLD'));
check('feat10: wrapVBlocks()', appJs.includes('wrapVBlocks'));
check('feat10: observeVBlocks()', appJs.includes('observeVBlocks'));
check('feat10: IntersectionObserver', appJs.includes('IntersectionObserver'));
check('feat10: .mdl-vblock CSS', appCss.includes('mdl-vblock'));

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
