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
 * Which kind a source is. A `kind:` line is the positive discriminator and
 * settles it outright (#110); a `map:` line settles it too. Failing both, the
 * sections present decide — retained as a compatibility path for documents
 * written before `kind:` existed, but a poor rule on its own: an empty file, a
 * `[gm]`-only file, and a tool-generated partial vocabulary are all
 * undecidable this way. Anything still undecidable stays "map", so a genuinely
 * malformed map gets "missing required 'map:'" rather than a misleading
 * verdict about being a vocabulary.
 */
export function documentKind(source: string): DocumentKind {
  let sawTheme = false;
  let sawVocab = false;
  for (const line of source.split(/\r?\n/)) {
    const text = line.replace(/;.*$/, "").trim();
    if (text === "") continue;
    const declared = /^kind\s*:\s*(\S+)/.exec(text);
    if (declared) {
      const value = declared[1]!;
      if (value === "theme" || value === "vocabulary") return value;
    }
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

/** The raw value of a `kind:` header line, valid or not, or null if absent. */
function declaredKindValue(source: string): { value: string; line: number } | null {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.replace(/;.*$/, "").trim();
    if (text === "") continue;
    const m = /^kind\s*:\s*(\S+)/.exec(text);
    if (m) return { value: m[1]!, line: i + 1 };
    if (/^\[/.test(text)) break; // past the header zone
  }
  return null;
}

/** Validate a source against the rules of whichever kind of document it is. */
export function checkSource(source: string, options: ParseOptions = {}): CheckResult {
  const kind = documentKind(source);
  // A misspelled `kind:` must be loud whichever way the document then routes —
  // otherwise `kind: spaceship` silently falls back to inference and reports ok.
  const declared = declaredKindValue(source);
  const kindDiagnostics: Diagnostic[] =
    declared && !["vocabulary", "theme"].includes(declared.value)
      ? [{
          severity: "error",
          line: declared.line,
          message: `unknown document kind '${declared.value}' — expected vocabulary or theme (a map is spelled by 'map:')`,
        }]
      : [];
  if (kind === "theme") {
    const diagnostics: Diagnostic[] = [...kindDiagnostics];
    parseThemeDocument(source, diagnostics);
    return { kind, diagnostics };
  }
  if (kind === "vocabulary") {
    const diagnostics: Diagnostic[] = [...kindDiagnostics];
    const table = new VocabTable();
    loadStdlib(table);
    parseVocabDocument(source, "library", table, diagnostics);
    return { kind, diagnostics };
  }
  return { kind, diagnostics: [...kindDiagnostics, ...parse(source, options).diagnostics] };
}
