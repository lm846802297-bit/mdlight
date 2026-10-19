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

