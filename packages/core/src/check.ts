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
  // A kind reached by INFERENCE says so once (#129): inference is the
  // compatibility path, not the rule (spec 01 §2), and this warning is the only
  // thing telling an existing vocabulary or theme document that a positive
  // spelling now exists — without it, adoption depends on reading a changelog.
  const inferredKindWarning: Diagnostic[] =
    kind !== "map" && declared === null
      ? [
          {
            severity: "warning",
            line: 1,
            message:
              "no 'map:' or 'kind:' header — inferred a " + kind +
              " document from its sections; add 'kind: " + kind + "' as the first header line (spec 01 §2)",
          },
        ]
      : [];

  if (kind === "theme") {
    const diagnostics: Diagnostic[] = [...kindDiagnostics, ...inferredKindWarning];
    parseThemeDocument(source, diagnostics);
    return { kind, diagnostics };
  }
  if (kind === "vocabulary") {
    const diagnostics: Diagnostic[] = [...kindDiagnostics, ...inferredKindWarning];
    const table = new VocabTable();
    loadStdlib(table);
    parseVocabDocument(source, "library", table, diagnostics);
    return { kind, diagnostics };
  }
  return { kind, diagnostics: [...kindDiagnostics, ...parse(source, options).diagnostics] };
}

/**
 * The `detail=` seam (#109). With `detail-at=` naming where the sub-map's A1
 * sits in the parent, the relationship becomes checkable — and the exercise
 * that raised this produced a real off-by-one to prove it needs checking: a
 * 42×28 child at 5ft was declared against a 22×21 parent footprint at 10ft,
 * covering 21×14 parent cells against 22 needed, and both files checked clean.
 *
 * The parser never reads a file. Sub-map sources arrive through `options`, the
 * same way `use:` libraries do, so a caller that supplies nothing simply gets
 * the unchecked pointer `detail=` has always been.
 */
export function checkDetailSeams(source: string, options: ParseOptions = {}): Diagnostic[] {
  const details = options.documents;
  if (!details) return [];
  const out: Diagnostic[] = [];
  const parent = parse(source, options).document;
  const parentScale = measureOf(parent.header.find((h) => h.key === "scale")?.value);
  for (const section of parent.sections) {
    for (const entry of section.entries) {
      if (entry.kind !== "entity") continue;
      const path = entry.pairs.find((p) => p.key === "detail")?.value;
      const anchor = entry.pairs.find((p) => p.key === "detail-at")?.value;
      if (path === undefined || anchor === undefined) continue;
      const childSource = details[path];
      if (childSource === undefined) {
        out.push({ severity: "warning", line: entry.line, message: `sub-map '${path}' was not provided to the checker — its seam with this document is unchecked (spec 03 §4)` });
        continue;
      }
      const child = parse(childSource, {}).document;
      const childScale = measureOf(child.header.find((h) => h.key === "scale")?.value);
      if (parentScale === null || childScale === null) {
        out.push({ severity: "warning", line: entry.line, message: `both this document and '${path}' need a 'scale:' before their seam can be checked (spec 03 §4)` });
        continue;
      }
      // A window is an integer magnification. 10ft→5ft is 2:1; 10ft→3ft is not
      // a window onto the same space, it is a different map, and should say so.
      const ratio = parentScale / childScale;
      if (!Number.isInteger(ratio) || ratio < 1) {
        out.push({ severity: "error", line: entry.line, message: `'${path}' is ${childScale}-scaled against this document's ${parentScale}: a sub-map magnifies by a whole number, and ${parentScale}:${childScale} is not one (spec 03 §4)` });
        continue;
      }
      const footprint = footprintSize(entry);
      if (footprint === null || child.grid === null) continue;
      const needCols = footprint.cols * ratio;
      const needRows = footprint.rows * ratio;
      if (child.grid.cols < needCols || child.grid.rows < needRows) {
        out.push({
          severity: "error",
          line: entry.line,
          message: `'${path}' is ${child.grid.cols}x${child.grid.rows} at ${childScale}, which covers ${Math.floor(child.grid.cols / ratio)}x${Math.floor(child.grid.rows / ratio)} of this document's cells — the footprint anchored at ${anchor} is ${footprint.cols}x${footprint.rows} and needs ${needCols}x${needRows} (spec 03 §4)`,
        });
      }
    }
  }
  return out;
}

/** Leading number of a measure, or null: "10ft" → 10. */
function measureOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = /^(\d+(?:\.\d+)?)/.exec(value);
  return m ? Number(m[1]) : null;
}

/** An entity's footprint in cells, from its range placements. */
function footprintSize(entry: { placements: { kind: string }[] }): { cols: number; rows: number } | null {
  const colNum = (letters: string): number => {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  };
  for (const p of entry.placements as { kind: string; from?: { col: string; row: number }; to?: { col: string; row: number } }[]) {
    if (p.kind !== "range" || !p.from || !p.to) continue;
    return {
      cols: Math.abs(colNum(p.to.col) - colNum(p.from.col)) + 1,
      rows: Math.abs(p.to.row - p.from.row) + 1,
    };
  }
  return null;
}

/**
 * The child side of the seam (#143, ADR 0021): `inset: <document> at <entity>`.
 *
 * The owner's acceptance of a child referencing its parent was explicitly
 * conditional on catching disagreements between the two, so every way the pair
 * can contradict each other is an error naming both files. Two declarations
 * that could drift silently would be worse than the one declaration this
 * replaces.
 */
export function checkInset(source: string, options: ParseOptions = {}): Diagnostic[] {
  const parsed = parse(source, options);
  const header = parsed.document.header.find((h) => h.key === "inset");
  if (!header) return [];
  const match = /^(\S+)\s+at\s+(\S+)$/.exec(header.value.trim());
  if (!match) {
    return [{ severity: "error", line: header.line, message: `'inset:' names the document and the entity this is a window onto — 'inset: khazad-dum.cd at mazarbul' (spec 03 §4)` }];
  }
  const [, parentPath, entityRef] = match as unknown as [string, string, string];
  const parentSource = options.documents?.[parentPath];
  if (parentSource === undefined) {
    return [{ severity: "warning", line: header.line, message: `parent document '${parentPath}' was not provided to the checker — this inset's seam is unchecked (spec 03 §4)` }];
  }
  const parent = parse(parentSource, {}).document;
  const owner = parent.sections
    .flatMap((s) => s.entries)
    .find((e) => e.kind === "entity" && (e.ids.includes(entityRef) || e.name === entityRef));
  if (!owner || owner.kind !== "entity") {
    return [{ severity: "error", line: header.line, message: `'${parentPath}' has no entity '${entityRef}' for this document to be a window onto (spec 03 §4)` }];
  }
  const out: Diagnostic[] = [];
  const detail = owner.pairs.find((p) => p.key === "detail")?.value;
  if (detail === undefined) {
    out.push({ severity: "error", line: header.line, message: `'${entityRef}' in '${parentPath}' has no 'detail=' pointing back at this document — the two ends of a seam must agree (spec 03 §4)` });
  }
  if (owner.pairs.find((p) => p.key === "detail-at") === undefined) {
    out.push({ severity: "error", line: header.line, message: `'${entityRef}' in '${parentPath}' has no 'detail-at=', so there is no anchor for this inset to agree with (spec 03 §4)` });
  }
  return out;
}
