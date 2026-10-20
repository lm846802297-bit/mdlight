// latex2md.mjs
// Best-effort LaTeX -> Markdown converter. Pure, side-effect-free, no imports.
// Works in Node and in the browser (esbuild-bundled).
//
// Input:  LaTeX source text (.tex).
// Output: Markdown text.

// Matches the argument of a LaTeX command, i.e. `{...}` with brace balance,
// returning [full, inner]. `{a{b}c{..}d}` handles nested braces.
function matchBrace(str, start) {
  // str[start] must be '{'
  if (start >= str.length || str[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { full: str.slice(start, i + 1), inner: str.slice(start + 1, i), end: i + 1 };
      }
    } else if (c === "\\") {
      i++; // skip escaped char
    }
  }
  return null; // unbalanced
}

// Recursive cursor-based parser for inline LaTeX content.
// Engine of processInline. A single Frame object carries the cursor state.
const CMD_RE = /^\\(?:textbf|textit|texttt|emph|href|url|includegraphics|footnote|ref|cite)/;

function parseRun(fr) {
  const { str, atoms } = fr;
  const n = fr.str.length;
  while (fr.pos < n) {
    const c = str[fr.pos];
    // math atom marker (tokenized earlier in processInline)
    if (c === "\u0000") {
      const endM = str.indexOf("\u0000", fr.pos + 1);
      if (endM !== -1) {
        fr.out += atoms[+str.slice(fr.pos + 1, endM)];
        fr.pos = endM + 1;
        continue;
      }
    }
    if (c === "~") { fr.out += " "; fr.pos++; continue; }
    if (c === "%") { fr.pos++; continue; } // stray comment glyph (non-command) dropped
    if (c !== "\\") { fr.out += c; fr.pos++; continue; }

    const m = CMD_RE.exec(str.slice(fr.pos));
    if (!m) {
      // react to LaTeX escape char
      const nxt = str[fr.pos + 1];
      if (nxt === "%") { fr.out += "%"; fr.pos += 2; continue; }
      if (nxt === "_") { fr.out += "_"; fr.pos += 2; continue; }
      if (nxt === "&") { fr.out += "&"; fr.pos += 2; continue; }
      if (nxt === "#") { fr.out += "#"; fr.pos += 2; continue; }
      if (nxt === "~") { fr.out += " "; fr.pos += 2; continue; }
      if (nxt === "$") { fr.out += "$"; fr.pos += 2; continue; }
      if (nxt === "{") { fr.out += "{"; fr.pos += 2; continue; }
      if (nxt === "}") { fr.out += "}"; fr.pos += 2; continue; }
      fr.out += "\\"; fr.pos++; continue; // unknown escape, keep backslash
    }
    const cmd = m[0];
    if (cmd === "\\footnote") {
      const b = matchBrace(str, fr.pos + cmd.length);
      if (b) { fr.pos = b.end; continue; } // strip footnote
    }
    fr.pos += cmd.length;
    // skip optional "[...]" argument (e.g. \includegraphics[width=..]{file})
    while (str[fr.pos] === "[") {
      const close = fr.str.indexOf("]", fr.pos + 1);
      if (close === -1) break;
      fr.pos = close + 1;
    }
    const b = matchBrace(fr.str, fr.pos);
    if (!b) { fr.out += cmd; continue; }

    if (cmd === "\\textbf") {
      // body = within the braces; b.end is index just after closing brace
      const body = fr.str.slice(fr.pos + 1, b.end - 1);
      fr.out += "**" + parseStandalone(body, fr.atoms) + "**";
      fr.pos = b.end;
    } else if (cmd === "\\textit" || cmd === "\\emph") {
      fr.out += "*" + parseStandalone(fr.str.slice(fr.pos + 1, b.end - 1), fr.atoms) + "*";
      fr.pos = b.end;
    } else if (cmd === "\\texttt") {
      fr.out += "`" + parseStandalone(fr.str.slice(fr.pos + 1, b.end - 1), fr.atoms) + "`";
      fr.pos = b.end;
    } else if (cmd === "\\href") {
      const url = fr.str.slice(fr.pos + 1, b.end - 1).trim();
      const b2 = matchBrace(fr.str, b.end);
      if (b2) {
        const dispBody = fr.str.slice(b.end + 1, b2.end - 1);
        fr.out += "[" + parseStandalone(dispBody, fr.atoms) + "](" + url + ")";
        fr.pos = b2.end;
      } else {
        fr.out += "[" + url + "](" + url + ")";
        fr.pos = b.end;
      }
    } else if (cmd === "\\url") {
      fr.out += "<" + fr.str.slice(fr.pos + 1, b.end - 1).trim() + ">";
      fr.pos = b.end;
    } else if (cmd === "\\includegraphics") {
      const file = fr.str.slice(fr.pos + 1, b.end - 1).trim();
      fr.out += file ? "![](" + file + ")" : "";
      fr.pos = b.end;
    } else if (cmd === "\\ref") {
      fr.out += "\\ref{" + fr.str.slice(fr.pos + 1, b.end - 1) + "}";
      fr.pos = b.end;
    } else if (cmd === "\\cite") {
      fr.out += "[1]";
      fr.pos = b.end;
    } else {
      fr.out += cmd;
    }
  }
}

