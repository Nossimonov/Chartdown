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

import { facetAccepts, type Address, type Pair, type Placement } from "@chartdown/core";
import { colLetters, type Segment } from "./util";
import { edgeSegment, halfPlaneContext, perimeterEdges, segKey, structureCells, surfaceCells, type Cell, type EdgeFacing } from "./grid";
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
  return declared(pairs, "passes") ?? model.facetOf(typeWord, "passes") ?? "open";
}

/** `sight=` likewise; an opening with no leaf passes sight unless told otherwise. */
function sightOf(model: Model, typeWord: string | null, pairs: Pair[], passes: string): string {
  return declared(pairs, "sight") ?? model.facetOf(typeWord, "sight") ?? (passes === "open" ? "all" : "none");
}

/**
 * An entity's own closed-facet value, or `undefined` if it is outside the set
 * — so resolution falls through to the vocabulary default, which is what the
 * warning promises (#131). `facetOf` applies the same rule up the chain.
 *
 * Without the guard `passes=bogus` merely failed the `!== "open"` test and
 * became a shut portal, so a typo on an `arch` — an opening whose whole point
 * is that it has no leaf — exported as blocked.
 */
function declared(pairs: Pair[], key: string): string | undefined {
  const value = pairOf(pairs, key);
  return value !== undefined && facetAccepts(key, value) ? value : undefined;
}

/**
 * Perimeter edges a structure detail has replaced with a different barrier
 * (#130), keyed geometrically → the barrier's type word.
 *
 * `cave-in : east` is the spelling authors reach for, and until now it drew an
 * ordinary wall and took no styling. The working alternative — a freestanding
 * barrier on the same edges — is still legal and still merges by the
 * coincident-wall rule, but it costs one edge token per cell: migrating ten of
 * these lines on the Moria map took 337 hand-written tokens, because a big
 * room's side is a long run.
 *
 * Shared by the renderer and the UVTT exporter deliberately. They disagreeing
 * about which edges a side covers is the #126/#131 failure shape — one
 * definition, two consumers.
 */
export function barrierSides(
  model: Model,
  e: { details: { typeWord: string | null; flags: string[]; placements: Placement[] }[]; placements: Placement[] },
): Map<string, string> {
  const replaced = new Map<string, string>();
  const details = e.details.filter((d) => model.archetypeOf(d.typeWord) === "barrier");
  if (details.length === 0) return replaced;
  const cells = structureCells(e);
  if (cells.size === 0) return replaced;
  const perimeter = perimeterEdges(cells);
  for (const d of details) {
    const word = d.typeWord!;
    // Edge tokens name their edges outright; a detail line's placements may be
    // `at`-prefixed for the parent frame (spec 02 §7), so unwrap those too.
    for (const p of d.placements) {
      const edge = p.kind === "edge" ? p : p.kind === "relational" && p.form === "at" && p.target.kind === "edge" ? p.target : null;
      if (edge) replaced.set(segKey(edgeSegment(edge.at, edge.dir)), word);
    }
    // Side words select every perimeter edge FACING that way — so an L-shaped
    // hall's `east` is all of its east-facing edges, exactly as `ruined` works
    // on a cell union rather than on a rectangle's whole side.
    const sides = new Set(d.flags);
    if (sides.size === 0) continue;
    for (const pe of perimeter) {
      if (!sides.has(SIDE_NAME[pe.dir]) && !sides.has(pe.dir)) continue;
      const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
      replaced.set(segKey(edgeSegment(address, pe.dir)), word);
    }
  }
  return replaced;
}

/**
 * Does this barrier stop sight? THE FACET DECIDES AND THE WORD DOES NOT —
 * spec 06 §3 states that outright, and spec 04 §1 makes `sight=` the thing
 * that "decides whether an edge is a hole in `line_of_sight`" (#396).
 *
 * A barrier's sight default is the opposite of an opening's: `sightOf` assumes
 * no leaf means sight passes, which is right for an arch and exactly wrong for
 * a wall. So the default here is `none` — a cave-in is opaque, a `fence`-derived
 * choke passes sight.
 *
 * ONE predicate for both paths. They disagreed: the structure-detail path read
 * the facet while the freestanding path tested the literal word `fence`, so
 * `hedge : barrier sight=all` exported three occluding segments standing on its
 * own and none replacing a room's side — the same declaration, opposite
 * exports, decided by which slot it was written in. A hedge, a rope line, a row
 * of stakes: anything that stops bodies but not sight, declared honestly, went
 * to a VTT as a wall. And `thicket : fence sight=none` did the reverse, ignoring
 * an explicit override because its chain mentioned `fence`.
 */
export function barrierOccludes(model: Model, word: string | null): boolean {
  return (model.facetOf(word, "sight") ?? "none") !== "all";
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
      // A side replaced by another barrier occludes as THAT barrier does
      // (#130): a portcullis across a hall mouth still stops bodies, and a
      // `fence`-derived choke passes sight where the wall it replaced did not.
      const replaced = barrierSides(model, e);
      for (const pe of perimeterEdges(cells)) {
        if (ruined.has(SIDE_NAME[pe.dir]) || ruined.has(pe.dir)) continue;
        const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
        const seg = edgeSegment(address, pe.dir);
        const word = replaced.get(segKey(seg));
        if (word !== undefined && !barrierOccludes(model, word)) continue;
        push(seg);
      }
    } else if (e.archetype === "barrier" && barrierOccludes(model, e.typeWord)) {
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
  // A cell is rock only if `earth` is the WINNING declaration on it, not merely
  // one that was made (#125). Spec 06 §6: declaration order breaks ties within
  // a kind, and spec 06 §5's own idiom is to lay ground truth across a level
  // and paint over it — so testing mere membership counted overpainted grass
  // as solid stone, and let an opening across open ground pass the check.
  // A PATH overpaints the area beneath it too (#147). Spec 06 §6 layers area
  // terrain beneath path bands, so a road driven through rock is a cut
  // passage, not stone — the Deep-road under Moria is the case. Reading only
  // `terrain` here made a great highway occlude like bedrock, and made every
  // door opening onto it a door onto solid rock.
  const winner = new Map<string, { cell: Cell; impassable: boolean }>();
  const hp = halfPlaneContext(model.doc, model.entities);
  for (const e of model.entities) {
    if (e.archetype !== "terrain" && e.archetype !== "path") continue;
    const impassable = model.chainOf(e.typeWord).includes("earth");
    // `earth : area A1..Z20` is a SHAPE placement whose args carry the cells;
    // a `path` shape carries only its corners and covers its band.
    for (const [key, cell] of surfaceCells(e, hp)) winner.set(key, { cell, impassable });
  }
  const cells = new Map<string, Cell>();
  for (const [key, w] of winner) if (w.impassable) cells.set(key, w.cell);
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
