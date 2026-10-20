// core/pdf2md.mjs
// 零依赖的纯 JS PDF 文本提取 + Markdown 化。
// 仅使用标准库能力（Node: node:zlib 做 FlateDecode；浏览器: DecompressionStream 回退）。
// 不依赖 pdfjs-dist，保证单个 exe 体积可控、可在 Node 与浏览器运行。
//
// 导出的纯函数（失败不抛异常，一律以 warnings 呈现）：
//   pdfExtractText(bytes) -> Promise<{ pages: string[], text: string, warnings: string[] }>
//   pdfExtractPages(bytes, { onPage }) -> Promise<string[]>
//   pdfToMarkdown(bytes)  -> Promise<{ markdown: string, pages: number, warnings: string[] }>
//
// 覆盖的 PDF 特性：
//   - 对象表解析（不依赖 xref，直接扫描 "N G obj ... endobj"）
//   - 间接引用 / 直接对象；dict / array / name / string(literal+hex) / number / stream
//   - FlateDecode（zlib / DecompressionStream），PNG Up/Sub 预测（可选的文本）
//   - ASCIIHexDecode
//   - 文本运算符 Tj / TJ(数组) / ' / " 以及 BT/ET 分块、Td/TD/Tm/T*/TL 换行
//   - 逐文本块按 y 聚类成物理行，行内按 x 排序
//   边界：identity-H 等自定义字体无标准 ToUnicode 时给出 warnings，不崩溃。

// 字符字节集（PDF 空白/分隔符）
const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

function isWS(b) { return WS.has(b); }
function isDigit(b) { return b >= 0x30 && b <= 0x39; }
function isHex(b) { return isDigit(b) || (b >= 0x61 && b <= 0x66) || (b >= 0x41 && b <= 0x46); }
function isDelim(b) {
  return b === 0x28 || b === 0x29 || b === 0x3c || b === 0x3e ||
    b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d ||
    b === 0x2f || b === 0x25;
}

// ---------------------------------------------------------------- Reader
class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.len = bytes.length;
  }
  peek(o = 0) { return this.pos + o < this.len ? this.bytes[this.pos + o] : -1; }
  skipWs() {
    while (this.pos < this.len) {
      const b = this.peek();
      if (b === 0x25) { // comment
        while (this.pos < this.len && this.peek() !== 0x0a && this.peek() !== 0x0d) this.pos++;
        continue;
      }
      if (isWS(b)) { this.pos++; continue; }
      break;
    }
  }
}

function readAtKeyword(r, kw) {
  // r.pos 已在关键字起始位置：按字节比对 kw，且后方必须是分隔符。
  const bytes = r.bytes;
  const e = new TextEncoder().encode(kw);
  if (r.pos + e.length > r.len) return false;
  for (let k = 0; k < e.length; k++) if (bytes[r.pos + k] !== e[k]) return false;
  const after = r.pos + e.length;
  if (after < r.len) {
    const a = bytes[after];
    if (!isDelim(a) && !isWS(a) && a !== 0x3e && a !== 0x5d && a !== 0x29 && a !== 0x2c) return false;
  }
  r.pos = after;
  return true;
}

function readNumber(r) {
  const bytes = r.bytes;
  const start = r.pos;
  let i = start;
  if (bytes[i] === 0x2b || bytes[i] === 0x2d) i++;
  let any = false;
  let dot = false;
  while (i < r.len) {
    const b = bytes[i];
    if (isDigit(b)) { i++; any = true; }
    else if (b === 0x2e && !dot) { dot = true; i++; }
    else break;
  }
  if (!any) { r.pos = i; return null; }
  const s = new TextDecoder('latin1').decode(bytes.subarray(start, i));
  r.pos = i;
  return parseFloat(s);
}

function readName(r) {
  const bytes = r.bytes;
  let i = r.pos;
  let s = '';
  while (i < r.len) {
    const b = bytes[i];
    if (isDelim(b) || isWS(b)) break;
    if (b === 0x23 && i + 2 < r.len && isHex(bytes[i + 1]) && isHex(bytes[i + 2])) {
      s += String.fromCharCode(parseInt(String.fromCharCode(bytes[i + 1]) + String.fromCharCode(bytes[i + 2]), 16));
      i += 3;
      continue;
    }
    s += String.fromCharCode(b);
    i++;
  }
  r.pos = i;
  return s;
}

function readBareword(r) {
  const bytes = r.bytes;
  let i = r.pos;
  let s = '';
  while (i < r.len) {
    const b = bytes[i];
    if (isDelim(b) || isWS(b)) break;
    s += String.fromCharCode(b);
    i++;
  }
  r.pos = i;
  return s;
}

