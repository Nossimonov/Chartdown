/**
 * Coherence lints (#123, from the #80 decision): six warning-level checks over
 * geometry the renderer has already resolved.
 *
 * These describe things a document can *say* that no rule forbids and no
 * reader would mean — a door opening onto solid rock, a room with no way in.
 * The prototype that motivated them found 32 such defects in a Moria map that
 * passed `check` and rendered without a single warning.
 *
 * Every one is a WARNING and never an error. They reason about intent, not
 * legality, so a false positive must cost an author nothing but a line of
 * output — and there is no suppression syntax yet, deliberately, until real
 * false positives argue for one.
 */

import type { Address, EntityNode } from "@chartdown/core";
import { colLetters, type Segment } from "./util";
import { cellKey, edgeSegment, perimeterEdges, segKey, structureCells, type Cell } from "./grid";
import { impassableCells } from "./walls";
import type { Model } from "./model";

/**
 * Warning-level only, by decision (#80). These reason about intent rather than
 * legality, so a false positive must cost an author a line of output and never
 * a blocked render.
 */
interface Lint {
  severity: "error" | "warning";
  line: number;
  message: string;
}

/** Cells a terrain entity covers, flattening `area` shapes to their args. */
function terrainCells(e: EntityNode): Map<string, Cell> {
  const flat = e.placements.flatMap((p) => (p.kind === "shape" ? p.args : [p]));
  return structureCells({ placements: flat });
}

/**
 * The WINNING terrain word per cell on one level (spec 06 §6: declaration
 * order breaks ties). The same rule `impassableCells` follows, and for the same
 * reason — spec 06 §5's idiom is to lay ground truth across a level and paint
 * over it, so mere membership is not coverage.
 */
function surfaceByCell(model: Model, level: string): Map<string, string> {
  const winner = new Map<string, string>();
  for (const e of model.entities) {
    if (e.archetype !== "terrain" || e.level !== level) continue;
    for (const key of terrainCells(e).keys()) winner.set(key, e.typeWord ?? "");
  }
  return winner;
}

