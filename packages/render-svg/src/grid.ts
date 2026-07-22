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
    default: return { a: { x: o.x + CELL, y: o.y }, b: { x: o.x + CELL, y: o.y + CELL } };
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
 */
export function structureCells(e: { placements: Placement[] }): Map<string, Cell> {
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