function readLiteral(r) {
  // 调用处已在 '(' 之后
  const bytes = r.bytes;
  const out = [];
  let i = r.pos;
  while (i < r.len) {
    const b = bytes[i];
    if (b === 0x29) { i++; break; }
    if (b === 0x5c) {
      i++;
      if (i >= r.len) break;
      const e = bytes[i];
      if (e === 0x6e) { out.push(10); i++; continue; }
      if (e === 0x72) { out.push(13); i++; continue; }
      if (e === 0x74) { out.push(9); i++; continue; }
      if (e === 0x62) { out.push(8); i++; continue; }
      if (e === 0x66) { out.push(12); i++; continue; }
      if (e === 0x28 || e === 0x29 || e === 0x5c) { out.push(e); i++; continue; }
      if (e >= 0x30 && e <= 0x37) { // octal
        let val = e - 0x30, cnt = 1;
        while (cnt < 3 && i + 1 < r.len && bytes[i + 1] >= 0x30 && bytes[i + 1] <= 0x37) {
          val = val * 8 + (bytes[i + 1] - 0x30); i++; cnt++;
        }
        i++;
        out.push(val & 0xff);
        continue;
      }
      out.push(e); i++;
      continue;
    }
    out.push(b);
    i++;
  }
  r.pos = i;
  return new Uint8Array(out);
}

