/** Flattens a parsed document into render-ready collections, honoring render mode. */

import type {
  Address,
  AddressRange,
  DetailNode,
  DocumentNode,
  Edge,
  EntityNode,
  GmAttachmentNode,
  HexLineNode,
  LabelOverrideNode,
  Pair,
  Placement,
  Ref,
} from "@chartdown/core";
import { loadStdlib, slugify, VocabTable, type Diagnostic } from "@chartdown/core";
import type { Theme } from "./theme";
import { colLetters, colToNumber } from "./util";

export type RenderMode = "player" | "gm";

export interface Model {
  doc: DocumentNode;
  mode: RenderMode;
  entities: EntityNode[];
  hexLines: HexLineNode[];
  labelOverrides: LabelOverrideNode[];
  /** gm notes attached by reference, keyed by resolved anchor id (or display name slug). */
  gmNotes: Map<string, string[]>;
  header: Map<string, string>;
  seed: number;
  theme: Theme;
  /** `labels:` header (spec 07 §3): derived labels render only in "names" mode. */
  labelsMode: "names" | "none";
  /**
   * Theme fallback chain for a word (spec 04 §4): the word, then its
   * derivation bases — a theme lookup walks it until a word it knows.
   * Built from the standard library plus the document's [vocab] entries.
   * (`use:` library vocab is resolved by the parser for archetypes; theme
   * chains for library-defined derivations are a known gap until #20.)
   */
  chainOf(word: string | null): string[];
  /**
   * For entities placed relatively (spec 02 §7, #34): the resolved absolute
   * address, surfaced so the DM-facing frame stays absolute (tooltips).
   */
  resolvedNotes: Map<EntityNode, string>;
}

export const pairOf = (pairs: Pair[], key: string): string | undefined =>
  pairs.find((p) => p.key === key)?.value;

/** Entity anchor id per spec 03 §3: explicit id, else display-name slug; null if anonymous. */
export function entityAnchor(e: { ids: string[]; name: string | null }): string | null {
  if (e.ids.length > 0) return e.ids[0]!;
  if (e.name) return slugify(e.name);
  return null;
}

export function buildModel(doc: DocumentNode, mode: RenderMode, theme: Theme, diagnostics: Diagnostic[] = []): Model {
  const entities: EntityNode[] = [];
  const hexLines: HexLineNode[] = [];
  const labelOverrides: LabelOverrideNode[] = [];
  const gmNotes = new Map<string, string[]>();

  const refKey = (ref: Ref): string => (ref.form === "id" ? ref.value : slugify(ref.value));

  for (const section of doc.sections) {
    for (const entry of section.entries) {
      switch (entry.kind) {
        case "entity": {
          if (mode === "player" && (entry.gmOnly || entry.flags.includes("hidden"))) break;
          entities.push(entry);
          break;
        }
        case "hex-line":
          hexLines.push(entry);
          break;
        case "label-override":
          labelOverrides.push(entry);
          break;
        case "gm-attachment": {
          if (mode === "gm") {
            const attachment: GmAttachmentNode = entry;
            const key = refKey(attachment.target);
            const notes = gmNotes.get(key) ?? [];
            notes.push(...attachment.texts, ...attachment.pairs.filter((p) => p.key === "gm").map((p) => p.value));
            gmNotes.set(key, notes);
          }
          break;
        }
        case "vocab-entry":
          break;
      }
    }
  }

  const header = new Map(doc.header.map((h) => [h.key, h.value]));
  const seed = Number(header.get("seed") ?? 0) || 0;

  const vocab = new VocabTable();
  loadStdlib(vocab);
  const scratch: Diagnostic[] = [];
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      if (entry.kind === "vocab-entry") vocab.add(entry, scratch);
    }
  }
  const chainOf = (word: string | null): string[] => (word ? vocab.chain(word) : []);

  const labelsMode: "names" | "none" = header.get("labels") === "none" ? "none" : "names";
  const resolvedNotes = new Map<EntityNode, string>();
  if (doc.mapType === "battlemap") {
    resolveRelativePlacements(entities, chainOf, resolvedNotes, diagnostics);
  }
  return { doc, mode, entities, hexLines, labelOverrides, gmNotes, header, seed, theme, labelsMode, chainOf, resolvedNotes };
}

// ---------- relative placement (spec 02 §7, issue #34) ----------

const localText = (p: Address | AddressRange | Edge): string =>
  p.kind === "address" ? `${p.col}${p.row}`
  : p.kind === "range" ? `${p.from.col}${p.from.row}..${p.to.col}${p.to.row}`
  : `${p.at.col}${p.at.row}.${p.dir}`;

/** The cells of an entity's footprint (addresses and ranges; cell-union). */
function footprintCells(e: EntityNode): Set<string> {
  const cells = new Set<string>();
  for (const p of e.placements) {
    if (p.kind === "address") cells.add(`${colToNumber(p.col)}:${p.row}`);
    if (p.kind === "range") {
      const c1 = Math.min(colToNumber(p.from.col), colToNumber(p.to.col));
      const c2 = Math.max(colToNumber(p.from.col), colToNumber(p.to.col));
      const r1 = Math.min(p.from.row, p.to.row);
      const r2 = Math.max(p.from.row, p.to.row);
      for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) cells.add(`${c}:${r}`);
    }
  }
  return cells;
}

