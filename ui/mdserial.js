// mdserial.js — WYSIWYG serializer: rendered DOM -> markdown source.
//
// This is the heart of "direct editing" (a common live-edit pattern). The rendered
// DOM has already eaten the markdown markup (`**bold**` became <strong>), so to
// save edits we have to reconstruct the source. Pure function, no DOM globals:
// it walks the same node model the browser exposes, so it is also unit-testable
// in Node with any DOM implementation.
//
// mdlight's renderer keeps the original source on the tricky nodes:
//   x-equation   data-src = the LaTeX (without delimiters)
//   x-mermaid    data-mm-src = the diagram source
// Everything else is reconstructed structurally.
//
// Exposed as window.MDLSerialize for the live page. Exported as a function for
// the Node test runner.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MDLSerialize = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // --- inline ---------------------------------------------------------------
  function inline(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue; // text
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toLowerCase();
    var kids = Array.prototype.map.call(node.childNodes, inline).join('');

    switch (tag) {
      case 'br': return '  \n';
      case 'strong': case 'b': return '**' + kids + '**';
      case 'em': case 'i': return '*' + kids + '*';
      case 'del': case 's': case 'strike': return '~~' + kids + '~~';
      case 'code': return '`' + node.textContent + '`';
      case 'a': {
        // wikilink: [[target|label]] or [[target]] (label == target)
        var wl = node.getAttribute('data-wikilink');
        if (wl) {
          var wlLabel = node.textContent;
          if (wl === wlLabel || !wlLabel) return '[[' + wl + ']]';
          return '[[' + wl + '|' + wlLabel + ']]';
        }
        var href = node.getAttribute('href') || '';
        var title = node.getAttribute('title');
        if (title) return '[' + kids + '](' + href + ' "' + title + '")';
        return '[' + kids + '](' + href + ')';
      }
      case 'img': {
        var src = node.getAttribute('src') || '';
        var alt = node.getAttribute('alt') || '';
        return '![' + alt + '](' + src + ')';
      }
      case 'sub': return '~' + kids + '~';
      case 'sup': return '^' + kids + '^';
      case 'mark': return '==' + kids + '==';
      case 'input':
        // task checkbox (disabled in render, re-enabled while editing)
        return node.checked ? '[x] ' : '[ ] ';
      case 'x-equation': return equationSrc(node, false);
      case 'x-mermaid': return mermaidSrc(node);
      default: return kids;
    }
  }

  function equationSrc(node, display) {
    var src = node.getAttribute('data-src');
    if (src == null || src === '') {
      // fallback: no source stored (older render) — emit a literal placeholder
      return display ? '$$$$' : '$$';
    }
    var isDisplay = display || node.classList.contains('mdl-eq--display');
    // The renderer splits inline ($..$ -> mdl_math, display=false) and block
    // ($$..$$ -> mdl_math_block, display=true) and bakes the verdict into the
    // mdl-eq--display class. Trust that class rather than sniffing the source:
    // the old logic promoted any formula containing a LaTeX command to display,
    // silently turning inline math like $f(x)=\frac{a}{b}$ into a centered block.
    // Display formulas keep their newlines (aligned/environments need them).
    if (isDisplay) return '$$' + src.trim() + '$$';
    return '$' + src.trim().replace(/\s*\n\s*/g, ' ') + '$';
  }

  // In WYSIWYG mode, normalizeForEdit() swaps the mermaid SVG for a
  // <pre class="mdl-mermaid-src"><code> element so the user can edit the
  // diagram source. data-mm-src holds the ORIGINAL source; the user's edits
  // live in the code element's textContent. Prefer the edited text when present.
  function mermaidSrc(node) {
    var codeEl = node.querySelector('pre.mdl-mermaid-src code');
    var src = codeEl ? codeEl.textContent : (node.getAttribute('data-mm-src') || '');
    return '```mermaid\n' + src.replace(/\n$/, '') + '\n```';
  }

  // --- blocks ---------------------------------------------------------------
  function heading(node, level) {
    var text = inline(node).trim().replace(/^#+\s*/, '');
    return repeat('#', level) + ' ' + text + '\n\n';
  }

  function list(node, ordered, depth) {
    var pad = repeat('  ', depth);
    var items = node.children;
    var out = '';
    var i = 0;
    for (var k = 0; k < items.length; k++) {
      var li = items[k];
      if (li.nodeName.toLowerCase() !== 'li') continue;
      i++;
      var marker = ordered ? (i + '. ') : '- ';
      // Compute the li body from inline children ONLY — skip nested <ul>/<ol>
      // which are serialized separately below (otherwise their text leaks into
      // the parent item body AND reappears as a nested list = duplication).
      var bodyParts = [];
      Array.prototype.forEach.call(li.childNodes, function (c) {
        if (c.nodeType === 1) {
          var ct = c.nodeName.toLowerCase();
          if (ct === 'ul' || ct === 'ol') return;
        }
        bodyParts.push(inline(c));
      });
      var body = bodyParts.join('').trim();
      // task list: the checkbox is first in li; the [x]/[ ] marker is produced
      // by inline() above, so strip it if it is already rendered as text
      out += pad + marker + body + '\n';
      // nested lists inside the li
      for (var c = 0; c < li.children.length; c++) {
        var ch = li.children[c];
        var ct = ch.nodeName.toLowerCase();
        if (ct === 'ul' || ct === 'ol') out += list(ch, ct === 'ol', depth + 1);
      }
    }
    return out + '\n';
  }

  function table(node) {
    var rows = [];
    var head = node.querySelector('thead');
    var bodies = node.querySelectorAll('tbody tr');
    if (head) {
      var hcells = Array.prototype.map.call(head.querySelectorAll('th'), function (th) {
        return inline(th).trim();
      });
      rows.push(hcells);
    }
    bodies.forEach(function (tr) {
      rows.push(Array.prototype.map.call(tr.querySelectorAll('td, th'), function (td) {
        return inline(td).trim();
      }));
    });
    if (!rows.length) return '';
    var width = rows[0].length;
    var lines = [];
    lines.push('| ' + rows[0].join(' | ') + ' |');
    lines.push('| ' + Array(width).fill('---').join(' | ') + ' |');
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r].slice();
      while (cells.length < width) cells.push('');
      lines.push('| ' + cells.join(' | ') + ' |');
    }
    return lines.join('\n') + '\n\n';
  }

  function fence(pre) {
    var code = pre.querySelector('code');
    if (!code) return '';
    var cls = code.className || '';
    var lang = '';
    // WYSIWYG: pre.mdl-mermaid-src is the editable mermaid source swap
    if (pre.classList && pre.classList.contains('mdl-mermaid-src')) lang = 'mermaid';
    var m = /(?:language-|lang-)([a-z0-9_+-]+)/i.exec(cls);
    if (m) lang = m[1];
    var text = code.textContent.replace(/\n$/, '');
    var fence = '```';
    // if the content contains a triple backtick, use a longer fence
    while (text.indexOf(fence) !== -1) fence += '`';
    return fence + lang + '\n' + text + '\n' + fence + '\n\n';
  }

  function blockquote(node) {
    var isCallout = node.classList.contains('mdl-callout');
    var inner = node.innerHTML;
    // callouts: mdlight renders `> [!NOTE]`-style; we preserve the info prefix
    var prefix = '';
    if (isCallout) {
      // The renderer sets data-callout="KIND"; fall back to class for manual DOM.
      var kind = node.getAttribute('data-callout');
      if (!kind) {
        var classes = node.className.split(/\s+/);
        for (var ci = 0; ci < classes.length; ci++) {
          var cm = /^mdl-callout--([a-z]+)$/.exec(classes[ci]);
          if (cm) { kind = cm[1].toUpperCase(); break; }
        }
      }
      kind = kind || 'NOTE';
      prefix = '[!' + kind + '] ';
    }
    var text = prefix + inlineText(node);
    // GFM callout prefix is on its own line
    if (isCallout) text = '[!' + kind + ']\n' + inlineText(node);
    return text.split('\n').map(function (l) { return '> ' + l; }).join('\n') + '\n\n';
  }

  function inlineText(node) {
    // blockquote / callout bodies hold nested inline content plus <p>
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (c) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeName && c.nodeName.toLowerCase() === 'p') out += inline(c);
      else out += inline(c);
    });
    return out.trim();
  }

  function hr() { return '---\n\n'; }

  // --- top level ------------------------------------------------------------
  function serialize(container) {
    if (!container) return '';
    var parts = [];
    var nodes = container.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        var t = n.nodeValue;
        if (t.trim()) parts.push(t.trim() + '\n\n');
        continue;
      }
      if (n.nodeType !== 1) continue;
      var tag = n.nodeName.toLowerCase();
      var s = '';
      switch (tag) {
        case 'h1': s = heading(n, 1); break;
        case 'h2': s = heading(n, 2); break;
        case 'h3': s = heading(n, 3); break;
        case 'h4': s = heading(n, 4); break;
        case 'h5': s = heading(n, 5); break;
        case 'h6': s = heading(n, 6); break;
        case 'p': s = inline(n).trim() + '\n\n'; break;
        case 'ul': s = list(n, false, 0); break;
        case 'ol': s = list(n, true, 0); break;
        case 'blockquote': s = blockquote(n); break;
        case 'pre': s = fence(n); break;
        case 'hr': s = hr(); break;
        case 'table': s = table(n); break;
        case 'x-equation': s = equationSrc(n, n.classList.contains('mdl-eq--display')) + '\n\n'; break;
        case 'x-mermaid': s = mermaidSrc(n) + '\n\n'; break;
        case 'img': s = inline(n) + '\n\n'; break;
        default:
          // unknown block: serialize children as inline then wrap as paragraph
          var inner = inline(n);
          if (inner.trim()) s = inner.trim() + '\n\n';
          break;
      }
      if (s) parts.push(s);
    }
    return parts.join('');
  }

  function repeat(ch, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += ch;
    return out;
  }

  return { serialize: serialize, inline: inline, equationSrc: equationSrc };
});