/**
 * Shared battlemap grid geometry — cell metrics used by the renderer, the
 * wall collector (walls.ts), and the UVTT exporter (uvtt.ts, spec 06 §9).
 * One source of truth: exporter geometry can never disagree with the render.
 */

import type { Address, AddressRange, DocumentNode, Placement } from "@chartdown/core";
import { colToNumber, measureToNumber, type Segment, type XY } from "./util";

export const CELL = 32;
export const MARGIN = 24;

export const cellOrigin = (a: Address): XY => ({
  x: MARGIN + (colToNumber(a.col) - 1) * CELL,
  y: MARGIN + (a.row - 1) * CELL,
});

export const cellCenter = (a: Address): XY => {
  const o = cellOrigin(a);
  return { x: o.x + CELL / 2, y: o.y + CELL / 2 };
};

export const rangeRect = (r: AddressRange): { x: number; y: number; w: number; h: number } => {
  const a = cellOrigin(r.from);
  const b = cellOrigin(r.to);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x) + CELL, h: Math.abs(b.y - a.y) + CELL };
};

/** Real-world measure → cells, via the scale: header (e.g. light=20ft at 5ft scale = 4 cells). */
export function measureToCells(measure: string, model: { header: Map<string, string> }): number {
  const scale = measureToNumber(model.header.get("scale") ?? "5") || 5;
  return measureToNumber(measure) / scale;
}

/**
 * Geometric segment key: coincident walls from different structures (a room
 * sharing the courtyard's wall) form ONE wall — an opening in either opens
 * the shared edge (spec 06 §3).
 */
export const segKey = (s: Segment): string => {
  const pts = [s.a, s.b].sort((p, q) => p.x - q.x || p.y - q.y);
  return `${Math.round(pts[0]!.x)},${Math.round(pts[0]!.y)}|${Math.round(pts[1]!.x)},${Math.round(pts[1]!.y)}`;
};

export function edgeSegment(at: Address, dir: string): Segment {
  const o = cellOrigin(at);
  switch (dir) {
    case "n": return { a: { x: o.x, y: o.y }, b: { x: o.x + CELL, y: o.y } };
    case "s": return { a: { x: o.x, y: o.y + CELL }, b: { x: o.x + CELL, y: o.y + CELL } };
    case "w": return { a: { x: o.x, y: o.y }, b: { x: o.x, y: o.y + CELL } };
    // `e` BY NAME, not by fallthrough (#281, ADR 0043). A `default:` standing
    // in for a real case is how four corner tokens became a fifth cardinal:
    // `ne`/`nw`/`se`/`sw` rode the east branch, so a door at C3.nw opened on
    // the far wall. Corners are refused at parse time now, and the next
    // direction added to spec 02 §5 must fail here rather than quietly
    // becoming an east edge.
    case "e": return { a: { x: o.x + CELL, y: o.y }, b: { x: o.x + CELL, y: o.y + CELL } };
    default: throw new Error(`edgeSegment: unhandled direction '${dir}' — spec 02 §5 defines n, e, s, w`);
  }
}

/** The title's own band above the column letters (numbers: on) — index.ts and uvtt.ts must agree. */
export function titleBand(doc: DocumentNode, header: Map<string, string>): number {
  return doc.title && header.get("numbers") === "on" ? 20 : 0;
}

// ---------- cell-union footprints (spec 06 §3, issue #45) ----------

export interface Cell {
  col: number;
  row: number;
}

export const cellKey = (c: Cell): string => `${c.col}:${c.row}`;

/**
 * A structure's footprint: the union of its range and address placements.
 * `building : K5..M8 K9..K12` is an L-shaped hall (spec 06 §3).
 *
 * Takes bare `Address`/`AddressRange` too, because a hex line spells the same
 * union that way (`addresses`) where an entity spells it as placements — and
 * the two shapes are structurally identical. One definition, so a hexcrawl
 * scene cannot disagree with a battlemap one about what `K5..M8` covers.
 */
