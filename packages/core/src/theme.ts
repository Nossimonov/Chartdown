/**
 * Theme-document parsing (spec 08): `[theme]` + `[glyphs]` sections in
 * ordinary Chartdown syntax; no `map:` header required.
 */

import { error, warning, type Diagnostic } from "./diagnostics";
import { splitLines, tokenize } from "./lex";

export const THEME_PROPS = new Set(["fill", "stroke", "width", "dash", "opacity", "glyph", "asset", "edge", "bank"]);

/**
 * Which side of its own line a border's ink lies on (#185, ADR 0034).
 *
 * Closed, because the whole point is that there is no fourth answer: a stroke
 * CENTRED on a boundary puts half its ink on each side, and when two shores
 * approach, the two water-side halves meet and fill the channel between them.
 * That ambiguity is structural rather than anybody's choice, so the spelling
 * for it is removed rather than defaulted.
 */
/**
 * The numeric appearance properties, and what each will accept (#388).
 *
 * Spec 08 §3's `THEME_PROPS` is a CLOSED set of nine, so unlike a document's
 * `key=value` pairs there is no list to invent here and nothing to go stale —
 * which is exactly why #375 could not do this and this can. `bank=` has been
 * validated against its own closed set since ADR 0034; these were simply never
 * given the same treatment, and every one of them was read later with
 * `Number(...) || <default>` or pasted verbatim into an SVG attribute.
 *
 * What that cost: `opacity=80` — a themer reaching for a percentage — emitted
 * `opacity="80"`, which consumers clamp to 1, so the darkness wash blacked the
 * whole sheet out. `width=-4` emitted `stroke-width="-4"`, invalid SVG. And
 * `width=abc` silently became the default, so the line the themer wrote did
 * nothing at all and said nothing about it.
 *
 * WARN AND DROP, matching `bank=`: the value is discarded so the default
 * applies, which keeps a bad theme rendering a usable map rather than failing
 * the document. A theme is presentation; refusing the whole map over a stroke
 * width would be the wrong trade.
 */
const THEME_NUMERIC: Record<string, { ok: (v: string) => boolean; want: string }> = {
  // Canvas units, and ink is never negative (ADR 0037). Zero is a deliberate
  // "draw no stroke" and stays legal.
  width: { ok: (v) => /^\d+(\.\d+)?$/.test(v), want: "a number, like '2' or '1.5'" },
  edge: { ok: (v) => /^\d+(\.\d+)?$/.test(v), want: "a number, like '3'" },
  // SVG's own range. `80` is the case worth naming: it is the percentage a
  // themer means, and it renders as fully opaque.
  opacity: {
    ok: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 1,
    want: "a number from 0 to 1 — 80% is '0.8', not '80'",
  },
  // A dash pattern: numbers separated by commas or spaces.
  dash: { ok: (v) => /^\d+(\.\d+)?([ ,]\s*\d+(\.\d+)?)*$/.test(v), want: "numbers, like '4,4'" },
};

export const BANK_VALUES = new Set(["land", "water", "both"]);
export const SURFACE_WORDS = new Set(["paper", "grid", "fog", "ink", "light", "ledge", "leader"]);
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
  /** Where each glyph was declared, so a glyph nothing references can name its line (#116). */
  glyphLines: Record<string, number>;
  /** `use:` values, in order, to be resolved by the consumer. */
  uses: string[];
}

export function parseThemeDocument(source: string, diagnostics: Diagnostic[]): ThemeDocumentNode {
  const doc: ThemeDocumentNode = { entries: [], glyphs: {}, glyphLines: {}, uses: [] };
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
      // Header zone: `use:` imports, and `kind: theme` is the document's own
      // discriminator (#110) — not an unknown line to warn about.
      const key = tokens[0];
      if (colonIndex === 1 && key?.kind === "chunk" && key.text === "kind") {
        continue;
      }
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
      doc.glyphLines[name.text] = raw.line;
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
        const numeric = THEME_NUMERIC[t.key];
        if (numeric && !numeric.ok(t.value)) {
          diagnostics.push(warning(raw.line, `'${t.key}=${t.value}' is not ${numeric.want} — the declaration is ignored (spec 08 §3)`));
          continue;
        }
        if (t.key === "bank" && !BANK_VALUES.has(t.value)) {
          diagnostics.push(warning(raw.line, `'bank=${t.value}' is not one of ${[...BANK_VALUES].join(", ")} — a border lies on the land, on the water, or on both, and never centred on the line (spec 08 §3)`));
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
