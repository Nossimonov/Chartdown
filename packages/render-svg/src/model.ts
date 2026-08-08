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
  Point,
  Ref,
} from "@chartdown/core";
import { loadStdlib, slugify, VocabTable, type Diagnostic } from "@chartdown/core";
import type { Theme } from "./theme";
import { resolveGridPlacements } from "./gridplacement";
import { colLetters, colToNumber, measureToNumber } from "./util";

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
  /** `labels:` header (spec 07 §3): names | keyed (numbered, key in the legend) | none. */
  labelsMode: "names" | "keyed" | "none";
  /** Keyed mode (spec 07 §3, #65): entity/hex-line → its key number. */
  keys: Map<object, number>;
  /**
   * Theme fallback chain for a word (spec 04 §4): the word, then its
   * derivation bases — a theme lookup walks it until a word it knows.
   * Built in spec 04 §2's shadowing order: standard library, then `use:`
   * libraries, then the document's own [vocab] entries. ONE table, matching
   * the parser's (#101) — a shorter chain here means a theme silently stops
   * resolving for exactly the vocabulary that was meant to be shared.
   */
  chainOf(word: string | null): string[];
  /**
   * The archetype a word resolves to through the same table (spec 04 §2).
   * Detail lines carry no resolved archetype of their own, so this is how an
   * opening is recognized whether it is spelled `door`, `portal : door`, or
   * bound straight to the archetype (`hatch : opening`) — #103.
   */
  archetypeOf(word: string | null): string | null;
  /** Vocab facet default for a word (chain-walked); entity pairs override it. */
  facetOf(word: string | null, key: string): string | undefined;
  /** Declared states for a word, unioned along its derivation chain (spec 04 §2). */
  statesOf(word: string | null): Set<string>;
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
          // A DETAIL CARRIES THE FLAG TOO (#295). Spec 01 §6 makes `hidden`
          // legal on ANY content line and player mode fail-closed, and a
          // structure detail is a content line — but the strip above reads only
          // the entity, so `door : at B2.s hidden` written one indent in drew
          // the secret door on the players' sheet, byte-identical to a door
          // nobody was hiding. The same secret written outdented as
          // `door : on cellar at B2.s hidden` was withheld correctly, so the
          // slot decided whether a secret was kept.
          //
          // Stripped HERE rather than in the parser, so the AST keeps saying
          // what the document said and the mode stays the renderer's question.
          entities.push(
            mode === "player" && entry.details.some((d) => d.flags.includes("hidden"))
              ? { ...entry, details: entry.details.filter((d) => !d.flags.includes("hidden")) }
              : entry,
          );
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
  for (const entry of doc.importedVocab) vocab.add(entry, scratch);
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      if (entry.kind === "vocab-entry") vocab.add(entry, scratch);
    }
  }
  const chainOf = (word: string | null): string[] => (word ? vocab.chain(word) : []);
  const archetypeOf = (word: string | null): string | null => (word ? vocab.archetypeOf(word) : null);
  const facetOf = (word: string | null, key: string): string | undefined =>
    word ? vocab.facetOf(word, key) : undefined;
  const statesOf = (word: string | null): Set<string> => (word ? vocab.statesOf(word) : new Set<string>());

  const labelsHeader = header.get("labels");
  const labelsMode: "names" | "keyed" | "none" =
    labelsHeader === "none" ? "none" : labelsHeader === "keyed" ? "keyed" : "names";
  const resolvedNotes = new Map<EntityNode, string>();
  // `every <measure> along <ref>` (#140). The parser could not do this because
  // it must resolve a REFERENCE, not because it needs pixel geometry — the
  // referent's course is cells or points either way, so the spacing is
  // arithmetic once the reference is in hand. Expanding here rather than in
  // each renderer keeps one implementation and lets everything downstream —
  // occlusion, UVTT export, flags, pairs — treat the result as ordinary
  // placements, exactly as `every … in <range>` already does.
  expandEveryAlong(entities, doc, diagnostics);
  if (doc.mapType === "battlemap") {
    resolveRelativePlacements(entities, chainOf, resolvedNotes, diagnostics);
    // The rest of spec 02 §7's forms (#239): `at <cell>` is the bare cell,
    // `from … to …` draws a course, and anything a grid cannot site is
    // REPORTED. Six of the nine forms used to render byte-identically to
    // their own absence — the failure #207 already ruled on.
    resolveGridPlacements(entities, chainOf, diagnostics, "battlemap");
  }
  if (doc.mapType === "hexcrawl") {
    // The same class, one grid short (#248). A hexcrawl's placement loops
    // branch on address/range with no trailing else, exactly as the
    // battlemap's did, so a realm placed `near duchy` drew nothing and said
    // nothing. It answers `at <hex>` — §7 makes `at` optional on grids and
    // this is one — and refuses the rest; what the other forms should MEAN
    // across hexes is per-form design, not something to guess here.
    resolveGridPlacements(entities, chainOf, diagnostics, "hexcrawl");
  }
  // `key=` works outside document-wide keyed mode (#107): a published module
  // is overwhelmingly "a map WITH a key" — ten numbered pins beside forty
  // named rooms — not "a map in key mode", which renumbers every display name.
  // In `names` mode only explicitly pinned entities take a number.
  const keys = labelsMode === "none" ? new Map<object, number>() : assignKeys(entities, hexLines, diagnostics, labelsMode === "keyed");
  return { doc, mode, entities, hexLines, labelOverrides, gmNotes, header, seed, theme, labelsMode, keys, chainOf, archetypeOf, facetOf, statesOf, resolvedNotes };
}

