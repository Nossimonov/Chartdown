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

import type { Address, AddressRange } from "@chartdown/core";
import { colLetters, colToNumber, type Segment } from "./util";
import { edgeSegment, segKey } from "./grid";
import { pairOf, type Model } from "./model";

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
      const range = e.placements.find((p): p is AddressRange => p.kind === "range");
      if (!range) continue;
      const ruined = new Set(e.details.filter((d) => d.typeWord === "ruined").flatMap((d) => d.flags));
      const c1 = Math.min(colToNumber(range.from.col), colToNumber(range.to.col));
      const c2 = Math.max(colToNumber(range.from.col), colToNumber(range.to.col));
      const r1 = Math.min(range.from.row, range.to.row);
      const r2 = Math.max(range.from.row, range.to.row);
      const sideCells: Record<string, { col: number; row: number; dir: "n" | "s" | "e" | "w" }[]> = {
        north: [], south: [], west: [], east: [],
      };
      for (let col = c1; col <= c2; col++) {
        sideCells["north"]!.push({ col, row: r1, dir: "n" });
        sideCells["south"]!.push({ col, row: r2, dir: "s" });
      }
      for (let row = r1; row <= r2; row++) {
        sideCells["west"]!.push({ col: c1, row, dir: "w" });
        sideCells["east"]!.push({ col: c2, row, dir: "e" });
      }
      for (const [side, cells] of Object.entries(sideCells)) {
        if (ruined.has(side) || ruined.has(side[0]!)) continue;
        for (const cell of cells) {
          const address: Address = { kind: "address", col: colLetters(cell.col), row: cell.row };
          push(edgeSegment(address, cell.dir));
        }
      }
    } else if (e.archetype === "barrier" && !model.chainOf(e.typeWord).includes("fence")) {
      for (const p of e.placements) {
        if (p.kind === "edge") push(edgeSegment(p.at, p.dir));
      }
    }
  }

  return { blockers, losWalls, portals };
}