export function coherenceLints(model: Model, level: string, diagnostics: Lint[]): void {
  const on = <T extends { level: string }>(xs: T[]): T[] => xs.filter((x) => x.level === level);
  const structures = on(model.entities.filter((e) => e.archetype === "structure"));
  const surface = surfaceByCell(model, level);
  const rock = impassableCells(model);

  const walkable = (c: Cell): boolean => {
    const key = cellKey(c);
    if (rock.has(key)) return false;
    const word = surface.get(key);
    if (word === undefined) return true; // undeclared ground is ordinary floor
    const chain = model.chainOf(word);
    // `terrace` is walkable raised ground; `air`/`void` are declared absence of
    // floor, which is the whole point of the word (spec 06 §5).
    if (chain.includes("terrace")) return true;
    return !chain.includes("air");
  };

  // 1 — door-onto-void: an opening whose far side is not walkable. Windows and
  // arrow-slits are exempt: facing open air is their job.
  const openingEdges: { e: EntityNode; seg: Segment; at: Address; dir: string }[] = [];
  for (const e of on(model.entities)) {
    const collect = (word: string | null, placements: readonly { kind: string }[], owner: EntityNode): void => {
      if (model.archetypeOf(word) !== "opening") return;
      if (model.facetOf(word, "passes") === "none") return; // window family
      for (const p of placements as { kind: string; at?: Address; dir?: string }[]) {
        if (p.kind !== "edge" || !p.at || !p.dir) continue;
        openingEdges.push({ e: owner, seg: edgeSegment(p.at, p.dir as never), at: p.at, dir: p.dir });
      }
    };
    collect(e.typeWord, e.placements, e);
    for (const d of e.details) collect(d.typeWord, d.placements, e);
  }
  // "Far side" only means something when the opening belongs to a STRUCTURE —
  // you walk OUT of a room. An opening with no parent structure is #113's cave
  // mouth, which is rock on one side and floor on the other BY DESIGN and is
  // already validated by its own rule. Checking those here reported the
  // language's newest feature as a defect, which is how this false positive
  // was caught before shipping.
  for (const o of openingEdges) {
    const owner = structures.find((s) => structureCells(s).has(cellKey({ col: colNum(o.at.col), row: o.at.row })));
    if (!owner) continue;
    const cells = structureCells(owner);
    const far =
      o.dir === "n" ? { col: colNum(o.at.col), row: o.at.row - 1 } :
      o.dir === "s" ? { col: colNum(o.at.col), row: o.at.row + 1 } :
      o.dir === "e" ? { col: colNum(o.at.col) + 1, row: o.at.row } :
      o.dir === "w" ? { col: colNum(o.at.col) - 1, row: o.at.row } : null;
    if (!far || far.row < 1 || far.col < 1) continue;
    if (cells.has(cellKey(far))) continue; // an interior edge, not a way out
    if (walkable(far)) continue;
    diagnostics.push({
      severity: "warning",
      line: o.e.line,
      message: `the opening at ${o.at.col}${o.at.row}.${o.dir} leads out onto ground that cannot be walked on — a door onto solid rock or open air (spec 06 §3)`,
    });
  }

  // 2 — structure-over-surface: a footprint on a same-level roof or air.
  for (const s of structures) {
    if (s.flags.includes("open")) continue; // courtyards have defined sky semantics
    for (const key of structureCells(s).keys()) {
      const word = surface.get(key);
      if (word === undefined) continue;
      const chain = model.chainOf(word);
      if (chain.includes("terrace")) continue;
      if (!chain.includes("air") && !chain.includes("roof")) continue;
      diagnostics.push({
        severity: "warning",
        line: s.line,
        message: `this structure stands on '${word}', which is not a floor — a building on open air or another room's ceiling (spec 06 §5)`,
      });
      break;
    }
  }

  // 3 — unreachable-room: no opening on its perimeter and no connector inside.
  for (const s of structures) {
    const cells = structureCells(s);
    if (cells.size === 0) continue;
    const perimeter = new Set(
      perimeterEdges(cells).map((pe) => segKey(edgeSegment({ kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row }, pe.dir))),
    );
    const hasOpening = openingEdges.some((o) => perimeter.has(segKey(o.seg)));
    // A connector reaching this room may be declared on EITHER level — the
    // stair down to an undercroft is written on the floor above, and spec 06
    // §8's reciprocal landing is what puts it here. Looking only at same-level
    // connectors reported the manor's cellar as unreachable when the stairs
    // into it were three lines away.
    const hasConnector = model.entities.some((e) => {
      const to = e.pairs.find((p) => p.key === "to")?.value;
      if (to === undefined) return false;
      const reachesHere = e.level === level || to === level || to.split("..").includes(level);
      if (!reachesHere) return false;
      const atValue = e.pairs.find((p) => p.key === "at")?.value;
      const landing = atValue ?? null;
      const addresses = e.placements.filter((p): p is Address => p.kind === "address");
      const targets = landing ? [landing] : addresses.map((a) => `${a.col}${a.row}`);
      return targets.some((t) => {
        const m = /^([A-Z]+)(\d+)$/.exec(t);
        return m !== null && cells.has(cellKey({ col: colNum(m[1]!), row: Number(m[2]) }));
      });
    });
    if (!hasOpening && !hasConnector) {
      diagnostics.push({
        severity: "warning",
        line: s.line,
        message: `this structure has no opening and no connector inside it — nothing can reach it (spec 06 §3)`,
      });
    }
  }

  // 4 — dangling-connector: the landing cell is not walkable on the target level.
  for (const e of on(model.entities)) {
    const to = e.pairs.find((p) => p.key === "to")?.value;
    if (to === undefined || to.includes("..")) continue; // a range lands on many; checked per level as each renders
    const landing = e.placements.find((p): p is Address => p.kind === "address");
    if (!landing) continue;
    const targetSurface = surfaceByCell(model, to);
    const word = targetSurface.get(cellKey({ col: colNum(landing.col), row: landing.row }));
    if (word === undefined) continue;
    const chain = model.chainOf(word);
    if (chain.includes("terrace") || (!chain.includes("air") && !chain.includes("earth"))) continue;
    diagnostics.push({
      severity: "warning",
      line: e.line,
      message: `this connector lands on '${word}' on level '${to}', which cannot be stood on (spec 06 §8)`,
    });
  }

  // 5 — overlapping-structures: two on one level sharing cells.
  for (let i = 0; i < structures.length; i++) {
    for (let j = i + 1; j < structures.length; j++) {
      const a = structureCells(structures[i]!);
      const b = structureCells(structures[j]!);
      const shared = [...a.keys()].filter((k) => b.has(k)).length;
      if (shared === 0) continue;
      // CONTAINMENT is not overlap. A snug in the corner of an inn, a vault
      // inside a keep, a shrine within a temple — one footprint wholly inside
      // another is a room within a room, and its walls are real interior
      // walls rather than a duplicated perimeter. Only PARTIAL overlap is the
      // defect this lint is for: two rooms that clip each other's corners.
      // (The same shape as the flooded-room exemption below — full coverage
      // is a legitimate reading, partial coverage is the mistake.)
      if (shared === a.size || shared === b.size) continue;
      diagnostics.push({
        severity: "warning",
        line: structures[j]!.line,
        message: `two structures on this level share cells — their walls and UVTT line_of_sight are drawn twice (spec 06 §3)`,
      });
    }
  }

  // 6 — terrain-crosses-wall: a band covering PART of a footprint. Covering the
  // whole footprint is a flooded room, which is legitimate layering.
  for (const s of structures) {
    const cells = structureCells(s);
    if (cells.size === 0) continue;
    for (const t of on(model.entities)) {
      if (t.archetype !== "terrain" && t.archetype !== "path") continue;
      const tc = terrainCells(t);
      if (tc.size === 0) continue;
      const covered = [...cells.keys()].filter((k) => tc.has(k)).length;
      if (covered === 0 || covered === cells.size) continue;
      diagnostics.push({
        severity: "warning",
        line: t.line,
        message: `'${t.typeWord ?? "terrain"}' covers part of a structure's footprint but not all of it — a band running through a wall; covering the whole footprint is a flooded room and is fine (spec 06 §6)`,
      });
      break;
    }
  }
}

const colNum = (letters: string): number => {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
