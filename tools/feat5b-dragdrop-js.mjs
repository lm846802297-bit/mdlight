// feat5b: page-side drag-and-drop for opening files in ui/app.js
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

let s = readFileSync('ui/app.js', 'utf8');

const initAnchor = "  // ---- init ----------------------------------------------------------------\n  function init() {";
if (s.indexOf(initAnchor) < 0) { console.log('init anchor not found'); process.exit(1); }

// The JS that gets inserted — written as a plain template string;
// the Chinese literals are inside it directly (no nested quotes needed
// because this file itself is a .mjs, not a -e one-liner).
const ddJs = `  // ---- drag-and-drop file open --------------------------------------------------
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
      if (!/\\.md$|\\.markdown$/i.test(f.name)) {
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

`;

s = s.replace(initAnchor, ddJs + initAnchor, 1);
writeFileSync('ui/app.js', s);
console.log('feat5b app.js done');
