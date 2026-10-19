#!/usr/bin/env node
// feat2: font enumeration via document.fonts + @font-face probing in ui/app.js
const { readFileSync, writeFileSync } = await import('node:fs');
let s = readFileSync('ui/app.js', 'utf8');

// Insert after applyConfig function (after line 305's closing brace)
const anchor = "  }\n\n  // ---- mermaid (ON-DEMAND)";
if (s.indexOf(anchor) < 0) { console.log('ANCHOR not found'); process.exit(1); }

const fontBlock =
  "  }\n" +
  "\n" +
  "  // ---- font enumeration (system fonts probe) ---------------------------------\n" +
  "  // document.fonts.check() returns true for fonts the system actually has.\n" +
  "  // We probe a list of common CJK + Latin fonts and populate a dropdown with\n" +
  "  // only the ones present on this machine.\n" +
  "  var KNOWN_FONTS = [\n" +
  "    ['SimSun', '\u4eff\u5b8b\u4f53', 'SimSun'],\n" +
  "    ['SimHei', '\u9ed1\u4f53', 'SimHei'],\n" +
  "    ['Microsoft YaHei', '\u5fae\u8f6f\u96c5\u9ed1', 'Microsoft YaHei'],\n" +
  "    ['Microsoft YaHei UI', '\u5fae\u8f6f\u96c5\u9ed1 UI', 'Microsoft YaHei UI'],\n" +
  "    ['KaiTi', '\u6977\u4f53', 'KaiTi'],\n" +
  "    ['FangSong', '\u65b9\u6b63', 'FangSong'],\n" +
  "    ['DengXian', '\u7b49\u7ebf', 'DengXian'],\n" +
  "    ['Consolas', 'Consolas', 'Consolas'],\n" +
  "    ['Courier New', 'Courier New', 'Courier New'],\n" +
  "    ['Segoe UI', 'Segoe UI', 'Segoe UI'],\n" +
  "    ['Arial', 'Arial', 'Arial'],\n" +
  "    ['Georgia', 'Georgia', 'Georgia'],\n" +
  "    ['Verdana', 'Verdana', 'Verdana'],\n" +
  "    ['Trebuchet MS', 'Trebuchet MS', 'Trebuchet MS'],\n" +
  "    ['Impact', 'Impact', 'Impact'],\n" +
  "    ['Comic Sans MS', 'Comic Sans MS', 'Comic Sans MS'],\n" +
  "    ['Lucida Console', 'Lucida Console', 'Lucida Console'],\n" +
  "    ['Palatino', 'Palatino', 'Palatino'],\n" +
  "    ['Garamond', 'Garamond', 'Garamond'],\n" +
  "    ['Times New Roman', 'Times New Roman', 'Times New Roman'],\n" +
  "    ['Menlo', 'Menlo', 'Menlo'],\n" +
  "    ['Monaco', 'Monaco', 'Monaco'],\n" +
  "    ['Source Code Pro', 'Source Code Pro', 'Source Code Pro'],\n" +
  "    ['Fira Code', 'Fira Code', 'Fira Code'],\n" +
  "    ['JetBrains Mono', 'JetBrains Mono', 'JetBrains Mono'],\n" +
  "    ['Noto Sans CJK SC', 'Noto Sans CJK SC', 'Noto Sans CJK SC'],\n" +
  "    ['Noto Serif CJK SC', 'Noto Serif CJK SC', 'Noto Serif CJK SC'],\n" +
  "  ];\n" +
  "  var fontCache = null;\n" +
  "  function availableFonts() {\n" +
  "    if (fontCache) return fontCache;\n" +
  "    fontCache = [];\n" +
  "    try {\n" +
  "      KNOWN_FONTS.forEach(function (f) {\n" +
  "        var ok = false;\n" +
  "        try { ok = document.fonts.check('12px ' + f[0]); } catch (e) {}\n" +
  "        if (ok) fontCache.push(f[0]);\n" +
  "      });\n" +
  "    } catch (e) {\n" +
  "      // fall back: just include the default list\n" +
  "      KNOWN_FONTS.forEach(function (f) { fontCache.push(f[0]); });\n" +
  "    }\n" +
  "    return fontCache;\n" +
  "  }\n" +
  "\n" +
  "  // ---- mermaid (ON-DEMAND)";

s = s.replace(anchor, fontBlock, 1);

// Now update renderFontSelect to use availableFonts when the list is empty or stale
const oldFontSelect = "    var list = FONTS;";
const newFontSelect = "    // Prefer system-detected fonts over the built-in list when available\n" +
  "    var sysF = availableFonts();\n" +
  "    var list = sysF.length ? sysF.map(function (f) { return [f, f, f]; }) : FONTS;";

if (s.indexOf(oldFontSelect) < 0) { console.log('renderFontSelect anchor not found'); process.exit(1); }
s = s.replace(oldFontSelect, newFontSelect, 1);

writeFileSync('ui/app.js', s);
console.log('feat2 done');