export function structureCells(
  e: { placements: (Placement | Address | AddressRange)[] },
): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const add = (c: Cell): void => void cells.set(cellKey(c), c);
  for (const p of e.placements) {
    if (p.kind === "address") {
      add({ col: colToNumber(p.col), row: p.row });
    } else if (p.kind === "range") {
      const c1 = Math.min(colToNumber(p.from.col), colToNumber(p.to.col));
      const c2 = Math.max(colToNumber(p.from.col), colToNumber(p.to.col));
      const r1 = Math.min(p.from.row, p.to.row);
      const r2 = Math.max(p.from.row, p.to.row);
      for (let col = c1; col <= c2; col++) for (let row = r1; row <= r2; row++) add({ col, row });
    }
  }
  return cells;
}

/**
 * Cells a terrain or path entity covers: area shapes flatten to their ranges,
 * a `path` shape becomes its band (#146, #147). One definition, so the lints,
 * the wall collector, and the UVTT exporter cannot disagree about what ground
 * a cell has on it — two definitions of "solid" is the shape of #131.
 */
export function surfaceCells(
  e: { pairs: { key: string; value: string }[]; placements: Placement[] },
  ctx?: HalfPlaneContext,
): Map<string, Cell> {
  const width = Number(e.pairs.find((p) => p.key === "width")?.value ?? 1) || 1;
  const cells = new Map<string, Cell>();
  for (const p of e.placements) {
    // A relational extent (spec 06 §6, ADR 0038). Resolved HERE rather than in
    // the renderer so the lints, the wall collector and the UVTT exporter see
    // the same ground the map draws — a derived extent that only the renderer
    // understood would be the two-definitions-of-solid failure this file
    // exists to prevent. Without a context the placement contributes nothing,
    // which is what a region document (no grid to resolve into) wants.
    if (p.kind === "relational" && p.form === "side-of") {
      if (!ctx) continue;
      const course = ctx.courseOf(p.ref);
      if (!course || course.length === 0) continue;
      for (const [key, cell] of halfPlaneCells(p.compass, course, ctx.cols, ctx.rows)) cells.set(key, cell);
      continue;
    }
    if (p.kind === "shape" && p.shape === "path") {
      const vertices = p.args
        .filter((a): a is Address => a.kind === "address")
        .map((a) => ({ col: colToNumber(a.col), row: a.row }));
      for (const [key, cell] of pathBandCells(vertices, width)) cells.set(key, cell);
      continue;
    }
    const flat = p.kind === "shape" ? p.args : [p];
    for (const [key, cell] of structureCells({ placements: flat })) cells.set(key, cell);
  }
  return cells;
}

/** What a `side-of` placement needs to resolve: the grid, and the referent's spine. */
export interface HalfPlaneContext {
  cols: number;
  rows: number;
  /** The referenced entity's declared course in grid cells, or null if it has none. */
  courseOf: (ref: { form: string; value: string }) => Cell[] | null;
}

/**
 * The resolution context for a battlemap document. Built once and handed to
 * every `surfaceCells` caller, so a relational extent reads the same to the
 * renderer, the lints, the wall collector and the exporter.
 *
 * A reference resolves by id or by display name (spec 03 §2), and yields the
 * referent's DECLARED spine — its `path` corners — not its drawn band. The
 * spine is what the centre rule measures against, and it is stable under the
 * band's own drawing choices (#145's edge extension, the 0.85 ink factor).
 */
export function halfPlaneContext(
  doc: DocumentNode,
  entities: { ids: string[]; name: string | null; placements: Placement[] }[],
): HalfPlaneContext {
  return {
    cols: doc.grid?.cols ?? 20,
    rows: doc.grid?.rows ?? 15,
    courseOf: (ref) => {
      const host = entities.find((e) => (ref.form === "id" ? e.ids.includes(ref.value) : e.name === ref.value));
      if (!host) return null;
      for (const p of host.placements) {
        if (p.kind !== "shape" || p.shape !== "path") continue;
        const vs = p.args
          .filter((a): a is Address => a.kind === "address")
          .map((a) => ({ col: colToNumber(a.col), row: a.row }));
        if (vs.length > 1) return vs;
      }
      return null;
    },
  };
}