function readHexBytes(r) {
  const bytes = r.bytes;
  let i = r.pos;
  const out = [];
  let acc = -1;
  while (i < r.len) {
    const b = bytes[i];
    if (b === 0x3e) break;
    if (isWS(b)) { i++; continue; }
    if (isHex(b)) {
      const v = b <= 0x39 ? b - 0x30 : ((b & 0xdf) - 0x37);
      if (acc < 0) acc = v;
      else { out.push((acc << 4) | v); acc = -1; }
    }
    i++;
  }
  if (acc >= 0) out.push(acc << 4);
  r.pos = i;
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- Object parsing
function parseValue(r, objects) {
  r.skipWs();
  if (r.pos >= r.len) return { t: 'null' };
  const b = r.peek();
  if (b === 0x3c) {
    if (r.peek(1) === 0x3c) {
      r.pos += 2;
      const dict = {};
      for (;;) {
        r.skipWs();
        if (r.peek() === 0x3e && r.peek(1) === 0x3e) { r.pos += 2; break; }
        if (r.pos >= r.len) break;
        const key = parseValue(r, objects);
        if (key.t !== 'name') continue;
        const val = parseValue(r, objects);
        dict[key.v] = val;
      }
      return { t: 'dict', v: dict };
    }
    r.pos += 1;
    const hex = readHexBytes(r);
    if (r.peek() === 0x3e) r.pos++;
    return { t: 'str', v: hex };
  }
  if (b === 0x5b) {
    r.pos += 1;
    const arr = [];
    for (;;) {
      r.skipWs();
      if (r.peek() === 0x5d) { r.pos++; break; }
      if (r.pos >= r.len) break;
      arr.push(parseValue(r, objects));
    }
    return { t: 'arr', v: arr };
  }
  if (b === 0x2f) { r.pos += 1; return { t: 'name', v: readName(r) }; }
  if (b === 0x28) { r.pos += 1; return { t: 'str', v: readLiteral(r) }; }
  if (b === 0x2b || b === 0x2d || b === 0x2e || isDigit(b)) {
    // 可能是指针引用 "N G R"
    const pre = r.pos;
    const n1 = readNumber(r);
    if (n1 == null) { r.pos = pre; r.pos++; return { t: 'unknown', v: null }; }
    // 检查后面是否 "G R"（跳过空白）
    r.skipWs();
    if (isDigit(r.peek())) {
      const pre2 = r.pos;
      const n2 = readNumber(r);
      if (n2 != null && Number.isInteger(n2)) {
        r.skipWs();
        const pre3 = r.pos;
        const word = readBareword(r);
        if (word === 'R') return { t: 'ref', v: n1 }; // 用对象号引用，gen 忽略
        // 不是引用：回退到第二个数字处，保留 n1 作为数值（pos 停在 n2 开头前）
        r.pos = pre3;
      }
      r.pos = pre2;
      return { t: 'num', v: n1 };
    }
    return { t: 'num', v: n1 };
  }
  const wStart = r.pos;
  const word = readBareword(r);
  if (word === 'true') return { t: 'bool', v: true };
  if (word === 'false') return { t: 'bool', v: false };
  if (word === 'null') return { t: 'null' };
  // 裸关键字/未识别的分隔符：保证前向推进，避免死循环。
  if (word === '' || r.pos === wStart) r.pos++;
  return { t: 'unknown', v: word }; // 可能是裸关键字
}

// ---------------------------------------------------------------- Scan objects
function scanObjects(bytes) {
  const objects = {}; // num -> { dict, stream }
  const r = new Reader(bytes);
  let trailer = null;
  let iter = 0;
  while (r.pos < r.len) {
    if (++iter > bytes.length * 4 + 1000) { throw new Error('scanObjects 迭代超限 at ' + r.pos); }
    r.skipWs();
    if (r.pos >= r.len) break;
    const b = r.peek();
    if (isDigit(b) || b === 0x2b || b === 0x2d || b === 0x2e) {
      const pre = r.pos;
      const n1 = readNumber(r);
      if (n1 == null || !Number.isInteger(n1)) { r.pos = pre; r.pos++; continue; }
      r.skipWs();
      const pre2 = r.pos;
      const n2 = readNumber(r);
      if (n2 == null || !Number.isInteger(n2)) { r.pos = pre; r.pos++; continue; }
      r.skipWs();
      if (!readAtKeyword(r, 'obj')) {
        r.pos = pre;
        r.pos++;
        continue;
      }
      // === 对象体（可能带 stream）===
      const value = parseValue(r, objects);
      r.skipWs();
      let stream = null;
      if (readAtKeyword(r, 'stream')) {
        if (r.peek() === 0x0d) r.pos++;
        if (r.peek() === 0x0a) r.pos++;
        let length = -1;
        if (value.t === 'dict') {
          const lv = value.v['Length'];
          if (lv) {
            if (lv.t === 'num') length = lv.v;
            else if (lv.t === 'ref') { const o = objects[lv.v]; if (o) { const u = unwrap(o.value, objects); if (typeof u === 'number') length = u; } }
          }
        }
        if (length >= 0 && r.pos + length <= r.len) {
          stream = bytes.subarray(r.pos, r.pos + length);
          r.pos += length;
        } else {
          const start = r.pos;
          let i = r.pos;
          const e = new TextEncoder().encode('endstream');
          let found = -1;
          while (i <= r.len - e.length) {
            let m = true;
            for (let k = 0; k < e.length; k++) if (bytes[i + k] !== e[k]) { m = false; break; }
            if (m) { found = i; break; }
            i++;
          }
          stream = found >= 0 ? bytes.subarray(start, found) : bytes.subarray(start);
          r.pos = found >= 0 ? found : r.len;
        }
      }
      objects[String(n1)] = { value, stream };
      // 跳到 endobj
      while (r.pos < r.len) {
        if (readAtKeyword(r, 'endobj')) break;
        r.pos++;
      }
      continue;
    }
    const pre = r.pos;
    const word = readBareword(r);
    if (word === 'trailer') {
      const t = parseValue(r, objects);
      if (t.t === 'dict') trailer = t;
    } else if (word === '' || r.pos === pre) {
      r.pos++; // 未识别字符，前向推进防死循环
    }
    // xref / startxref 等关键字忽略（对象扫描不依赖 xref）
  }
  return { objects, trailer };
}

function unwrap(v, objects, depth = 0) {
  if (v == null) return null;
  if (depth > 30) return null;
  switch (v.t) {
    case 'num': case 'name': case 'bool': return v.v;
    case 'str': return v.v; // Uint8Array
    case 'null': case 'unknown': return null;
    case 'ref': {
      const o = objects[v.v];
      return o ? unwrap(o.value, objects, depth + 1) : null;
    }
    case 'arr': return v.v.map((x) => unwrap(x, objects, depth + 1));
    case 'dict': {
      const out = {};
      for (const k of Object.keys(v.v)) out[k] = unwrap(v.v[k], objects, depth + 1);
      return out;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- Stream decompression
let inflateFn = undefined;
async function getInflate() {
  if (inflateFn !== undefined) return inflateFn;
  // Node
  try {
    if (typeof process === 'object' && process.versions && process.versions.node) {
      const { inflateSync } = await import('node:zlib');
      inflateFn = (data) => new Uint8Array(inflateSync(Buffer.from(data)));
      return inflateFn;
    }
  } catch (_) { /* ignore */ }
  // 浏览器
  if (typeof DecompressionStream !== 'undefined') {
    inflateFn = async (data) => {
      const ds = new DecompressionStream('deflate');
      const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(buf);
    };
    return inflateFn;
  }
  inflateFn = null;
  return null;
}

function pngPredictor(buf, parms) {
  if (!parms) return null;
  const Predictor = parms.Predictor;
  if (Predictor !== 15 && Predictor !== 2) return null;
  if (parms.BitsPerComponent !== 8) return null;
  const colors = parms.Colors || 1;
  const columns = parms.Columns || 1;
  const rowbytes = Math.ceil((columns * colors * 8) / 8);
  const stride = rowbytes + 1; // 每行前 1 字节 filter tag
  const nrows = Math.floor(buf.length / stride);
  if (nrows < 1) return null;
  const out = new Uint8Array(nrows * rowbytes);
  const prev = new Uint8Array(rowbytes);
  for (let r = 0; r < nrows; r++) {
    const tag = buf[r * stride];
    const cur = new Uint8Array(rowbytes);
    for (let c = 0; c < rowbytes; c++) {
      const raw = buf[r * stride + 1 + c];
      const left = c >= colors ? cur[c - colors] : 0;
      const up = prev[c];
      let v;
      if (tag === 0) v = raw;
      else if (tag === 1) v = raw + left;
      else if (tag === 2) v = raw + up;
      else if (tag === 3) v = raw + Math.floor((left + up) / 2);
      else if (tag === 4) v = raw + paeth(left, up, c >= colors ? prev[c - colors] : 0);
      else return null;
      cur[c] = v & 0xff;
    }
    out.set(cur, r * rowbytes);
    prev.set(cur);
  }
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function decodeStream(stream, value, objects, warnings) {
  if (!stream) return null;
  let data = new Uint8Array(stream);
  if (value.t !== 'dict') return null;
  const fv = value.v['Filter'];
  const filters = [];
  if (fv) {
    const v = unwrap(fv, objects);
    if (Array.isArray(v)) filters.push(...v.map((x) => String(x)));
    else if (typeof v === 'string') filters.push(v);
  }
  for (const f of filters) {
    if (data == null) break;
    if (f === 'FlateDecode' || f === 'Fl') {
      const infl = await getInflate();
      if (!infl) { warnings.push('无可用 inflate 实现，FlateDecode 流无法解压'); data = null; break; }
      try {
        const raw = await infl(data);
        const parms = unwrap(value.v['DecodeParms'] || value.v['DP'], objects) || undefined;
        data = pngPredictor(raw, parms) || raw;
      } catch (e) {
        warnings.push(`FlateDecode 解压失败：${e && e.message ? e.message : String(e)}`);
        data = null;
        break;
      }
    } else if (f === 'ASCIIHexDecode' || f === 'AHx') {
      // 已是文本? 实际是 ASCII hex 流，这里二次解析很少见，跳过
      warnings.push('ASCIIHexDecode 流未二次解码');
      data = null;
    } else {
      warnings.push(`不支持的过滤器 ${f}，流被跳过`);
      data = null;
    }
  }
  return data;
}

// ---------------------------------------------------------------- ToUnicode CMap
// 把一段 hex(es) 字符串（可能含空白/补位）转成字节。
function cidHexStrToBytes(s) {
  const clean = s.replace(/\s+/g, '');
  const out = new Uint8Array(Math.ceil(clean.length / 2));
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);
    out[i >> 1] = Number.isNaN(byte) ? 0 : byte;
  }
  return out;
}
function bytesToIntNo(b) {
  let v = 0;
  for (let i = 0; i < b.length; i++) v = v * 256 + b[i];
  return v;
}
// UTF-16BE 字面量 → JS 字符串（长度须为 2 的倍数，否则回退 latin1）。
function cidUnicodeString(bytes) {
  if (bytes.length % 2 === 0) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return new TextDecoder('latin1').decode(bytes);
}
// 提取 body 里的 `<hex>` token 与 `[<hex> ...]` 数组组，用于 bfrange 行解析。
function cidTokenizeRows(body) {
  const items = [];
  const re = /\[([\s\S]*?)\]|<([0-9a-fA-F\s]+)>/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) {
      const inner = [];
      const hre = /<([0-9a-fA-F\s]+)>/g;
      let hm;
      while ((hm = hre.exec(m[1]))) inner.push(cidHexStrToBytes(hm[1]));
      items.push({ arr: inner });
    } else {
      items.push({ hex: cidHexStrToBytes(m[2]) });
    }
  }
  return items;
}

// 解析 /ToUnicode CMap 流（bfchar/bfrange/codespacerange）。
// 返回 { bfchar: Map<int,string>, bfrange: [{lo,hi,base|dests}], codespaces: [{len,lo,hi}] } 或 null。
// 纯函数，失败返回 null 不抛。
function parseToUnicodeCMap(cmapBytes) {
  try {
    if (!cmapBytes || !cmapBytes.length) return null;
    const text = new TextDecoder('latin1').decode(cmapBytes);
    const result = { bfchar: new Map(), bfrange: [], codespaces: [] };

    const sections = [];
    for (const key of ['codespacerange', 'bfchar', 'bfrange']) {
      const re = new RegExp('begin' + key + '([\\s\\S]*?)end' + key, 'g');
      let m;
      while ((m = re.exec(text))) sections.push({ key, body: m[1] });
    }
    for (const sec of sections) {
      const items = sec.key === 'bfrange' ? cidTokenizeRows(sec.body) : cidTokenizeRows(sec.body);
      if (sec.key === 'codespacerange') {
        let i = 0;
        while (i + 1 < items.length) {
          const a = items[i], b = items[i + 1];
          if (a.hex && b.hex) {
            result.codespaces.push({ len: Math.max(a.hex.length, b.hex.length), lo: bytesToIntNo(a.hex), hi: bytesToIntNo(b.hex) });
            i += 2;
          } else i += 1;
        }
      } else if (sec.key === 'bfchar') {
        let i = 0;
        while (i + 1 < items.length) {
          const a = items[i], b = items[i + 1];
          if (a.hex && b.hex) {
            result.bfchar.set(bytesToIntNo(a.hex), cidUnicodeString(b.hex));
            i += 2;
          } else i += 1;
        }
      } else {
        // bfrange：三折组 lo,hi,dst
        let i = 0;
        while (i + 2 < items.length) {
          const a = items[i], b = items[i + 1], c = items[i + 2];
          if (a.hex && b.hex && (c.hex || c.arr)) {
            const lo = bytesToIntNo(a.hex), hi = bytesToIntNo(b.hex);
            if (c.arr) result.bfrange.push({ lo, hi, dests: c.arr.map((d) => cidUnicodeString(d)) });
            else result.bfrange.push({ lo, hi, base: bytesToIntNo(c.hex) });
            i += 3;
          } else i += 1;
        }
      }
    }
    if (!result.bfchar.size && !result.bfrange.length) return null;
    return result;
  } catch (_e) {
    return null;
  }
}

// 依据 codespaces 把原始字节切成 CID 码点序列（identity-H 通常是 2 字节）。
function cidSegmentCodePoints(cmap, bytes) {
  let lengths = [];
  if (cmap.codespaces && cmap.codespaces.length) {
    const set = new Set();
    for (const cs of cmap.codespaces) set.add(cs.len);
    lengths = Array.from(set);
  } else {
    lengths.push(2); // identity-H 默认 2 字节
  }
  lengths.sort((a, b) => a - b);
  const cps = [];
  let i = 0;
  while (i < bytes.length) {
    let chosen = null;
    for (const len of lengths) {
      if (i + len <= bytes.length) {
        const cp = bytesToIntNo(bytes.subarray(i, i + len));
        const ok = cmap.codespaces && cmap.codespaces.length
          ? cmap.codespaces.some((cs) => cs.len === len && cp >= cs.lo && cp <= cs.hi)
          : true;
        if (ok) { chosen = cp; i += len; cps.push(chosen); break; }
      }
    }
    if (chosen === null) { cps.push(bytes[i]); i += 1; }
  }
  return cps;
}
function cidLookupCode(cmap, cp) {
  if (cmap.bfchar.has(cp)) return cmap.bfchar.get(cp);
  for (const r of cmap.bfrange) {
    if (cp >= r.lo && cp <= r.hi) {
      if (Array.isArray(r.dests)) {
        const d = r.dests[cp - r.lo];
        return d != null ? d : '';
      }
      return String.fromCharCode(r.base + (cp - r.lo));
    }
  }
  return '';
}
// CMap → bytesToUnicode 函数
function cmapToDecoder(cmap) {
  return (bytes) => {
    const cps = cidSegmentCodePoints(cmap, bytes);
    let out = '';
    for (const cp of cps) out += cidLookupCode(cmap, cp);
    return out;
  };
}

// ---------------------------------------------------------------- Content text ops
// tokenize 内容流为 [operand|keyword] 序列
function tokenizeContent(content) {
  const r = new Reader(content);
  const toks = [];
  while (r.pos < r.len) {
    const b = r.peek();
    if (isWS(b) || b === 0x25) {
      if (b === 0x25) { while (r.pos < r.len && r.peek() !== 0x0a && r.peek() !== 0x0d) r.pos++; }
      else r.pos++;
      continue;
    }
    if (b === 0x28) { r.pos++; toks.push({ op: 'SN', v: readLiteral(r), x: r.pos }); continue; }
    if (b === 0x3c) { r.pos++; toks.push({ op: 'SH', v: readHexBytes(r), x: r.pos }); if (r.peek() === 0x3e) r.pos++; continue; }
    if (b === 0x5b) {
      r.pos++;
      const arr = [];
      for (;;) {
        if (r.peek() === 0x5d) { r.pos++; break; }
        if (r.pos >= r.len) break;
        const nb = r.peek();
        if (isDigit(nb) || nb === 0x2b || nb === 0x2d || nb === 0x2e) { const n = readNumber(r); if (n != null) arr.push({ kind: 'num', v: n }); }
        else if (nb === 0x28) { r.pos++; arr.push({ kind: 'str', v: readLiteral(r) }); }
        else if (nb === 0x3c) { r.pos++; arr.push({ kind: 'str', v: readHexBytes(r) }); if (r.peek() === 0x3e) r.pos++; }
        else r.pos++;
      }
      toks.push({ op: 'AR', v: arr, x: r.pos });
      continue;
    }
    if (b === 0x2f) { r.pos++; toks.push({ op: 'NM', v: readName(r), x: r.pos }); continue; }
    if (isDigit(b) || b === 0x2b || b === 0x2d || b === 0x2e) {
      const n = readNumber(r);
      if (n != null) toks.push({ op: 'NU', v: n, x: r.pos });
      continue;
    }
    const w = readBareword(r);
    if (w) toks.push({ op: w, v: null, x: r.pos });
  }
  return toks;
}

// 执行内容流，产出 textpieces 数组 [{ text, x, y, size, fontName, chars }]
// fontDecoder: 可选 { 字体名: bytesToUnicodeFn }。当前字体有 decoder 时用它还原，否则 latin1 回退。
function extractTextPieces(contentBytes, warnings, fontDecoder = null) {
  const toks = tokenizeContent(contentBytes);
  const pieces = [];
  // 文本状态
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let size = 0;
  let leading = 14;
  let fontName = null;
  let inText = false;
  let stack = [];
  let textBlock = []; // 当前 (T*) 段的 pieces
  let pendingBreak = false;

  const flushBlock = () => { textBlock = []; };

  function showString(bytes) {
    if (inText) {
      let s = null;
      if (fontName && fontDecoder && typeof fontDecoder[fontName] === 'function') {
        try {
          s = fontDecoder[fontName](bytes);
        } catch (_e) { s = null; }
      }
      if (s == null) s = new TextDecoder('latin1').decode(bytes);
      if (s.length) {
        pieces.push({ text: s, x: tm[4], y: tm[5], size, fontName, chars: bytes });
      }
    }
  }

  for (const t of toks) {
    const op = t.op;
    if (op === 'BT') { inText = true; tm = [1,0,0,1,0,0]; tlm = [1,0,0,1,0,0]; textBlock = []; pendingBreak = false; stack = []; continue; }
    if (op === 'ET') { inText = false; stack = []; continue; }
    if (op === 'NU' || op === 'NM' || op === 'SN' || op === 'SH' || op === 'AR') { stack.push(t); continue; }
    // operator
    switch (op) {
      case 'Tf': {
        // 操作数：<font名> <size>（顺序可能是 /F1 24 或 24 /F1）。
        let fn = null, sz = null;
        for (const tok of stack) {
          if (tok.op === 'NM') fn = tok.v;
          else if (tok.op === 'NU') sz = tok.v;
        }
        fontName = fn;
        if (typeof sz === 'number') size = sz;
        stack = [];
        break;
      }
      case 'Td': case 'TD': {
        const tx = stack[stack.length - 2] ? Number(stack[stack.length - 2].v) : 0;
        const ty = stack[stack.length - 1] ? Number(stack[stack.length - 1].v) : 0;
        tlm[4] += tx; tlm[5] += ty;
        if (op === 'TD') leading = -ty;
        tm = tlm.slice();
        stack = [];
        pendingBreak = true;
        break;
      }
      case 'Tm': {
        const a = stack[0] ? Number(stack[0].v) : 1, b = stack[1] ? Number(stack[1].v) : 0;
        const c = stack[2] ? Number(stack[2].v) : 0, d = stack[3] ? Number(stack[3].v) : 1;
        const e = stack[4] ? Number(stack[4].v) : 0, f = stack[5] ? Number(stack[5].v) : 0;
        tm = [a, b, c, d, e, f]; tlm = tm.slice();
        stack = [];
        pendingBreak = true;
        break;
      }
      case 'T*': {
        tlm[5] -= leading; tm = tlm.slice(); stack = [];
        pendingBreak = true;
        break;
      }
      case 'TL': {
        const l = stack[stack.length - 1]; leading = l ? Number(l.v) : leading; stack = [];
        break;
      }
      case 'Tj': {
        const s = stack[stack.length - 1];
        if (s && (s.op === 'SN' || s.op === 'SH')) showString(s.v);
        stack = [];
        break;
      }
      case 'TJ': {
        const s = stack[stack.length - 1];
        if (s && s.op === 'AR') {
          for (const it of s.v) if (it.kind === 'str') showString(it.v);
        }
        stack = [];
        break;
      }
      case "'": {
        if (inText) { tlm[5] -= leading; tm = tlm.slice(); stack = []; }
        const s = stack[stack.length - 1];
        if (s && (s.op === 'SN' || s.op === 'SH')) showString(s.v);
        stack = [];
        pendingBreak = true;
        break;
      }
      case '"': {
        if (inText) { tlm[5] -= leading; tm = tlm.slice(); stack = []; }
        const s = stack[stack.length - 1];
        if (s && (s.op === 'SN' || s.op === 'SH')) showString(s.v);
        stack = [];
        pendingBreak = true;
        break;
      }
      case 'Tc': case 'Tw': case 'Tz': case 'Tr': case 'Ts': {
        // 调整类操作符，仅消费操作数
        if (stack.length) {
          const arr = stack.find((x) => x.op === 'AR');
          // 简单消费栈，不做间距计算
        }
        stack = [];
        break;
      }
      case 'CM': case 'cm': {
        // 图形矩阵，影响 x/y。这里为简化不做精确变换，直接消费。
        stack = [];
        break;
      }
      case 'GS': case 'cs': case 'CS': case 'RG': case 'rg': case 'K': case 'k': case 'G': case 'g': case 'sc': case 'SC': case 'sh': case 'w': case 'J': case 'j': case 'M': case 'd': case 'Do': case 'BI': case 'ID': case 'EI': case 'BDC': case 'BMC': case 'EMC': case 'q': case 'Q': case 're': case 'f': case 'F': case 'S': case 'n': case 'm': case 'l': case 'c': case 'h': case 'b': case 's': case 'W': {
        stack = [];
        break;
      }
      default: stack = [];
    }
  }
  void flushBlock; void fontName;
  return pieces;
}

// 把 pieces 聚合成物理行：按 y 聚类（容差随字号），行内按 x 排序；行按 y 降序
function assembleLines(pieces) {
  const lines = [];
  for (const p of pieces) {
    const tol = Math.max(1.5, Math.abs(p.size || 10) * 0.3);
    let dest = null;
    for (const ln of lines) if (Math.abs(ln.y - p.y) <= tol) { dest = ln; break; }
    if (!dest) { dest = { y: p.y, pieces: [] }; lines.push(dest); }
    dest.pieces.push(p);
  }
  for (const ln of lines) ln.pieces.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b.y - a.y);
  return lines.map((ln) => ln.pieces.map((p) => p.text).join(''));
}

