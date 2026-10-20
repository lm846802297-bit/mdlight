// 生成 test/fixtures/sample.pdf —— 一个手写的最小合法文本 PDF（2 页，FlateDecode 内容流）。
// 运行：node test/pdf2md-make-fixture.mjs
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function latin1Encode(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// 构造 2 页 PDF。contentForPage(i): 第 i 页内容流。
function buildPdf(pageContents) {
  const n = pageContents.length;
  const streams = pageContents.map((ops) => deflateSync(new TextEncoder().encode(ops)));
  // 对象:
  // 1 catalog
  // 2 pages
  // 3..(2+n) pages
  // (3+n)..(3+2n-1) contents
  //  then fonts
  const pages = 0;
  const pageObj = (idx) => {
    const contentsId = 3 + n + idx;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + 2 * n} 0 R /F2 ${3 + 2 * n + 1} 0 R >> >> /Contents ${contentsId} 0 R >>`;
  };
  const doc = {};
  doc[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  doc[2] = `<< /Type /Pages /Count ${n} /Kids [${Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(' ')}] >>`;
  for (let i = 0; i < n; i++) doc[3 + i] = pageObj(i);
  for (let i = 0; i < n; i++) {
    const id = 3 + n + i;
    doc[id] = `<< /Length ${streams[i].length} /Filter /FlateDecode >>\nstream\n`;
  }
  doc[3 + 2 * n] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  doc[3 + 2 * n + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  let pdf = '%PDF-1.4\n';
  const offsets = {};
  const maxId = 3 + 2 * n + 1;
  for (let i = 1; i <= maxId; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${doc[i]}`;
    if (i >= 3 + n && i < 3 + 2 * n) pdf += Buffer.from(streams[i - (3 + n)]).toString('binary');
    pdf += '\nendstream\nendobj\n';
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return latin1Encode(pdf);
}

const Tj = (text, x, y, size, font) =>
  `BT /${font || 'F1'} ${size || 12} Tf ${x} ${y} Td (${text}) Tj ET`;

const page1 = [
  Tj('Sample Report', 72, 720, 24, 'F2'),
  Tj('This is section one of a sample document.', 72, 680, 12),
  Tj('Introduction highlights key results.', 72, 660, 12),
  Tj('- Primary finding one', 72, 635, 12),
  Tj('- Primary finding two', 72, 615, 12),
  Tj('Read more at https://example.com/sample', 72, 585, 12),
].join('\n');
const page2 = [
  Tj('Second Page', 72, 720, 20, 'F2'),
  Tj('1. Analyze data', 72, 680, 12),
  Tj('2. Draw conclusions', 72, 660, 12),
  Tj('3. Write report conclusions.', 72, 640, 12),
].join('\n');

const pdf = buildPdf([page1, page2]);
const outPath = path.join(__dirname, 'fixtures', 'sample.pdf');
fs.writeFileSync(outPath, Buffer.from(pdf));
console.log('wrote', outPath, pdf.length, 'bytes');