/**
 * Cells on the far side of a course (spec 06 §6, ADR 0038).
 *
 * **A cell is covered when its CENTRE lies strictly beyond the course** — the
 * same centre-reading a path's own cells, crossings and lints use, so the two
 * cannot disagree about which side of a river a square is on. Strictness is
 * what sends TIES to the reference: a cell whose centre sits on the course
 * belongs to the watercourse, not to the wood beside it. Measured against the
 * document that motivated this, the rule reproduces an author's hand-tiling in
 * 20 of 22 cells; the two it does not are a rectangle's spare corners.
 *
 * Where the course runs SQUARE to the compass — a river heading due north for
 * three cells while the fill lies north of it — that column has a whole span of
 * course rather than one crossing, and the fill must clear ALL of it. Taking
 * the extreme (the northernmost row for `north of`) is what makes the vertical
 * run behave; interpolating a single value would put forest in the river.
 *
 * Beyond the course's own span the half-plane still covers the FULL grid, as it
 * does on a region map (spec 05 §2) — a frontier trimmed to the map's middle
 * still claims the corners — so the end values extend outward.
 */
export function halfPlaneCells(compass: string, course: Cell[], cols: number, rows: number): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const c = compass.toLowerCase();
  const vertical = (c.includes("n") || c.includes("s")) && !c.includes("e") && !c.includes("w");
  const near = c.includes("n") || c.includes("w"); // the side with the SMALLER coordinate
  // Along the axis the fill is measured on, where does the course sit at `at`?
  const courseAt = (at: number): number | null => {
    const vals: number[] = [];
    for (let i = 0; i < course.length - 1; i++) {
      const a = course[i]!;
      const b = course[i + 1]!;
      const [a0, b0, a1, b1] = vertical ? [a.col, b.col, a.row, b.row] : [a.row, b.row, a.col, b.col];
      const lo = Math.min(a0, b0);
      const hi = Math.max(a0, b0);
      if (at < lo || at > hi) continue;
      if (a0 === b0) { vals.push(a1, b1); continue; } // square to the fill: the whole span counts
      vals.push(a1 + ((b1 - a1) * (at - a0)) / (b0 - a0));
    }
    if (vals.length === 0) return null;
    return near ? Math.min(...vals) : Math.max(...vals);
  };
  const axis = course.map((p) => (vertical ? p.col : p.row));
  const lo = Math.min(...axis);
  const hi = Math.max(...axis);
  for (let col = 1; col <= cols; col++) {
    for (let row = 1; row <= rows; row++) {
      const at = vertical ? col : row;
      const boundary = courseAt(Math.min(Math.max(at, lo), hi));
      if (boundary === null) continue;
      const here = vertical ? row : col;
      if (near ? here < boundary : here > boundary) cells.set(cellKey({ col, row }), { col, row });
    }
  }
  return cells;
}

/**
 * Cells a PATH covers, in grid space (#146, #147).
 *
 * A path is a polyline through cell centres with a width in cells (spec 06
 * §6), so its args are only its corners: `road : path A8 T8 width=3` names two
 * cells and covers fifty-seven. Anything asking what ground a road lies on —
 * whether it is walkable, whether it overpaints rock — needs the band, and
 * counting corners answered "almost none of it".
 *
 * Membership is the spec's plain reading: a cell is in the band when its
 * centre lies within `width / 2` cells of the polyline. The renderer draws
 * marginally narrower (a 0.85 factor, so adjacent bands show a gap), which is
 * a drawing choice; for the questions above, being a shade generous is the
 * right direction to err.
 */
export function pathBandCells(vertices: Cell[], widthCells: number): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  if (vertices.length === 0) return cells;
  const half = Math.max(widthCells, 1) / 2;
  const pad = Math.ceil(half) + 1;
  const cols = vertices.map((v) => v.col);
  const rows = vertices.map((v) => v.row);
  const c0 = Math.max(1, Math.min(...cols) - pad);
  const c1 = Math.max(...cols) + pad;
  const r0 = Math.max(1, Math.min(...rows) - pad);
  const r1 = Math.max(...rows) + pad;
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const p = { x: col - 0.5, y: row - 0.5 };
      let best = Infinity;
      for (let i = 0; i + 1 < vertices.length; i++) {
        best = Math.min(best, distToSegment(p, vertices[i]!, vertices[i + 1]!));
      }
      if (vertices.length === 1) best = Math.hypot(p.x - (vertices[0]!.col - 0.5), p.y - (vertices[0]!.row - 0.5));
      if (best <= half) cells.set(cellKey({ col, row }), { col, row });
    }
  }
  return cells;
}