// ---------------------------------------------------------------- Page extraction
// 遍历基于"原始解析节点"（保留 ref / stream），避免 unwrap 丢失流信息。
function nodeDictVal(raw, objects) {
  if (!raw) return null;
  let cur = raw;
  let depth = 0;
  while (cur.t === 'ref' && depth < 30) { const o = objects[String(cur.v)]; if (!o) return null; cur = o.value; depth++; }
  return cur.t === 'dict' ? cur : null;
}
function nodeArray(raw, objects) {
  if (!raw) return null;
  let cur = raw;
  let depth = 0;
  while (cur.t === 'ref' && depth < 30) { const o = objects[String(cur.v)]; if (!o) return null; cur = o.value; depth++; }
  return cur.t === 'arr' ? cur.v : null;
}

function collectPagesRaw(pagesNode, objects, out, depth) {
  if (depth > 64) return;
  const dict = nodeDictVal(pagesNode, objects);
  if (!dict) {
    const arr = nodeArray(pagesNode, objects);
    if (arr) for (const kid of arr) collectPagesRaw(kid, objects, out, depth + 1);
    return;
  }
  const typeRaw = dict.v['Type'];
  const type = typeRaw ? unwrap(typeRaw, objects) : null;
  if (type === 'Page') { out.push(pagesNode); return; }
  const kidsArr = nodeArray(dict.v['Kids'], objects);
  if (kidsArr) for (const kid of kidsArr) collectPagesRaw(kid, objects, out, depth + 1);
}

