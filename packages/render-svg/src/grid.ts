/**
 * Shared battlemap grid geometry — cell metrics used by the renderer, the
 * wall collector (walls.ts), and the UVTT exporter (uvtt.ts, spec 06 §9).
 * One source of truth: exporter geometry can never disagree with the render.
 */

import type { Address, AddressRange, DocumentNode } from "@chartdown/core";
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
