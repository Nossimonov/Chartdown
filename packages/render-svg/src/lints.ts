/**
 * Coherence lints (spec 06 §10, #123, from the #80 decision): six
 * warning-level checks over geometry the renderer has already resolved.
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

/**
 * Cells a terrain or path entity covers.
 *
 * `area` shapes flatten to their ranges, but a `path` is a POLYLINE and its
 * args are only its corners — `path M20 M12` names two cells and runs through
 * nine. Counting corners alone made the King's Road look like it touched the
 * gatehouse without ever entering it, which is the difference between a road
 * through a gate and a road through a wall.
 */
function terrainCells(e: EntityNode): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const add = (c: Cell): void => void cells.set(cellKey(c), c);
  for (const p of e.placements) {
    if (p.kind === "shape" && p.shape === "path") {
      const pts = p.args.filter((a): a is Address => a.kind === "address");
      for (let i = 0; i + 1 < pts.length; i++) for (const c of walkBetween(pts[i]!, pts[i + 1]!)) add(c);
      if (pts.length === 1) add({ col: colNum(pts[0]!.col), row: pts[0]!.row });
      continue;
    }
    const flat = p.kind === "shape" ? p.args : [p];
    for (const [, c] of structureCells({ placements: flat })) add(c);
  }
  return cells;
}

/** Every cell a straight run between two addresses passes through, ends included. */
function walkBetween(a: Address, b: Address): Cell[] {
  const from = { col: colNum(a.col), row: a.row };
  const to = { col: colNum(b.col), row: b.row };
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  if (steps === 0) return [from];
  const out: Cell[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push({
      col: from.col + Math.round(((to.col - from.col) * i) / steps),
      row: from.row + Math.round(((to.row - from.row) * i) / steps),
    });
  }
  return out;
}

/**
 * The WINNING terrain word per cell on one level (spec 06 §6: declaration
 * order breaks ties). The same rule `impassableCells` follows, and for the same
 * reason — spec 06 §5's idiom is to lay ground truth across a level and paint
 * over it, so mere membership is not coverage.
 */
function surfaceByCell(entities: EntityNode[], level: string): Map<string, string> {
  const winner = new Map<string, string>();
  for (const e of entities) {
    if (e.archetype !== "terrain" || e.level !== level) continue;
    for (const key of terrainCells(e).keys()) winner.set(key, e.typeWord ?? "");
  }
  return winner;
}

/**
 * The whole document, not one storey of it. `renderBattlemap` is handed a model
 * whose `entities` are FILTERED to the level being drawn, which is right for
 * drawing and wrong for every question that spans levels: the stair down to a
 * cellar is declared on the floor above, and the floor a room stands on is the
 * room below it. Reading the filtered list made both invisible and reported the
 * manor's undercroft as unreachable when its ladder was five lines away.
 */
export interface LintContext {
  allEntities: EntityNode[];
  /** Physical order, topmost first (spec 06 §8). */
  levels: string[];
}

