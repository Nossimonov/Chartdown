/**
 * Theme-document parsing (spec 08): `[theme]` + `[glyphs]` sections in
 * ordinary Chartdown syntax; no `map:` header required.
 */

import { error, warning, type Diagnostic } from "./diagnostics";
import { splitLines, tokenize } from "./lex";

export const THEME_PROPS = new Set(["fill", "stroke", "width", "dash", "opacity", "glyph", "asset", "edge"]);
export const SURFACE_WORDS = new Set(["paper", "grid", "fog", "ink", "light", "ledge"]);
export const ZONE_WORDS = new Set(["core", "edge"]);

export interface ThemeEntry {
  /** Vocabulary word, `side`, or a surface word. */
  base: string;
  /** State name, zone (`core`/`edge`), or side name; null for the bare word. */
  sub: string | null;
  pairs: Record<string, string>;
  line: number;
}

export interface ThemeDocumentNode {
  entries: ThemeEntry[];
  glyphs: Record<string, string>;
  /** `use:` values, in order, to be resolved by the consumer. */
  uses: string[];
}

export function parseThemeDocument(source: string, diagnostics: Diagnostic[]): ThemeDocumentNode {
  const doc: ThemeDocumentNode = { entries: [], glyphs: {}, uses: [] };
  let section: "theme" | "glyphs" | "other" | null = null;
  let first = true;

  for (const raw of splitLines(source)) {
    if (first && raw.text.startsWith("#")) {
      first = false;
      continue;
    }
    first = false;
    const sectionMatch = /^\[(.+)\]$/.exec(raw.text);
    if (sectionMatch) {
      const name = sectionMatch[1]!;
      section = name === "theme" ? "theme" : name === "glyphs" ? "glyphs" : "other";
      if (section === "other") diagnostics.push(warning(raw.line, `theme document: ignoring section [${name}]`));
      continue;
    }
    const tokens = tokenize(raw.text, raw.line, diagnostics);
    const colonIndex = tokens.findIndex((t) => t.kind === "colon");

    if (section === null) {
      // Header zone: only `use:` is meaningful in a theme document.
      const key = tokens[0];
      if (colonIndex === 1 && key?.kind === "chunk" && key.text === "use") {
        const value = tokens
          .slice(2)
          .map((t) => (t.kind === "chunk" ? t.text : ""))
          .join(" ")
          .trim();
        if (value) doc.uses.push(value);
      } else {
        diagnostics.push(warning(raw.line, "theme document: ignoring header line (only 'use:' applies)"));
      }
      continue;
    }
    if (section === "other") continue;
    if (colonIndex === -1) {
      diagnostics.push(error(raw.line, "expected 'subject : properties'"));
      continue;
    }

    if (section === "glyphs") {
      const name = tokens[0];
      const path = tokens[colonIndex + 1];
      if (name?.kind !== "chunk" || path?.kind !== "string") {
        diagnostics.push(error(raw.line, 'malformed [glyphs] line — expected \'name : "SVG path data"\''));
        continue;
      }
      doc.glyphs[name.text] = path.value;
      continue;
    }

    const subjectToken = tokens[0];
    if (colonIndex !== 1 || subjectToken?.kind !== "chunk") {
      diagnostics.push(error(raw.line, "malformed [theme] line — expected a single subject before ':'"));
      continue;
    }
    const dot = subjectToken.text.indexOf(".");
    const base = dot === -1 ? subjectToken.text : subjectToken.text.slice(0, dot);
    const sub = dot === -1 ? null : subjectToken.text.slice(dot + 1);
    const pairs: Record<string, string> = {};
    for (const t of tokens.slice(colonIndex + 1)) {
      if (t.kind === "pair") {
        if (!THEME_PROPS.has(t.key)) {
          diagnostics.push(warning(raw.line, `unknown theme property '${t.key}' — the appearance vocabulary is closed (spec 08 §3)`));
          continue;
        }
        pairs[t.key] = t.value;
      } else {
        diagnostics.push(warning(raw.line, "theme lines take only key=value properties"));
      }
    }
    doc.entries.push({ base, sub, pairs, line: raw.line });
  }
  return doc;
}
