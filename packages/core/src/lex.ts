/**
 * Lexical layer (spec 01): line splitting, quote-aware comment stripping,
 * and chunk tokenization. Chartdown is line-oriented; a "chunk" is a
 * whitespace-delimited token in which quoted strings protect whitespace,
 * `;`, and `=`.
 */

import { error, type Diagnostic } from "./diagnostics";

export interface RawLine {
  /** Leading whitespace width — nonzero marks a detail line (spec 01 §4). */
  indent: number;
  /** Trimmed content, comment removed. */
  text: string;
  /** 1-indexed source line. */
  line: number;
}

export function splitLines(source: string): RawLine[] {
  const out: RawLine[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComment(lines[i]!);
    if (stripped.trim() === "") continue;
    out.push({
      indent: stripped.length - stripped.trimStart().length,
      text: stripped.trim(),
      line: i + 1,
    });
  }
  return out;
}

/** Remove a `;` comment, honoring quoted strings (spec 01 §3). */
export function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    else if (ch === ";" && !inString) return line.slice(0, i);
  }
  return line;
}

export type Token =
  | { kind: "colon" }
  | { kind: "string"; value: string }
  | { kind: "pair"; key: string; value: string }
  | { kind: "chunk"; text: string };

export function tokenize(text: string, line: number, diagnostics: Diagnostic[]): Token[] {
  const chunks: string[] = [];
  let current = "";
  let inString = false;
  for (const ch of text) {
    if (ch === '"') {
      inString = !inString;
      current += ch;
    } else if (!inString && /\s/.test(ch)) {
      if (current) {
        chunks.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (inString) diagnostics.push(error(line, "unterminated string"));
  if (current) chunks.push(current);

  const tokens: Token[] = [];
  for (const chunk of chunks) {
    if (chunk === ":") {
      tokens.push({ kind: "colon" });
      continue;
    }
    // Header style: `map:` — a word with an attached trailing colon.
    if (chunk.endsWith(":") && chunk.length > 1 && !chunk.includes("=") && !chunk.includes('"')) {
      tokens.push({ kind: "chunk", text: chunk.slice(0, -1) });
      tokens.push({ kind: "colon" });
      continue;
    }
    // A DISPLAY NAME MAY HUG THE COLON (#251): `forest "Dark Wood": blob …`.
    // The header-style rule above refuses any chunk containing a quote, which
    // is right for `gm="a: b"` and wrong here — so this spelling fell through
    // to the string branch below, where the trailing-quote strip cannot match
    // a chunk ending in a colon. The name became `Dark Wood":`, no colon token
    // was emitted, and the line was rejected as having no predicate: an error
    // naming the whole line, for one absent space.
    //
    // It matters most in `[labels]`, where an override's subject IS a bare
    // quoted name, so `"The Black Altar": at …` is the natural thing to type
    // and was exactly the shape that failed. The closing quote is what makes
    // this unambiguous — the colon is outside the string, so it is punctuation
    // and not part of the name.
    if (chunk.startsWith('"') && chunk.endsWith('":') && chunk.length > 2) {
      tokens.push({ kind: "string", value: chunk.slice(1, -2) });
      tokens.push({ kind: "colon" });
      continue;
    }
    if (chunk.startsWith('"')) {
      tokens.push({ kind: "string", value: chunk.replace(/^"|"$/g, "") });
      continue;
    }
    const eq = chunk.indexOf("=");
    if (eq > 0 && !chunk.startsWith("(")) {
      const key = chunk.slice(0, eq);
      let value = chunk.slice(eq + 1);
      if (value.startsWith('"')) value = value.replace(/^"|"$/g, "");
      tokens.push({ kind: "pair", key, value });
      continue;
    }
    tokens.push({ kind: "chunk", text: chunk });
  }
  return tokens;
}