// Parse a standalone substring (used for href display text) with the atom table.
function parseStandalone(str, atoms) {
  const fr = { str, pos: 0, atoms, out: "" };
  parseRun(fr);
  return fr.out;
}

// Process inline content: convert known inline commands, images, links, footnotes,
// and unescape LaTeX special characters, preserving math spans verbatim.
function processInline(str) {
  // Tokenize math spans ($..$, $$..$$, \(..\), \[..\]) as atoms so their contents
  // are never touched by unescaping or command rewriting. The $$..$$ case is handled
  // at block level but may appear inline too; keep the atom for verbatim retention.
  const atoms = [];
  let right = "";
  {
    const re = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
    let last = 0;
    let m;
    while ((m = re.exec(str)) !== null) {
      right += str.slice(last, m.index);
      right += "\u0000" + atoms.length + "\u0000";
      atoms.push(m[0]);
      last = m.index + m[0].length;
    }
    right += str.slice(last);
  }
  const fr = { str: right, pos: 0, atoms, out: "" };
  parseRun(fr);
  return fr.out;
}

function latexToMarkdown(input) {
  let src = String(input);
  src = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const out = [];
  let pos = 0;
  const n = src.length;

  // ----- helpers ----------------------------------------------------
  // Collect the content of a {..} group whose opening brace is at `p`.
  function braceAt(p) {
    if (src[p] !== "{") return null;
    let depth = 0;
    for (let i = p; i < n; i++) {
      const c = src[i];
      if (c === "\\") { i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return { inner: src.slice(p + 1, i), end: i + 1 }; }
    }
    return null;
  }

  function isEnvStart(p) {
    return src.startsWith("\\begin{", p);
  }
  function isEnvEnd(p) {
    return src.startsWith("\\end{", p);
  }

  function readEnvName(p, isBegin) {
    const openLen = isBegin ? 6 : 4; // length of "\begin" / "\end" excluding brace
    if (src[p + openLen] !== "{") return null;
    let b = p + openLen + 1;
    let depth = 1;
    let i = b;
    for (; i < n; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    return { name: src.slice(b, i), nameEnd: i }; // nameEnd points at closing '}'
  }

  // ----- main scan ----------------------------------------------------
  let guard = 0;
  while (pos < n) {
    if (++guard > 5000000) throw new Error("loop guard");
    // comment
    if (src[pos] === "%" && src[pos - 1] !== "\\") {
      while (pos < n && src[pos] !== "\n") pos++;
      continue;
    }
    // whitespace / blank lines
    if (src[pos] === "\n") { pos++; continue; }
    if (/\s/.test(src[pos])) { pos++; continue; }

    // block math \[ ... \]  (rendering as $$..$$)
    if (src.startsWith("\\[", pos)) {
      const close = src.indexOf("\\]", pos + 2);
      const body = (close === -1 ? src.slice(pos + 2) : src.slice(pos + 2, close)).trim();
      if (body) { out.push("$$"); out.push(body); out.push("$$"); }
      pos = (close === -1 ? n : close + 2);
      continue;
    }
    // block math $$ ... $$
    if (src.startsWith("$$", pos)) {
      const close = src.indexOf("$$", pos + 2);
      const body = (close === -1 ? src.slice(pos + 2) : src.slice(pos + 2, close)).trim();
      if (body) { out.push("$$"); out.push(body); out.push("$$"); }
      pos = (close === -1 ? n : close + 2);
      continue;
    }

    // environment begin
    if (isEnvStart(pos)) {
      const env = readEnvName(pos, true);
      if (env) {
        const beginArgBegin = env.nameEnd + 1; // after '}'
        // find \end{<same>} 
        const endMarker = "\\end{" + env.name + "}";
        const bodyStart = beginArgBegin;
        // If there is an argument spec after begin (e.g. {cc}), skip it.
        let body = bodyStart;
        // skip possible first arg group of begin (like {tabular columns})
        // We'll just scan body until \end marker.
        const bodyEnd = src.indexOf(endMarker, body);
        const bodyText = bodyEnd === -1 ? src.slice(body) : src.slice(body, bodyEnd);
        // advance pos past whole env
        pos = (bodyEnd === -1 ? n : bodyEnd + endMarker.length);

        switch (env.name) {
          case "itemize":
          case "enumerate": {
            const items = [];
            let re = /\\item(?:\s+)?([\s\S]*?)(?=\\item|$)/g;
            let m;
            while ((m = re.exec(bodyText)) !== null) {
              if (m[1] && m[1].trim()) items.push(m[1].trim());
            }
            const bullet = env.name === "enumerate";
            items.forEach((it, idx) => {
              const c = processInline(it);
              out.push(bullet ? (idx + 1) + ". " + c : "- " + c);
            });
            break;
          }
          case "quote":
          case "quotation":
          case "abstract": {
            const prefix = env.name === "abstract" ? "> **Abstract:** " : "> ";
            const text = processInline(bodyText).replace(/\s+/g, " ").trim();
            if (text) { out.push(prefix + text); }
            break;
          }
          case "verbatim":
          case "lstlisting": {
            out.push("```");
            const linesTxt = bodyText.split("\n");
            // drop leading/trailing blank lines
            let li = 0, ri = linesTxt.length - 1;
            while (li < linesTxt.length && !linesTxt[li].trim()) li++;
            while (ri >= li && !linesTxt[ri].trim()) ri--;
            for (let k = li; k <= ri; k++) out.push(linesTxt[k]);
            out.push("```");
            break;
          }
          case "tabular":
          case "tabularx":
          case "longtable":
          case "array": {
            // Drop the leading column-spec group "{...}" if present.
            let body = bodyText.trim();
            if (body[0] === "{" ) {
              const specEnd = body.indexOf("}");
              if (specEnd !== -1) body = body.slice(specEnd + 1);
            }
            const rowParts = splitRows(body);
            const rows = [];
            for (const rp of rowParts) {
              let r = rp.trim();
              if (!r) continue;
              r = r.replace(/^\\hline+/, "").trim();
              if (!r) continue; // a pure hline row
              const cells = splitCells(r);
              if (cells.length) rows.push(cells);
            }
            if (rows.length) {
              const cols = Math.max(...rows.map((rw) => rw.length));
              const pad = (row) => {
                const arr = row.slice();
                while (arr.length < cols) arr.push("");
                return arr.map((c) => processInline(c).trim());
              };
              out.push("| " + pad(rows[0]).join(" | ") + " |");
              out.push("| " + Array.from({ length: cols }, () => "---").join(" | ") + " |");
              for (let ri = 1; ri < rows.length; ri++) {
                out.push("| " + pad(rows[ri]).join(" | ") + " |");
              }
            }
            break;
          }
          case "center":
          case "flushleft":
          case "flushright": {
            const text = processInline(bodyText).trim();
            if (text) out.push(text);
            break;
          }
          case "displaymath":
          case "equation":
          case "equation*":
          case "align":
          case "align*": {
            const body = bodyText.trim();
            if (body) { out.push("$$"); out.push(body); out.push("$$"); }
            break;
          }
          case "math": {
            const body = bodyText.trim();
            if (body) out.push("$" + body + "$");
            break;
          }
          case "document": {
            // recurse into the body so sections/lists/etc. inside are converted
            const inner = latexToMarkdown(bodyText);
            if (inner) out.push(inner);
            break;
          }
          default: {
            // unknown environment: keep inner content inline-processed
            const text = processInline(bodyText).trim();
            if (text) out.push(text);
            break;
          }
        }
        continue;
      }
      // fallthrough if env malformed
      out.push("\\");
      pos++;
      continue;
    }

    // environment end alone (shouldn't happen; skip)
    if (isEnvEnd(pos)) {
      const env = readEnvName(pos, false);
      if (env) { pos = env.nameEnd + 1; continue; }
      pos++;
      continue;
    }

    // block command at this position
    const blockCmd = /^\\(section|subsection|subsubsection|paragraph|chapter|title|author|date|maketitle|documentclass|usepackage|par|item|label|ref|cite)\b/.exec(src.slice(pos));
    const blk = blockCmd && blockCmd[1];
    if (blk) {
      const name = blockCmd[1];
      if (name === "documentclass" || name === "usepackage" || name === "label") {
        // skip until newline
        while (pos < n && src[pos] !== "\n") pos++;
        continue;
      }
      if (name === "maketitle") { pos += 9; continue; }
      if (name === "date") { // skip whole arg + rest of line
        while (pos < n && src[pos] !== "\n") pos++;
        continue;
      }
      if (name === "par") { pos += 4; out.push(""); continue; }

      // sections / title / author: parse the first argument right after the command.
      const cmdStart = pos; // at backslash
      // optional star immediately after name
      let argMark = pos + 1 + name.length;
      if (src[argMark] === "*") argMark++;
      // skip whitespace
      while (src[argMark] === " " || src[argMark] === "\t") argMark++;
      // next must be { arg
      if (src[argMark] !== "{") {
        // no arg (e.g. resparsed); skip command name
        pos = argMark;
        continue;
      }
      const b = braceAt(argMark);
      if (!b) { pos = argMark + 1; continue; }
      const title = processInline(b.inner).trim();

      if (name === "section" || name === "subsection" || name === "subsubsection" || name === "paragraph" || name === "chapter") {
        const level = { chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 }[name];
        out.push("#".repeat(level) + " " + title);
        pos = b.end;
        continue;
      }
      if (name === "title") {
        out.push("# " + title);
        pos = b.end;
        continue;
      }
      if (name === "author") {
        out.push("> " + title);
        pos = b.end;
        continue;
      }
      pos = b.end;
      continue;
    }

    if (!blk) {
      // no block command. Collect a run of ordinary text/commands into one paragraph
      // until a newline-newline or a block start or env start.
      let para = "";
      while (pos < n) {
        // stop at paragraph gap
        if (src[pos] === "\n" && src[pos + 1] === "\n") { pos += 2; break; }
        if (src[pos] === "\n") { para += " "; pos++; continue; }
        if (src[pos] === "%" && src[pos - 1] !== "\\") { while (pos < n && src[pos] !== "\n") pos++; continue; }
        // break at block math so \[..\] / $$..$$ are emitted independently
        if (src.startsWith("\\[", pos) || src.startsWith("$$", pos)) break;
        if (isEnvStart(pos)) break;
        if (/^\\(section|subsection|subsubsection|paragraph|chapter|title|author|date|maketitle|documentclass|usepackage|par|begin|end)\b/.test(src.slice(pos))) {
          // peek: if it's \begin skip handled by outer; break only for section-like
          if (/^\\(section|subsection|subsubsection|paragraph|chapter|title|author|maketitle)\b/.test(src.slice(pos))) break;
          if (/^\\begin\{/.test(src.slice(pos))) break;
          if (/^\\end\{/.test(src.slice(pos))) break;
        }
        para += src[pos];
        pos++;
      }
      const t = processInline(para).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
      continue;
    }
  }

  // Clean up
  let result = out.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "\n");
  return result;

  // inner helpers not part of outer closure's scope use `src`
  function splitRows(text) {
    // returns array of cell-arrays? We'll return raw row strings split on \\ (outside braces)
    const rows = [];
    let cur = "";
    let brace = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "{") brace++;
      else if (c === "}") brace--;
      if (c === "\\" && text[i + 1] === "\\" && brace === 0) {
        rows.push(cur); cur = ""; i++;
        continue;
      }
      cur += c;
    }
    if (cur.trim()) rows.push(cur);
    return rows;
  }
  function splitCells(row) {
    const cells = [];
    let cur = "";
    let brace = 0;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === "{") brace++;
      else if (c === "}") brace--;
      if (c === "&" && brace === 0) { cells.push(cur.trim()); cur = ""; continue; }
      if (c === "\\") { cur += c; i++; if (i < row.length) cur += row[i]; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }
}

export { latexToMarkdown };
export default latexToMarkdown;