async function pageTexts(bytes, objects, trailer, warnings) {
  let rootNode = null;
  if (trailer && trailer.v && trailer.v['Root']) rootNode = trailer.v['Root'];
  if (!rootNode) {
    for (const key of Object.keys(objects)) {
      const o = objects[key];
      if (o.value.t === 'dict') {
        const tRaw = o.value.v['Type'];
        const t = tRaw ? unwrap(tRaw, objects) : null;
        if (t === 'Catalog') { rootNode = o.value; break; }
      }
    }
  }
  if (!rootNode) { warnings.push('未找到 PDF 目录对象'); return []; }
  const rootDict = nodeDictVal(rootNode, objects);
  if (!rootDict || !rootDict.v['Pages']) { warnings.push('未找到 PDF 页面树（Root/Pages 缺失）'); return []; }
  const pageNodes = [];
  collectPagesRaw(rootDict.v['Pages'], objects, pageNodes, 0);
  const pages = [];
  for (const pnode of pageNodes) {
    pages.push(await onePageText(pnode, objects, warnings));
  }
  return pages;
}

async function onePageText(pageNode, objects, warnings) {
  const allPieces = [];
  const pageDict = nodeDictVal(pageNode, objects);
  // 收集 Font 资源（沿 Page 树父节点继承，父节点的 Resources 覆盖子节点的）。
  const fontRawMap = {}; // 字体名 -> 原始 ref/dict 节点
  (function collectFonts(node) {
    if (!node) return;
    const dict = nodeDictVal(node, objects);
    if (!dict) return;
    if (dict.v['Resources']) {
      const res = nodeDictVal(dict.v['Resources'], objects);
      if (res && res.v['Font']) {
        const fontDict = nodeDictVal(res.v['Font'], objects);
        if (fontDict) for (const fn of Object.keys(fontDict.v)) if (!(fn in fontRawMap)) fontRawMap[fn] = fontDict.v[fn];
      }
    }
    const parentRaw = dict.v['Parent'];
    if (parentRaw) collectFonts(parentRaw);
  })(pageNode);
  // 为每个字体解析 /ToUnicode → bytesToUnicode 函数。
  const fontDecoder = {};
  for (const fn of Object.keys(fontRawMap)) {
    const fdict = nodeDictVal(fontRawMap[fn], objects);
    if (!fdict) continue;
    const toUnicodeRaw = fdict.v['ToUnicode'];
    if (!toUnicodeRaw) continue;
    const tuNode = nodeDictVal(toUnicodeRaw, objects);
    if (!tuNode) continue;
    const tuRefObj = objects[String(toUnicodeRaw.v)];
    const stream = tuRefObj && tuRefObj.stream ? tuRefObj.stream : (tuNode && tuNode.stream);
    if (stream == null) continue;
    const dec = await decodeStream(stream, tuNode, objects, warnings);
    if (dec == null) continue;
    const cmap = parseToUnicodeCMap(dec);
    if (cmap) fontDecoder[fn] = cmapToDecoder(cmap);
  }
  const contentRaw = pageDict ? pageDict.v['Contents'] : null;
  const processContent = (raw, depth) => {
    if (depth > 20 || !raw) return;
    if (raw.t === 'ref') {
      const o = objects[String(raw.v)];
      if (o && o.stream) { allPieces.push(o); }
      return;
    }
    if (raw.t === 'arr') for (const it of raw.v) processContent(it, depth + 1);
  };
  if (contentRaw) processContent(contentRaw, 0);
  const pieces = [];
  for (const o of allPieces) {
    const dec = await decodeStream(o.stream, o.value, objects, warnings);
    if (dec) pieces.push(...extractTextPieces(dec, warnings, fontDecoder));
  }
  return assembleLines(pieces).join('\n');
}