/**
 * Translate `on <structure> at <local>` placements (and `at`-prefixed detail
 * placements, whose implicit frame is their parent) into absolute placements.
 * The local frame is the footprint's bounding rect, NW cell = A1 (#34).
 * Both systems coexist: absolute placement stays untouched; relative is the
 * author's choice per line, and everything downstream sees only absolute.
 */
function resolveRelativePlacements(
  entities: EntityNode[],
  chainOf: (word: string | null) => string[],
  resolvedNotes: Map<EntityNode, string>,
  diagnostics: Diagnostic[],
): void {
  const byId = new Map<string, EntityNode>();
  const byName = new Map<string, EntityNode>();
  for (const e of entities) {
    for (const id of e.ids) if (!byId.has(id)) byId.set(id, e);
    if (e.name && !byName.has(e.name)) byName.set(e.name, e);
  }
  const displayName = (e: EntityNode): string => e.name ?? e.ids[0] ?? e.typeWord ?? "structure";

  const translateAgainst = (
    local: Address | AddressRange | Edge,
    parent: EntityNode,
    line: number,
  ): Address | AddressRange | Edge | null => {
    const cells = footprintCells(parent);
    if (cells.size === 0) return null;
    let colMin = Infinity;
    let rowMin = Infinity;
    for (const key of cells) {
      const [c, r] = key.split(":").map(Number) as [number, number];
      if (c < colMin) colMin = c;
      if (r < rowMin) rowMin = r;
    }
    const shift = (a: Address): Address | null => {
      const col = colMin + colToNumber(a.col) - 1;
      const row = rowMin + a.row - 1;
      if (!cells.has(`${col}:${row}`)) {
        diagnostics.push({
          severity: "error",
          line,
          message: `local cell ${a.col}${a.row} lies outside '${displayName(parent)}' — its footprint is ${cells.size} cells with NW at ${colLetters(colMin)}${rowMin} (spec 02 §7)`,
        });
        return null;
      }
      return { kind: "address", col: colLetters(col), row };
    };
    if (local.kind === "address") return shift(local);
    if (local.kind === "edge") {
      const at = shift(local.at);
      return at ? { kind: "edge", at, dir: local.dir } : null;
    }
    const from = shift(local.from);
    const to = shift(local.to);
    return from && to ? { kind: "range", from, to } : null;
  };

  entities.forEach((e, index) => {
    let changed = false;
    const notes: string[] = [];

    const placements: Placement[] = e.placements.map((p): Placement => {
      if (p.kind !== "relational" || p.form !== "on" || p.at === undefined) return p;
      const parent = p.ref.form === "id" ? byId.get(p.ref.value) : byName.get(p.ref.value);
      if (!parent) return p; // unresolved refs are the parser's errors, not ours
      if (parent.archetype !== "structure") {
        const chain = chainOf(e.typeWord);
        if (chain.includes("ford") || chain.includes("bridge")) return p; // crossing chooser: a path's frame IS the document grid (spec 06 §6)
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `'on ${p.ref.value} at ${localText(p.at)}' needs a structure footprint to place against — '${p.ref.value}' is a ${parent.archetype} (spec 02 §7)`,
        });
        return p;
      }
      if (parent.level !== e.level) {
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `'on ${p.ref.value} at ${localText(p.at)}' crosses levels — '${displayName(parent)}' is on level ${parent.level || "(default)"}, this entity on ${e.level || "(default)"} (spec 06 §8)`,
        });
        return p;
      }
      const absolute = translateAgainst(p.at, parent, e.line);
      if (!absolute) return p;
      changed = true;
      notes.push(`${localText(p.at)} of ${displayName(parent)} = ${localText(absolute)}`);
      return absolute;
    });

    const details: DetailNode[] = e.details.map((d): DetailNode => {
      const mapped = d.placements.map((p): Placement => {
        if (p.kind !== "relational" || p.form !== "at" || p.target.kind === "point") return p;
        const absolute = translateAgainst(p.target, e, d.line);
        if (!absolute) return p;
        changed = true;
        return absolute;
      });
      return mapped.some((p, k) => p !== d.placements[k]) ? { ...d, placements: mapped } : d;
    });

    if (changed) {
      const clone: EntityNode = { ...e, placements, details };
      entities[index] = clone;
      if (notes.length > 0) resolvedNotes.set(clone, notes.join("; "));
      if (byName.get(e.name ?? "") === e && e.name) byName.set(e.name, clone);
      for (const id of e.ids) if (byId.get(id) === e) byId.set(id, clone);
    }
  });
}

/** Derived-label gate (spec 07 §3): `labels: none` silences everything except `note` free text. */
export function labelsOn(model: Model, e?: { typeWord?: string | null }): boolean {
  return model.labelsMode !== "none" || e?.typeWord === "note";
}

export const anchorAttr = (model: Model, e: { ids: string[]; name: string | null }): string | undefined => {
  const anchor = entityAnchor(e);
  return anchor ? `cd-${model.doc.docId}-${anchor}` : undefined;
};

/** A gm= pair on the entity itself, plus attached [gm] notes — GM mode only. */
export function gmTitleFor(model: Model, e: EntityNode): string | null {
  if (model.mode !== "gm") return null;
  const parts: string[] = [];
  const own = pairOf(e.pairs, "gm");
  if (own) parts.push(own);
  if (e.gmOnly) parts.push(...e.texts);
  const anchor = entityAnchor(e);
  if (anchor) parts.push(...(model.gmNotes.get(anchor) ?? []));
  return parts.length ? parts.join(" ") : null;
}