export function coherenceLints(model: Model, level: string, diagnostics: Lint[], ctx?: LintContext): void {
  const all = ctx?.allEntities ?? model.entities;
  const on = <T extends { level: string }>(xs: T[]): T[] => xs.filter((x) => x.level === level);
  const structures = on(model.entities.filter((e) => e.archetype === "structure"));
  const surface = surfaceByCell(all, level);
  const rock = impassableCells(model);

  /** The level physically beneath this one, or null at the bottom of the stack. */
  const levelBelow = ((): string | null => {
    const i = ctx?.levels.indexOf(level) ?? -1;
    return i >= 0 && i + 1 < ctx!.levels.length ? ctx!.levels[i + 1]! : null;
  })();

  /**
   * Cells a room stands on, on any one level — and A ROOM IS A FLOOR.
   *
   * Spec 06 §5's idiom for a level is to lay one word across the whole grid and
   * carve into it: `air` for a storey, `earth` for a cellar. Under that idiom
   * every room on an upper floor sits on air and every cellar room sits on
   * solid ground, so the terrain word alone says a manor's stairs land in the
   * sky and its ladder lands inside bedrock. The room the author drew there is
   * what overrides the blanket, and it is why they never had to declare a
   * floor under it.
   */
  const roomsOn = (lvl: string): Set<string> => {
    const cells = new Set<string>();
    for (const e of all) {
      if (e.archetype !== "structure" || e.level !== lvl) continue;
      for (const key of structureCells(e).keys()) cells.add(key);
    }
    return cells;
  };
  const roomsHere = roomsOn(level);

  const walkable = (c: Cell): boolean => {
    const key = cellKey(c);
    if (roomsHere.has(key)) return true; // a room is a floor, whatever is painted under it
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

  // 2 — structure-unsupported: a footprint cell over declared `air` with
  // nothing beneath it holding it up.
  //
  // The question is SUPPORT, not surface. Spec 06 §5's idiom for an upper
  // storey is to lay `air` across the whole level and paint floors back in, so
  // every upper room begins life standing on air — but a room built directly
  // over the hall below is held up by the hall, and the author never needed to
  // declare the hall's ceiling to say so. Reading the surface word alone
  // reported the manor's Lord's Chambers, which sit squarely on the Great
  // Hall, as a building floating in the sky.
  //
  // What survives is the real defect: a footprint over air with no structure
  // beneath it on the level below. A wing hanging half off the building under
  // it still warns, because the check is per-cell.
  const supported = levelBelow === null ? new Set<string>() : roomsOn(levelBelow);
  for (const s of structures) {
    if (s.flags.includes("open")) continue; // courtyards have defined sky semantics
    for (const key of structureCells(s).keys()) {
      const word = surface.get(key);
      if (word === undefined) continue;
      const chain = model.chainOf(word);
      if (!chain.includes("air")) continue;
      if (supported.has(key)) continue;
      diagnostics.push({
        severity: "warning",
        line: s.line,
        message: `this structure stands on '${word}' with nothing beneath it on level '${levelBelow ?? "(none)"}' — a building on open air (spec 06 §5)`,
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
    const hasConnector = all.some((e) => {
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
    const key = cellKey({ col: colNum(landing.col), row: landing.row });
    if (roomsOn(to).has(key)) continue; // it lands in a room, which is a floor
    const word = surfaceByCell(all, to).get(key);
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
  const openingSegs = new Set(openingEdges.map((o) => segKey(o.seg)));
  for (const s of structures) {
    const cells = structureCells(s);
    if (cells.size === 0) continue;
    for (const t of on(model.entities)) {
      if (t.archetype !== "terrain" && t.archetype !== "path") continue;
      const tc = terrainCells(t);
      if (tc.size === 0) continue;
      const covered = [...cells.keys()].filter((k) => tc.has(k)).length;
      if (covered === 0 || covered === cells.size) continue;
      // A road that meets a gatehouse is a road going THROUGH THE GATE. What
      // makes a band through a wall a defect is that it crosses where there is
      // no way through, so find the perimeter edges this band actually crosses
      // and let it pass when every one of them carries an opening. The manor's
      // King's Road runs into the gatehouse at M12.s, which is a door.
      const crossings = new Set<string>();
      for (const [key, c] of cells) {
        if (!tc.has(key)) continue;
        const sides: [string, Cell][] = [
          ["n", { col: c.col, row: c.row - 1 }], ["s", { col: c.col, row: c.row + 1 }],
          ["e", { col: c.col + 1, row: c.row }], ["w", { col: c.col - 1, row: c.row }],
        ];
        for (const [dir, n] of sides) {
          const nk = cellKey(n);
          if (cells.has(nk) || !tc.has(nk)) continue; // interior edge, or the band stops here
          crossings.add(segKey(edgeSegment({ kind: "address", col: colLetters(c.col), row: c.row }, dir as never)));
        }
      }
      if (crossings.size > 0 && [...crossings].every((k) => openingSegs.has(k))) continue;
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