// ---------------------------------------------------------------- Markdownize
function markdownizePage(pageText) {
  if (!pageText) return '';
  const raw = pageText.split('\n').map((l) => l.trimEnd());
  const out = [];
  let prevBlank = true;
  for (const line of raw) {
    const t = line.trim();
    if (t === '') { if (!prevBlank) out.push(''); prevBlank = true; continue; }
    prevBlank = false;
    const heading = detectHeading(t);
    if (heading) { out.push('#'.repeat(heading) + ' ' + t); }
    else if (isList(t)) out.push(listenize(t));
    else if (/^ {4,}/.test(line) && !isList(t)) out.push('    ' + t);
    else out.push(t);
  }
  // 去掉首尾空行
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function detectHeading(t) {
  // 纯文本无字号信息，用结构启发式：较短 + 以大写/数字开头 + 不以常见句子/列表/URL开头
  if (t.length === 0 || t.length > 72) return 0;
  if (/https?:\/\//i.test(t)) return 0;
  if (/^[-•·*\d(①-⑩]/.test(t.replace(/\s+$/, ''))) return 0;
  if (t.endsWith('.')) return 0;
  if (/^[A-Z0-9]/.test(t)) return 2;
  return 0;
}

function isList(t) {
  return /^[-•·*]\s/.test(t) || /^\(\d+\)\s/.test(t) || /^\d+[.)]\s/.test(t) || /^[①-⑩]/.test(t);
}
function listenize(t) {
  let m;
  if ((m = /^[-•·*]\s+(.*)$/.exec(t))) return '- ' + m[1];
  if ((m = /^\((\d+)\)\s+(.*)$/.exec(t))) return `${m[1]}. ` + m[2];
  if ((m = /^(\d+)[.)]\s+(.*)$/.exec(t))) return `${m[1]}. ` + m[2];
  const cj = { '①':'1.', '②':'2.', '③':'3.', '④':'4.', '⑤':'5.', '⑥':'6.', '⑦':'7.', '⑧':'8.', '⑨':'9.', '⑩':'10.' };
  const mm = cj[t[0]];
  if (mm) return mm + ' ' + t.slice(1).trim();
  return t;
}

// ---------------------------------------------------------------- Public API
function encodeWarning(pages, warnings) {
  // identity-H 字体：字节落在高半区但无法映射为可读文本。
  // 适度检测：若存在非标准控制位且似乱码比例高，给出警告（不阻止返回）。
  let weird = 0, total = 0;
  for (const pg of pages) {
    for (const ch of pg) {
      if (/[^\x00-\x7F\u0080-\u024F\u4E00-\u9FFF\uFF00-\uFFEF\u3000-\u303F\u2000-\u206F\s]/.test(ch)) weird++;
      if (!/\s/.test(ch)) total++;
    }
  }
  if (total > 20 && weird / total > 0.5) {
    warnings.push('此 PDF 使用非标准文本编码（疑似 identity-H/CID 字体），提取的文本可能为乱码。');
  }
}

export async function pdfExtractText(bytes) {
  const warnings = [];
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { pages: [], text: '', warnings: ['无效输入：bytes 必须是 Uint8Array 且非空'] };
  }
  let pages;
  try {
    const { objects, trailer } = scanObjects(bytes);
    pages = await pageTexts(bytes, objects, trailer, warnings);
  } catch (e) {
    warnings.push(`PDF 解析异常：${e && e.message ? e.message : String(e)}`);
    return { pages: [], text: '', warnings, error: 'parse-failed' };
  }
  encodeWarning(pages, warnings);
  return { pages, text: pages.join('\n\n'), warnings };
}