/**
 * Keyed-mode numbering (spec 07 §3, #65): document order, deterministic;
 * `key=<n>` pins an entity's number so later insertions cannot renumber
 * published cross-references. Pins reserve first; the rest fill ascending.
 */
function assignKeys(
  entities: EntityNode[],
  hexLines: HexLineNode[],
  diagnostics: Diagnostic[],
  /** Keyed mode numbers EVERY name; names mode numbers only `key=` pins (#107). */
  numberEverything: boolean,
): Map<object, number> {
  const keys = new Map<object, number>();
  const named: { node: EntityNode | HexLineNode; pin: number | null; line: number }[] = [];
  const collect = (node: EntityNode | HexLineNode): void => {
    if (!node.name || node.flags.includes("nolabel")) return;
    const raw = pairOf(node.pairs, "key");
    const pin = raw !== undefined ? Number(raw) : null;
    if (raw !== undefined && (!Number.isInteger(pin) || pin! < 1)) {
      diagnostics.push({ severity: "error", line: node.line, message: `key=${raw} is not a positive integer (spec 07 §3)` });
      return;
    }
    named.push({ node, pin, line: node.line });
  };
  for (const e of entities) collect(e);
  for (const hex of hexLines) collect(hex);

  const used = new Set<number>();
  for (const n of named) {
    if (n.pin === null) continue;
    if (used.has(n.pin)) {
      diagnostics.push({ severity: "error", line: n.line, message: `key=${n.pin} is pinned twice (spec 07 §3)` });
      continue;
    }
    used.add(n.pin);
    keys.set(n.node, n.pin);
  }
  // Only keyed mode fills the unpinned; in names mode a map keeps its names
  // and just the pinned entities carry numbers.
  if (!numberEverything) return keys;
  let next = 1;
  for (const n of named) {
    if (keys.has(n.node)) continue;
    while (used.has(next)) next++;
    used.add(next);
    keys.set(n.node, next);
  }
  return keys;
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

/** What a label site draws for a named node: the name — or its key number in keyed mode (spec 07 §3). */
export function labelTextFor(model: Model, node: { name: string | null }): string | null {
  if (!node.name) return null;
  // A number wins wherever one was assigned: every name in keyed mode, and
  // only the explicitly pinned ones in names mode (#107).
  const key = model.keys.get(node);
  if (key !== undefined) return String(key);
  if (model.labelsMode === "keyed") return null;
  return node.name;
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

/**
 * Expand `every <measure> along <ref>` into ordinary placements (#140).
 *
 * The referent's course is sampled at the requested spacing: cell addresses on
 * a grid map, points on a gridless one. A course with fewer than two vertices
 * has no direction to walk, and an unresolvable reference is reported rather
 * than silently producing nothing — the whole point of the feature is that the
 * author stops counting positions by hand, so a silent zero would be worse
 * than the hand-written list it replaces.
 */
function expandEveryAlong(entities: EntityNode[], doc: DocumentNode, diagnostics: Diagnostic[]): void {
  const scale = measureToNumber(doc.header.find((h) => h.key === "scale")?.value ?? "5") || 5;
  const courseOf = (ref: Ref): { cells: Address[]; points: Point[] } | null => {
    for (const other of entities) {
      const matches = ref.form === "id" ? other.ids.includes(ref.value) : other.name === ref.value;
      if (!matches) continue;
      const cells: Address[] = [];
      const points: Point[] = [];
      for (const p of other.placements) {
        if (p.kind === "shape") {
          for (const arg of p.args) {
            if (arg.kind === "address") cells.push(arg);
            else if (arg.kind === "point") points.push(arg);
          }
        } else if (p.kind === "relational" && p.form === "from-to") {
          if (p.from.at.kind === "point") points.push(p.from.at);
          // `via` may now carry either (#258), and this walk keeps them apart.
          for (const control of p.via) {
            if (control.kind === "point") points.push(control);
            else cells.push(control);
          }
          if (p.to.at.kind === "point") points.push(p.to.at);
        }
      }
      return { cells, points };
    }
    return null;
  };

  for (const e of entities) {
    const spec = e.placements.find(
      (p): p is Extract<Placement, { kind: "relational"; form: "every-along" }> =>
        p.kind === "relational" && p.form === "every-along",
    );
    if (!spec) continue;
    const course = courseOf(spec.ref);
    if (!course) {
      diagnostics.push({ severity: "error", line: e.line, message: `'every ${spec.measure} along ${spec.ref.value}' — no such feature to follow (spec 02 §9)` });
      continue;
    }
    const step = measureToNumber(spec.measure);
    if (!(step > 0)) {
      diagnostics.push({ severity: "error", line: e.line, message: `'every ${spec.measure} along ${spec.ref.value}' needs a positive spacing (spec 02 §9)` });
      continue;
    }
    const others = e.placements.filter((p) => p !== spec);
    if (course.cells.length > 1) {
      // Grid map: walk the CELLS the course covers, not its vertices. A path
      // is written as corners — `path B4 Z4` is two addresses spanning
      // twenty-five cells — so striding the vertex list placed one lamp at the
      // corner and called it a colonnade.
      const chain: Address[] = [];
      for (let i = 1; i < course.cells.length; i++) {
        const a = course.cells[i - 1]!;
        const b = course.cells[i]!;
        const ac = colToNumber(a.col);
        const bc = colToNumber(b.col);
        const steps = Math.max(Math.abs(bc - ac), Math.abs(b.row - a.row));
        for (let k = 0; k < steps; k++) {
          chain.push({
            kind: "address",
            col: colLetters(ac + Math.round(((bc - ac) * k) / steps)),
            row: a.row + Math.round(((b.row - a.row) * k) / steps),
          });
        }
      }
      chain.push(course.cells[course.cells.length - 1]!);
      const stride = Math.max(1, Math.round(step / scale));
      const picked: Address[] = [];
      for (let i = 0; i < chain.length; i += stride) picked.push(chain[i]!);
      e.placements = [...others, ...picked];
    } else if (course.points.length > 1) {
      // Gridless: walk the polyline by arc length in map units.
      const picked: Point[] = [];
      let carry = 0;
      picked.push(course.points[0]!);
      for (let i = 1; i < course.points.length; i++) {
        const a = course.points[i - 1]!;
        const b = course.points[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let travelled = step - carry;
        while (travelled <= len) {
          const t = travelled / len;
          picked.push({ kind: "point", x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
          travelled += step;
        }
        carry = (carry + len) % step;
      }
      e.placements = [...others, ...picked];
    } else {
      diagnostics.push({ severity: "error", line: e.line, message: `'${spec.ref.value}' has no course to space along — it needs at least two points (spec 02 §9)` });
    }
  }
}
