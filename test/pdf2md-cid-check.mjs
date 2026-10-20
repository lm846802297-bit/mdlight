// test/pdf2md-cid-check.mjs
// 验证 core/pdf2md.mjs 对中文字体（CID/identity-H + ToUnicode CMap）的解码。
// 运行：node test/pdf2md-cid-check.mjs
import { deflateSync } from 'node:zlib';
import { pdfExtractText, pdfToMarkdown, pdfExtractPages } from '../core/pdf2md.mjs';

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

// 构造含 Type0/CID + ToUnicode 的最小 PDF。
// cids: 内容流里的 hex 字节（CID 码点）；toUnicodeText: CMap 文本（原始，未压缩）。
function buildCidPdf({ contentHex, toUnicodeText, compressToUnicode = false, inlineFont = false }) {
  const contents = `BT /F1 24 Tf 72 720 Td <${contentHex}> Tj ET\n`;
  const flated = deflateSync(new TextEncoder().encode(contents));
  let fu = toUnicodeText;
  if (toUnicodeText) {
    fu = compressToUnicode ? new Uint8Array(deflateSync(new TextEncoder().encode(toUnicodeText))) : new TextEncoder().encode(toUnicodeText);
  }

  const doc = {};
  doc[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  doc[2] = '<< /Type /Pages /Count 1 /Kids [3 0 R] >>';
  doc[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>';
  doc[4] = `<< /Length ${flated.length} /Filter /FlateDecode >>\nstream\n`;
  // 7: Type0 复合字体，含 ToUnicode；8: 引用 9 (CIDFontType0)；9 引用 10 (Identity 编码)。
  doc[7] = `<< /Type /Font /Subtype /Type0 /BaseFont /Hei /Encoding /Identity-H /DescendantFonts [9 0 R] /ToUnicode ${toUnicodeText ? '10 0 R' : '/None'} >>`;
  doc[9] = '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Hei /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 0 >> /FontDescriptor 11 0 R >>';
  doc[11] = '<< /Type /FontDescriptor /FontName /Hei /Flags 4 >>';

  let pdf = '%PDF-1.4\n';
  const offsets = {};
  const order = [1, 2, 3, 4, 7, 9, 11];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    offsets[n] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${n} 0 obj\n${doc[n]}`;
    if (n === 4) pdf += Buffer.from(flated).toString('binary');
    pdf += '\nendstream\nendobj\n';
  }
  // ToUnicode 对象 10（若存在）
  if (toUnicodeText) {
    offsets[10] = Buffer.byteLength(pdf, 'latin1');
    const prefix = inlineFont ? '' : '';
    pdf += `10 0 obj\n<< /Length ${fu.length}${compressToUnicode ? ' /Filter /FlateDecode' : ''} >>\nstream\n`;
    pdf += Buffer.from(fu).toString('binary');
    pdf += '\nendstream\nendobj\n';
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  const size = Math.max(...Object.values(offsets), 11) + 1;
  pdf += 'xref\n0 ' + size + '\n0000000000 65535 f \n';
  for (let i = 1; i < size; i++) {
    pdf += offsets[i] !== undefined ? `${String(offsets[i]).padStart(10, '0')} 00000 n \n` : '0000000000 00000 f \n';
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return latin1Encode(pdf);
}

const CMap_SIMPLE = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 0 >> def',
  '/CMapName /Adobe-Identity-UCS def',
  'begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  'beginbfchar',
  '<4E2D> <4E2D>',
  '<6587> <6587>',
  '<6D4B> <6D4B>',
  '<8BD5> <8BD5>',
  'endbfchar',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end'
].join('\n');

// ---- 场景 A：identity-H + bfchar 映射出「中文测试」 ----
const pdfA = buildCidPdf({
  contentHex: '4E2D65876D4B8BD5', // 中文测试
  toUnicodeText: CMap_SIMPLE,
});
const etA = await pdfExtractText(pdfA);
const mdA = await pdfToMarkdown(pdfA);

console.log('\n== 场景 A: identity-H + bfchar ==');
console.log('-- extracted text --\n' + etA.text);
console.log('-- markdown --\n' + mdA.markdown);
console.log('-- warnings --', JSON.stringify(etA.warnings));

ok(etA.pages.length === 1, 'A: 1 页不崩溃');
ok(/中文测试/.test(etA.text), 'A: 还原出 "中文测试"');
ok(!/[\uFFFD]/.test(etA.text), 'A: 无替换符乱码');
ok(etA.warnings.filter((w) => /乱码|identity-H|CID/i.test(w)).length === 0, 'A: 成功解码时无乱码/CID 警告');
const pageA = await pdfExtractPages(pdfA);
ok(pageA.length === 1, 'A: pdfExtractPages 返回 1 页');

// ---- 场景 B：bfrange + 多目的数组 ----
const CMap_BRANGE = CMap_SIMPLE.replace(
  /beginbfchar[\s\S]*?endbfchar/,
  'beginbfrange\n<4E2D> <4E2D> <4E2D>\n<6587> <6587> <6587>\n<6D4B> <6D4B> [<6D4B> <6D4B>]\nendbfrange'
).replace(/<8BD5> <8BD5>/g, '').replace(/beginbfchar/g, '');
const pdfB = buildCidPdf({
  contentHex: '4E2D65876D4B6D4B6587',
  toUnicodeText: CMap_BRANGE,
  compressToUnicode: true,
});
const etB = await pdfExtractText(pdfB);
console.log('\n== 场景 B: bfrange (base 递增 + dests 数组) + 压缩 ToUnicode ==');
console.log('-- extracted text --\n' + etB.text);
ok(/中文测测文/.test(etB.text), 'B: bfrange 还原出 "中文测测文"');

// ---- 场景 C：编码有空格 + 无 ToUnicode 回退 latin1 ----
const CMap_SPACE = CMap_SIMPLE.replace('<4E2D> <4E2D>', '<4E 2D> <4E 2D>');
const pdfC = buildCidPdf({ contentHex: '4E2D', toUnicodeText: CMap_SPACE });
const etC = await pdfExtractText(pdfC);
ok(/中/.test(etC.text), 'C: hex 含空格仍能映射出 "中"');

// 无 ToUnicode 的字体：走 latin1，不崩溃
const pdfC2 = buildCidPdf({ contentHex: '4142', toUnicodeText: null });
const etC2 = await pdfExtractText(pdfC2);
ok(etC2.pages.length === 1, 'C2: 无 ToUnicode 不崩溃');
ok(/AB/.test(etC2.text), 'C2: 无 ToUnicode 时 latin1 回退（AB）');

// ---- 场景 D：纯 ASCII Type1 PDF 不受影响（与主测试一致）----
// 简单复用主测试的类型1构造（不含 ToUnicode），断言输出仍是 Hello
function buildAsciiWithCidResources() {
  const contentOps = 'BT /F1 12 Tf 72 720 Td (Hello CID-safe) Tj ET\n';
  const flated = deflateSync(new TextEncoder().encode(contentOps));
  const doc = {};
  doc[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  doc[2] = '<< /Type /Pages /Count 1 /Kids [3 0 R] >>';
  doc[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  doc[4] = `<< /Length ${flated.length} /Filter /FlateDecode >>\nstream\n`;
  doc[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'; // 无 ToUnicode
  let pdf = '%PDF-1.4\n';
  const offsets = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${doc[i]}`;
    if (i === 4) pdf += Buffer.from(flated).toString('binary');
    pdf += '\nendstream\nendobj\n';
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return latin1Encode(pdf);
}
const etD = await pdfExtractText(buildAsciiWithCidResources());
ok(/Hello CID-safe/.test(etD.text), 'D: 纯 ASCII / Type1 仍走 latin1，不回归');
ok(etD.warnings.length === 0, 'D: 纯 ASCII 无警告');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);