export async function pdfExtractPages(bytes, { onPage } = {}) {
  const warnings = [];
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return [];
  }
  let pages;
  try {
    const { objects, trailer } = scanObjects(bytes);
    pages = await pageTexts(bytes, objects, trailer, warnings);
  } catch (_e) {
    return [];
  }
  pages.forEach((t, i) => { if (onPage) onPage({ page: i + 1, text: t }); });
  return pages;
}

export async function pdfToMarkdown(bytes) {
  const warnings = [];
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { markdown: '', pages: 0, warnings: ['无效输入：bytes 必须是 Uint8Array 且非空'] };
  }
  let pages;
  try {
    const { objects, trailer } = scanObjects(bytes);
    pages = await pageTexts(bytes, objects, trailer, warnings);
  } catch (e) {
    warnings.push(`PDF 解析异常：${e && e.message ? e.message : String(e)}`);
    return { markdown: '', pages: 0, warnings };
  }
  encodeWarning(pages, warnings);
  const parts = pages.map((p, i) => (i === 0 ? '' : '\n\n---\n\n') + markdownizePage(p));
  const md = parts.join('').replace(/^\n+/, '');
  return { markdown: md, pages: pages.length, warnings };
}

export default { pdfExtractText, pdfExtractPages, pdfToMarkdown };