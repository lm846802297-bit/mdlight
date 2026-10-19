// wysiwyg.js — direct editing (WYSIWYG), the "edit the rendered text" mode.
//
// While the built-in source editor (app.js) edits markdown as text, this mode
// turns the rendered document itself editable: click a paragraph, change the
// words, hit save. On save the DOM is serialized back to markdown
// (window.MDLSerialize) and POSTed to /api/save, then the page re-renders.
//
// The renderer bakes things the DOM cannot express (highlighting spans,
// KaTeX markup, SVG diagrams), so entering the mode normalizes those nodes
// back into something editable; leaving the mode serializes them back out.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else root.MDLWysiwyg = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var S = (typeof window !== 'undefined' && window.__MDL__) || {};
  var contentEl = null;
  var toolbarEl = null;
  var onReload = null; // called after a successful save
  var onCancel = null; // called after a plain cancel (no save): restore preview
  var active = false;
  var editorSha = null;

  function init(opts) {
    contentEl = opts.contentEl;
    toolbarEl = opts.toolbarEl;
    onReload = opts.onReload || null;
    onCancel = opts.onCancel || null;
    wireToolbar();
  }

  function isActive() { return active; }

  function enter() {
    if (active) return;
    active = true;
    contentEl.setAttribute('contenteditable', 'true');
    contentEl.classList.add('mdl-editing');
    normalizeForEdit();
    if (toolbarEl) toolbarEl.hidden = false;
    fetchSource().then(function (j) {
      // editorSha is the base for conflict detection on save. Use the SERVER's
      // sha256 (j.sha) — the server compares against sha256 on POST /api/save,
      // so a locally-computed hash (e.g. FNV-1a) would never match and every
      // save would spuriously report a conflict.
      editorSha = j.sha || sha(j.source || '');
      toast('编辑模式：直接改文字，Ctrl+S 保存');
    }).catch(function () {
      toast('编辑模式已开启');
    });
  }

  function exit(saveFirst) {
    if (!active) return;
    if (saveFirst) {
      save().then(function (ok) {
        if (ok) leave();
      });
      return;
    }
    leave();
    // Entering the mode normalized the DOM (hljs spans → text, mermaid SVG →
    // source, KaTeX markup). leave() reverts the editable flags but leaves the
    // normalized DOM in place, so without a re-render the user is left staring
    // at the unrendered preview after a plain cancel (Escape / 取消).
    if (onCancel) onCancel();
  }

  function leave() {
    active = false;
    contentEl.removeAttribute('contenteditable');
    contentEl.classList.remove('mdl-editing');
    if (toolbarEl) toolbarEl.hidden = true;
  }

  function normalizeForEdit() {
    // Highlighting spans get in the way of typing: drop them, keep the text.
    Array.prototype.forEach.call(contentEl.querySelectorAll('pre code'), function (code) {
      var text = code.textContent;
      code.className = code.className.replace(/hljs[\w-]*/g, '').trim();
      code.innerHTML = '';
      code.appendChild(document.createTextNode(text));
      code.setAttribute('contenteditable', 'true');
    });
    // Mermaid SVG is not editable: swap it for the diagram source.
    Array.prototype.forEach.call(contentEl.querySelectorAll('x-mermaid'), function (n) {
      var src = n.getAttribute('data-mm-src') || '';
      n.innerHTML = '<pre class="mdl-mermaid-src"><code></code></pre>';
      var c = n.querySelector('code');
      if (c) { c.textContent = src; c.setAttribute('contenteditable', 'true'); }
    });
    // Equations keep their source in data-src; the KaTeX markup is not meant to
    // be typed over, but the node can be deleted or replaced wholesale.
    Array.prototype.forEach.call(contentEl.querySelectorAll('x-equation'), function (n) {
      n.setAttribute('contenteditable', 'false');
    });
    // Task checkboxes were rendered disabled; let the user toggle them.
    Array.prototype.forEach.call(contentEl.querySelectorAll('.mdl-task-box'), function (box) {
      box.removeAttribute('disabled');
    });
  }

  // --- toolbar -------------------------------------------------------------
  function wireToolbar() {
    if (!toolbarEl) return;
    Array.prototype.forEach.call(toolbarEl.querySelectorAll('[data-cmd]'), function (btn) {
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault(); // keep the selection
        var cmd = btn.getAttribute('data-cmd');
        if (cmd === 'save') { save(); return; }
        if (cmd === 'cancel') { exit(false); return; }
        var val = btn.getAttribute('data-value');
        runCommand(cmd, val);
      });
    });
  }

  function runCommand(cmd, val) {
    switch (cmd) {
      case 'bold': return document.execCommand('bold', false, null);
      case 'italic': return document.execCommand('italic', false, null);
      case 'strike': return document.execCommand('strikeThrough', false, null);
      case 'code': return document.execCommand('formatBlock', false, 'pre');
      case 'h2': return document.execCommand('formatBlock', false, 'h2');
      case 'h3': return document.execCommand('formatBlock', false, 'h3');
      case 'p': return document.execCommand('formatBlock', false, 'p');
      case 'ul': return document.execCommand('insertUnorderedList', false, null);
      case 'ol': return document.execCommand('insertOrderedList', false, null);
      case 'quote': return document.execCommand('formatBlock', false, 'blockquote');
      case 'link': {
        var url = prompt('链接地址:', 'https://');
        // reject dangerous schemes: createLink would emit <a href="javascript:...">
        // straight into the DOM, which the renderer would never have produced
        // (markdown-it's validateLink refuses them). execCommand has no scheme
        // filter of its own, so we check here.
        if (url && !/^(javascript|vbscript|data):/i.test(url.trim())) {
          return document.execCommand('createLink', false, url);
        }
        return false;
      }
      case 'undo': return document.execCommand('undo', false, null);
      case 'redo': return document.execCommand('redo', false, null);
      case 'equation': {
        var tex = prompt('公式 (LaTeX):', 'E=mc^2');
        if (tex) {
          var node = document.createElement('x-equation');
          node.className = 'mdl-eq';
          node.setAttribute('data-src', tex);
          node.textContent = tex;
          var sel = window.getSelection();
          if (sel && sel.rangeCount) {
            var range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(node);
          } else {
            contentEl.appendChild(node);
          }
        }
        return true;
      }
      case 'source': {
        // Leave WYSIWYG and hand off to the built-in source panel. Reached from
        // the toolbar's 源码 button — same file, same save pipeline, but you see
        // the raw markdown (WYSIWYG serialization is lossy for complex tables).
        exit(false);
        if (typeof window !== 'undefined' && window.__mdlOpenSource) window.__mdlOpenSource();
        return true;
      }
      default: return false;
    }
  }

  // --- save -----------------------------------------------------------------
  function save(force, baseSha) {
    if (!active) return Promise.resolve(false);
    var markdown = serializeCurrent();
    return doSave(markdown, force, baseSha || editorSha);
  }

  function serializeCurrent() {
    var ser = (typeof window !== 'undefined' && window.MDLSerialize) || require('./mdserial.js');
    return ser.serialize(contentEl).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function doSave(markdown, force, base) {
    return fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: markdown, base: base, force: !!force }),
    }).then(function (r) {
      if (r.status === 409) return r.json().then(function (j) {
        throw { conflict: true, sha: j.sha };
      });
      if (!r.ok) throw new Error('保存失败 (' + r.status + ')');
      return r.json();
    }).then(function (j) {
      editorSha = j.sha;
      toast('已保存');
      if (onReload) onReload();
      return true;
    }).catch(function (err) {
      if (err && err.conflict) {
        var go = confirm('文件已在别处被修改。\n覆盖 / 取消？');
        if (go) return doSave(markdown, true, null);
        toast('已取消');
        return false;
      }
      toast(String((err && err.message) || err));
      return false;
    });
  }

  // --- source fetch ---------------------------------------------------------
  function fetchSource() {
    return fetch('/api/source', { cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }

  function sha(s) {
    // a tiny synchronous FNV-1a is fine for change detection; the server does
    // the real sha256 on save
    var h = 0x811c9dc5;
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return 'fnv1a-' + h.toString(16);
  }

  function toast(msg) {
    var t = document.getElementById('mdl-toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  return { init: init, enter: enter, exit: exit, save: save, isActive: isActive, serializeCurrent: serializeCurrent };
});