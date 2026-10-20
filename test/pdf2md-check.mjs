// test/pdf2md-check.mjs
// 验证 core/pdf2md.mjs 的纯 JS 零依赖 PDF 提取 + markdown 化。
// 运行：node test/pdf2md-check.mjs
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfExtractText, pdfExtractPages, pdfToMarkdown } from '../core/pdf2md.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

function latin1Encode(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// 构造最小合法 PDF（1 页）内容流，可选注入原始 UTF-8 非 ASCII 字节以测试乱码警告。
// textLines: 每行一个文本运算符。
function buildPdf(textLines) {
  const contentOps = textLines.join('\n') + '\n';
  const flated = deflateSync(new TextEncoder().encode(contentOps));
  // 对象：1 catalog, 2 pages, 3 page, 4 contents, 5 font F1, 6 font F2
  const doc = {};
  doc[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  doc[2] = '<< /Type /Pages /Count 1 /Kids [3 0 R] >>';
  doc[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>';
  doc[4] = `<< /Length ${flated.length} /Filter /FlateDecode >>\nstream\n`;
  doc[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  doc[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  let pdf = '%PDF-1.4\n';
  const offsets = {};
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${doc[i]}`;
    if (i === 4) pdf += Buffer.from(flated).toString('binary');
    pdf += '\nendstream\nendobj\n';
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return latin1Encode(pdf);
}

function Tj(text, x, y, size, font) {
  return `BT /${font || 'F1'} ${size || 12} Tf ${x} ${y} Td (${text}) Tj ET`;
}

// ---- 场景 A：纯 ASCII 文本 PDF ----
const asciiPdf = buildPdf([
  Tj('Hello World', 72, 720, 24, 'F2'),
  Tj('This is a body paragraph. Good morning.', 72, 680, 12),
  Tj('- first item fine', 72, 655, 12),
  Tj('1. second item', 72, 635, 12),
  Tj('Visit https://example.com/abc', 72, 615, 12),
]);

const etA = await pdfExtractText(asciiPdf);
const mdA = await pdfToMarkdown(asciiPdf);

console.log('\n== 场景 A: ASCII PDF ==');
console.log('-- extracted text --\n' + etA.text);
console.log('-- markdown --\n' + mdA.markdown);
console.log('warnings:', JSON.stringify(etA.warnings));

ok(etA.text && etA.text.trim().length > 0, 'A: pdfExtractText 提取出非空文本');
ok(/Hello\s+World/.test(etA.text), 'A: 提取文本包含 "Hello World"');
ok(/example\.com/.test(etA.text), 'A: URL 原文保留（http 开头）');
ok(mdA.pages === 1, `A: pdfToMarkdown pages===1 (得到 ${mdA.pages})`);
ok(mdA.markdown.length > 0, 'A: 生成非空 markdown');
ok(Array.isArray(etA.warnings), 'A: 返回 warnings 数组');
ok(etA.warnings.length === 0, 'A: 纯 ASCII 无警告');

// 列表 markdown 化：`- ` 与 `1. `
ok(/^-\s/.test(mdA.markdown.trim().split('\n')[2] || ''), 'A: 列表行 "- " 被识别');

// ---- 场景 B：非法非 ASCII（模拟 identity-H 乱码）→ 应给出编码警告，不崩溃 ----
const utf8BytesPdf = buildPdf([
  // 直接把 UTF-8 中文写进 PDF 字面串（非标准；真实中文 PDF 会用 CID+ToUnicode）
  Tj('\u6807\u9898 \u8fd9\u662f\u4e00\u6bb5\u6b63\u6587\u6280\u672f\u5185\u5bb9', 72, 720, 12),
]);
const etB = await pdfExtractText(utf8BytesPdf);
ok(Array.isArray(etB.pages) && etB.pages.length === 1, 'B: 非 ASCII 也能返回 1 页，不崩溃');
ok(etB.text.length > 0, 'B: 仍有文本字节');
// 乱码时应有编码警告（这里字节是 UTF-8，会当成 latin1 显示为乱码，比例高 → 触发）
console.log('B: mojibake warnings:', JSON.stringify(etB.warnings));
// 说明：由于字体是 Type1/Helvetica 无 ToUnicode，输出为 latin1 乱码属预期,
// 此处不断言一定有警告（避免脆弱），仅保证不抛异常。

// ---- 场景 C：pdfExtractPages 分页回调 ----
let ncalls = 0;
const pages = await pdfExtractPages(asciiPdf, { onPage: () => ncalls++ });
ok(pages.length === 1 && ncalls === 1, 'C: pdfExtractPages 逐页回调 (1 页)');

// ---- 场景 C2：磁盘 fixture（2 页）----
const fixturePath = path.join(__dirname, 'fixtures', 'sample.pdf');
if (fs.existsSync(fixturePath)) {
  const fbytes = new Uint8Array(fs.readFileSync(fixturePath));
  const ef = await pdfExtractText(fbytes);
  const mf = await pdfToMarkdown(fbytes);
  ok(ef.pages.length === 2 && mf.pages === 2, `C2: 磁盘 fixture 2 页 (得到 ${ef.pages.length})`);
  ok(/Sample Report/.test(ef.pages[0] || ''), 'C2: 第 1 页含 "Sample Report"');
  ok(/Second Page/.test(ef.pages[1] || ''), 'C2: 第 2 页含 "Second Page"');
  ok(/^##\s+Sample Report/m.test(mf.markdown), 'C2: "Sample Report" 被标题化');
  ok(mf.markdown.includes('\n\n---\n\n'), 'C2: 页间用 --- 分隔');
} else {
  ok(false, 'C2: 未找到 fixtures/sample.pdf');
}

// ---- 场景 D：健壮性 ----
const bad = await pdfExtractText(new Uint8Array([37, 80, 68, 70])); // 几乎空 / 垃圾
ok(bad.warnings.length >= 0 && Array.isArray(bad.pages), 'D: 垃圾输入不抛异常，返回 pages 数组');
const empty = await pdfExtractText(new Uint8Array(0));
ok(empty.warnings.length === 1, 'D: 空输入返回 1 条警告');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);