/**
 * The Chartdown AST — the documented shape promised by issue #21.
 * Node kinds mirror the spec: entities (spec 01 §4), placements (spec 02),
 * hex ledger lines (spec 05 §3), vocab entries (spec 04 §2),
 * label overrides (spec 07 §2), and gm attachments (spec 03 §5).
 */

// ---------- placements (spec 02) ----------

export interface Address {
  kind: "address";
  col: string;
  row: number;
}

export interface AddressRange {
  kind: "range";
  from: Address;
  to: Address;
}

export interface Point {
  kind: "point";
  x: number;
  y: number;
}

export interface PointRange {
  kind: "point-range";
  from: Point;
  to: Point;
}

export type EdgeDir = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

export interface Edge {
  kind: "edge";
  at: Address;
  dir: EdgeDir;
}

export type ShapeKind = "area" | "path" | "blob" | "ridge";

export interface Shape {
  kind: "shape";
  shape: ShapeKind;
  args: Placement[];
}

/** A reference to another entity: bare word = id lookup, quoted = display-name lookup (spec 03 §2). */
export interface Ref {
  kind: "ref";
  form: "id" | "name";
  value: string;
}

export interface Endpoint {
  at: Ref | Point;
  point?: Point;
}

export type Relational =
  | { kind: "relational"; form: "at"; target: Point | Address }
  | { kind: "relational"; form: "offset-of"; measure: string; compass: string; ref: Ref }
  | { kind: "relational"; form: "side-of"; compass: string; ref: Ref }
  | { kind: "relational"; form: "on"; ref: Ref; point?: Point }
  | { kind: "relational"; form: "edge-of"; compass: string; ref: Ref }
  | { kind: "relational"; form: "near"; target: Ref | Point }
  | { kind: "relational"; form: "from-to"; from: Endpoint; via: Point[]; to: Endpoint }
  | { kind: "relational"; form: "along"; ref: Ref };

export type Placement = Address | AddressRange | Point | PointRange | Edge | Shape | Relational;

// ---------- content nodes ----------

export interface Pair {
  key: string;
  value: string;
}

export type ArchetypeSource = "vocab" | "inferred-shape" | "inferred-section" | "default";

export interface EntityNode {
  kind: "entity";
  section: string;
  typeWord: string | null;
  ids: string[];
  name: string | null;
  /** Resolved through vocabulary (spec 04 §2) or inferred (spec 04 §3). */
  archetype: string;
  archetypeSource: ArchetypeSource;
  placements: Placement[];
  flags: string[];
  pairs: Pair[];
  texts: string[];
  details: DetailNode[];
  gmOnly: boolean;
  line: number;
}

export interface DetailNode {
  kind: "detail";
  typeWord: string | null;
  ids: string[];
  name: string | null;
  placements: Placement[];
  flags: string[];
  pairs: Pair[];
  texts: string[];
  line: number;
}

export interface HexLineNode {
  kind: "hex-line";
  addresses: (Address | AddressRange)[];
  terrain: string;
  contents: string[];
  name: string | null;
  flags: string[];
  pairs: Pair[];
  line: number;
}

export interface VocabEntryNode {
  kind: "vocab-entry";
  word: string;
  /** An archetype name or another vocabulary word (derivation, spec 04 §2). */
  base: string;
  baseIsArchetype: boolean;
  pairs: Pair[];
  flags: string[];
  source: "stdlib" | "library" | "document";
  line: number;
}

export interface GmAttachmentNode {
  kind: "gm-attachment";
  target: Ref;
  texts: string[];
  pairs: Pair[];
  flags: string[];
  line: number;
}

export type LabelHint =
  | { kind: "sprawl"; range: AddressRange | PointRange }
  | { kind: "along"; ref: Ref }
  | { kind: "at"; target: Point | Address }
  | { kind: "side"; compass: string };

export interface LabelOverrideNode {
  kind: "label-override";
  target: Ref;
  hint: LabelHint;
  line: number;
}

export type EntryNode =
  | EntityNode
  | HexLineNode
  | VocabEntryNode
  | GmAttachmentNode
  | LabelOverrideNode;

export interface SectionNode {
  kind: "section";
  name: string;
  known: boolean;
  entries: EntryNode[];
  line: number;
}

export interface HeaderEntry {
  key: string;
  value: string;
  line: number;
}

export interface GridSpec {
  kind: "square" | "hex";
  cols: number;
  rows: number;
  orientation?: "pointy" | "flat";
  parity?: "odd-row" | "even-row" | "odd-col" | "even-col";
}

export interface DocumentNode {
  kind: "document";
  title: string | null;
  docId: string;
  mapType: string;
  header: HeaderEntry[];
  grid: GridSpec | null;
  sections: SectionNode[];
}