function distToSegment(p: { x: number; y: number }, a: Cell, b: Cell): number {
  const ax = a.col - 0.5, ay = a.row - 0.5, bx = b.col - 0.5, by = b.row - 0.5;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lengthSquared));
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

export type EdgeFacing = "n" | "e" | "s" | "w";

export interface PerimeterEdge {
  cell: Cell;
  dir: EdgeFacing;
}

const NEIGHBOR: Record<EdgeFacing, { dc: number; dr: number }> = {
  n: { dc: 0, dr: -1 },
  s: { dc: 0, dr: 1 },
  w: { dc: -1, dr: 0 },
  e: { dc: 1, dr: 0 },
};

/** Boundary edges of a cell union — the derived perimeter (spec 06 §3). Deterministic order. */
export function perimeterEdges(cells: Map<string, Cell>): PerimeterEdge[] {
  const edges: PerimeterEdge[] = [];
  const ordered = [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const cell of ordered) {
    for (const dir of ["n", "e", "s", "w"] as const) {
      const n = NEIGHBOR[dir];
      if (!cells.has(cellKey({ col: cell.col + n.dc, row: cell.row + n.dr }))) edges.push({ cell, dir });
    }
  }
  return edges;
}

export interface EdgeRun {
  dir: EdgeFacing;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Merge collinear adjacent perimeter edges into runs — one clean wall line per
 * straight stretch (a plain rectangle yields exactly its four sides, in
 * n, s, w, e order to match the renderer's historical output).
 */
export function mergeEdgeRuns(edges: PerimeterEdge[]): EdgeRun[] {
  const runs: EdgeRun[] = [];
  const horizontal = (dir: "n" | "s"): void => {
    const rows = new Map<string, number[]>();
    for (const e of edges) {
      if (e.dir !== dir) continue;
      const key = String(e.cell.row);
      const list = rows.get(key) ?? [];
      list.push(e.cell.col);
      rows.set(key, list);
    }
    for (const [rowKey, cols] of [...rows.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const row = Number(rowKey);
      cols.sort((a, b) => a - b);
      let start = cols[0]!;
      let prev = cols[0]!;
      const y = MARGIN + (row - 1) * CELL + (dir === "s" ? CELL : 0);
      const flush = (endCol: number): void =>
        void runs.push({ dir, x1: MARGIN + (start - 1) * CELL, y1: y, x2: MARGIN + endCol * CELL, y2: y });
      for (const col of cols.slice(1)) {
        if (col !== prev + 1) {
          flush(prev);
          start = col;
        }
        prev = col;
      }
      flush(prev);
    }
  };
  const vertical = (dir: "w" | "e"): void => {
    const cols = new Map<string, number[]>();
    for (const e of edges) {
      if (e.dir !== dir) continue;
      const key = String(e.cell.col);
      const list = cols.get(key) ?? [];
      list.push(e.cell.row);
      cols.set(key, list);
    }
    for (const [colKey, rowList] of [...cols.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const col = Number(colKey);
      rowList.sort((a, b) => a - b);
      let start = rowList[0]!;
      let prev = rowList[0]!;
      const x = MARGIN + (col - 1) * CELL + (dir === "e" ? CELL : 0);
      const flush = (endRow: number): void =>
        void runs.push({ dir, x1: x, y1: MARGIN + (start - 1) * CELL, x2: x, y2: MARGIN + endRow * CELL });
      for (const row of rowList.slice(1)) {
        if (row !== prev + 1) {
          flush(prev);
          start = row;
        }
        prev = row;
      }
      flush(prev);
    }
  };
  horizontal("n");
  horizontal("s");
  vertical("w");
  vertical("e");
  return runs;
}
