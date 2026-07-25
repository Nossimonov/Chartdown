/**
 * Document-kind dispatch for validation (#102).
 *
 * Chartdown has three document kinds, and two of them are defined by what they
 * LACK: spec 04 §2 and spec 08 §1 both say vocabulary and theme documents need
 * no `map:` header. `parse()` is the map parser, so pointing it at either one
 * reports a missing `map:` and then discards the whole file as unknown
 * sections — leaving the "shareable/publishable surface" (spec 04 §2) with no
 * validation path at all.
 *
 * Inference from the sections present is a good compatibility path and a poor
 * rule: an empty file, a `[gm]`-only file, and a tool-generated partial
 * vocabulary are all undecidable this way. The durable fix is a positive
 * discriminator — see #110's `kind:` proposal.
 */

import type { Diagnostic } from "./diagnostics";
import { parse, type ParseOptions } from "./parse";
import { parseThemeDocument } from "./theme";
import { loadStdlib, parseVocabDocument, VocabTable } from "./vocab";

export type DocumentKind = "map" | "theme" | "vocabulary";

/**
 * Which kind a source is. A `map:` line settles it; otherwise the sections
 * present decide. Anything undecidable stays "map", so a genuinely malformed
 * map still gets "missing required 'map:'" rather than a misleading verdict.
 */
export function documentKind(source: string): DocumentKind {
  let sawTheme = false;
  let sawVocab = false;
  for (const line of source.split(/\r?\n/)) {
    const text = line.replace(/;.*$/, "").trim();
    if (text === "") continue;
    if (/^map\s*:/.test(text)) return "map";
    const section = /^\[([^\]]+)\]$/.exec(text);
    if (!section) continue;
    const name = section[1]!.split(/\s+/)[0];
    if (name === "theme" || name === "glyphs") sawTheme = true;
    if (name === "vocab") sawVocab = true;
  }
  if (sawTheme) return "theme";
  if (sawVocab) return "vocabulary";
  return "map";
}

export interface CheckResult {
  kind: DocumentKind;
  diagnostics: Diagnostic[];
}

/** Validate a source against the rules of whichever kind of document it is. */
export function checkSource(source: string, options: ParseOptions = {}): CheckResult {
  const kind = documentKind(source);
  if (kind === "theme") {
    const diagnostics: Diagnostic[] = [];
    parseThemeDocument(source, diagnostics);
    return { kind, diagnostics };
  }
  if (kind === "vocabulary") {
    const diagnostics: Diagnostic[] = [];
    const table = new VocabTable();
    loadStdlib(table);
    parseVocabDocument(source, "library", table, diagnostics);
    return { kind, diagnostics };
  }
  return { kind, diagnostics: parse(source, options).diagnostics };
}
