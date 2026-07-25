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

import type { Address, Pair, Placement } from "@chartdown/core";
import { colLetters, type Segment } from "./util";
import { edgeSegment, perimeterEdges, segKey, structureCells, type Cell, type EdgeFacing } from "./grid";
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

/**
 * `passes=` through the vocabulary chain (spec 04 §1's value set, #113):
 * the entity's own pair, else the word's facet, else `open`.
 *
 * The facet was never consulted — the old rule was effectively "closed unless
 * the line literally says passes=open", so `door` and `window` came out right
 * by accident while `arch : opening sight=all` (the commonest opening in any
 * dungeon) exported as a CLOSED portal. An archway has no leaf.
 */
function passesOf(model: Model, typeWord: string | null, pairs: Pair[]): string {
  return pairOf(pairs, "passes") ?? model.facetOf(typeWord, "passes") ?? "open";
}

/** `sight=` likewise; an opening with no leaf passes sight unless told otherwise. */
function sightOf(model: Model, typeWord: string | null, pairs: Pair[], passes: string): string {
  return pairOf(pairs, "sight") ?? model.facetOf(typeWord, "sight") ?? (passes === "open" ? "all" : "none");
}

export function collectWalls(model: Model): WallGeometry {
  // Openings first, keyed geometrically across ALL owners: an opening declared
  // by either side of a shared edge opens it (spec 06 §3) — and an opening may
  // now perforate declared terrain with no parent structure at all (#113).
  const sightPassSegs = new Set<string>();
  const openingSegs = new Set<string>();
  const portals: Portal[] = [];
  const noteOpening = (typeWord: string | null, pairs: Pair[], placements: readonly Placement[]): void => {
    if (model.archetypeOf(typeWord) !== "opening") return;
    const passes = passesOf(model, typeWord, pairs);
    const sight = sightOf(model, typeWord, pairs, passes);
    for (const p of placements) {
      if (p.kind !== "edge") continue;
      const seg = edgeSegment(p.at, p.dir);
      openingSegs.add(segKey(seg));
      if (sight === "all") sightPassSegs.add(segKey(seg));
      // `open` has no leaf to model: a hole in the wall, and no portal.
      if (passes !== "open") portals.push({ seg, closed: true });
    }
  };
  for (const e of model.entities) {
    if (e.archetype === "structure") {
      for (const d of e.details) noteOpening(d.typeWord, d.pairs, d.placements);
    } else if (e.archetype === "opening") {
      noteOpening(e.typeWord, e.pairs, e.placements);
    }
  }

  const blockers: Segment[] = [];
  const losWalls: Segment[] = [];
  const push = (seg: Segment): void => {
    const key = segKey(seg);
    if (sightPassSegs.has(key)) return; // sight=all: light passes, whoever's wall it is
    blockers.push(seg);
    // spec 06 §9: line_of_sight is the perimeter minus EVERY opening edge;
    // portals carry their own occlusion state in the VTT.
    if (!openingSegs.has(key)) losWalls.push(seg);
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

  // Solid rock is an occluder (spec 06 §5, #113): `earth` is impassable, so
  // the boundary between it and open floor blocks sight exactly as a wall
  // does. Without this a cave system exported with NO occlusion at all except
  // where the author had faked walls around every cave mouth.
  const rock = impassableCells(model);
  if (rock.size > 0) {
    for (const pe of perimeterEdges(rock)) {
      const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
      push(edgeSegment(address, pe.dir));
    }
  }

  return { blockers, losWalls, portals };
}

/**
 * Cells covered by a declared impassable surface — `earth`, or any word
 * inheriting it (spec 04 §2's derivation rule, ADR 0016), so `bedrock : earth`
 * is rock too.
 */
export function impassableCells(model: Model): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const e of model.entities) {
    if (!model.chainOf(e.typeWord).includes("earth")) continue;
    // `earth : area A1..Z20` is a SHAPE placement whose args carry the cells;
    // flatten one level so both spellings resolve to the same cell union.
    const flat: Placement[] = [];
    for (const p of e.placements) {
      if (p.kind === "shape") flat.push(...p.args);
      else flat.push(p);
    }
    for (const [key, cell] of structureCells({ placements: flat })) cells.set(key, cell);
  }
  // Rooms CARVE the rock: spec 06 §5's idiom is that `earth` "fills everything
  // outside the rooms", so a structure's footprint is floor even where earth
  // was declared across it. Without this every room's own cells read as solid
  // and no opening anywhere could find a passable side.
  for (const e of model.entities) {
    if (e.archetype !== "structure") continue;
    for (const key of structureCells(e).keys()) cells.delete(key);
  }
  return cells;
}
