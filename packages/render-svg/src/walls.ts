/**
 * Wall geometry shared by the light engine (battlemap.ts) and the UVTT
 * exporter (uvtt.ts): per-cell-edge structure perimeters minus ruined sides,
 * openings keyed geometrically so coincident walls are one wall (spec 06 §3),
 * plus freestanding barriers.
 *
 * Two views of the same walls:
 * - `blockers` — what blocks SIGHT for light rendering: walls and closed
 *   doors block; windows pass (their edges are holes).
 * - `losWalls` — UVTT line_of_sight: walls minus EVERY portal edge; portals
 *   carry their own occlusion state in the VTT (spec 06 §9).
 */

import type { Address } from "@chartdown/core";
import { colLetters, type Segment } from "./util";
import { edgeSegment, perimeterEdges, segKey, structureCells, type EdgeFacing } from "./grid";
import { pairOf, type Model } from "./model";

export const SIDE_NAME: Record<EdgeFacing, string> = { n: "north", s: "south", w: "west", e: "east" };

export interface Portal {
  seg: Segment;
  /** From the `passes` facet: doors are closed by default; windows never open. */
  closed: boolean;
}

export interface WallGeometry {
  blockers: Segment[];
  losWalls: Segment[];
  portals: Portal[];
}

export function collectWalls(model: Model): WallGeometry {
  // Openings first, keyed geometrically across ALL structures: a window in
  // either owner of a shared edge opens it (spec 06 §3).
  const windowSegs = new Set<string>();
  const doorSegs = new Set<string>();
  const portals: Portal[] = [];
  for (const e of model.entities) {
    if (e.archetype !== "structure") continue;
    for (const d of e.details) {
      const chain = model.chainOf(d.typeWord);
      const isWindow = chain.includes("window");
      const isDoor = !isWindow && (chain.includes("door") || chain.includes("gate"));
      if (!isWindow && !isDoor) continue;
      for (const p of d.placements) {
        if (p.kind !== "edge") continue;
        const seg = edgeSegment(p.at, p.dir);
        (isWindow ? windowSegs : doorSegs).add(segKey(seg));
        portals.push({ seg, closed: pairOf(d.pairs, "passes") !== "open" });
      }
    }
  }

  const blockers: Segment[] = [];
  const losWalls: Segment[] = [];
  const push = (seg: Segment): void => {
    const key = segKey(seg);
    if (windowSegs.has(key)) return; // sight=all: light passes, whoever's wall it is
    blockers.push(seg);
    if (!doorSegs.has(key)) losWalls.push(seg);
  };

  for (const e of model.entities) {
    if (e.archetype === "structure") {
      // Cell-union footprint with a DERIVED perimeter (spec 06 §3, #45); a
      // `ruined` side word selects the perimeter edges FACING that direction —
      // for a plain rectangle that is exactly the historical whole-side rule.
      const cells = structureCells(e);
      if (cells.size === 0) continue;
      const ruined = new Set(e.details.filter((d) => d.typeWord === "ruined").flatMap((d) => d.flags));
      for (const pe of perimeterEdges(cells)) {
        if (ruined.has(SIDE_NAME[pe.dir]) || ruined.has(pe.dir)) continue;
        const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
        push(edgeSegment(address, pe.dir));
      }
    } else if (e.archetype === "barrier" && !model.chainOf(e.typeWord).includes("fence")) {
      for (const p of e.placements) {
        if (p.kind === "edge") push(edgeSegment(p.at, p.dir));
      }
    }
  }

  return { blockers, losWalls, portals };
}
