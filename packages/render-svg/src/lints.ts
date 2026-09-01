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
import { colLetters, levelSpan, type Segment } from "./util";
import { cellKey, edgeSegment, halfPlaneContext, perimeterEdges, segKey, structureCells, surfaceCells, type Cell, type HalfPlaneContext } from "./grid";
import { impassableCells } from "./walls";
import type { Model } from "./model";

/**
 * The stdlib words that describe a CHANGE OF FLOOR, and so are a way into the
 * room they stand in (#301, ADR 0052, spec 04 §2's load-bearing table).
 *
 * Spec 06 §5 names three traversable connections. `slope` is deliberately not
 * here: it is a graded surface *within* one level — `slope : terrain`, where
 * the other two are `: feature` — and walking up one does not arrive from a
 * storey the map never drew, which is the whole reason the other two count.
 */
const INGRESS_WORDS = ["stairs", "ramp"] as const;

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
 * The WINNING surface word per cell on one level (spec 06 §6: declaration
 * order breaks ties). The same rule `impassableCells` follows, and for the same
 * reason — spec 06 §5's idiom is to lay ground truth across a level and paint
 * over it, so mere membership is not coverage.
 *
 * PATHS count as surface (#147). Spec 06 §6 layers area terrain beneath path
 * bands, so a road is what a cell has on it; reading only `terrain` here made
 * a door onto a street a door onto whatever the street was painted over.
 */
function surfaceByCell(entities: EntityNode[], level: string, hp?: HalfPlaneContext): Map<string, string> {
  const winner = new Map<string, string>();
  for (const e of entities) {
    if (e.level !== level || !laysSurface(e)) continue;
    for (const key of surfaceCells(e, hp).keys()) winner.set(key, e.typeWord ?? "");
  }
  return winner;
}

/**
 * Whether an entity puts ground under your feet.
 *
 * Terrain and paths do by archetype. So does a FEATURE drawn as a band: a
 * bridge or a ford is stdlib `feature` (spec 05 §2 files them under crossings),
 * and `bridge span : path A8 T8 width=3` is a walkway however the word is
 * classified. Barriers and tokens are excluded — a wall drawn along a line is
 * not a floor, and a token stands ON ground rather than being it.
 */
function laysSurface(e: EntityNode): boolean {
  if (e.archetype === "terrain" || e.archetype === "path") return true;
  if (e.archetype !== "feature") return false;
  return e.placements.some((p) => p.kind === "shape" && p.shape === "path");
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
  /**
   * What is DRAWN — mode-stripped. The renderer's own set; the lints do not
   * read it when `declaredEntities` is supplied. Kept distinct on purpose: the
   * reciprocal-landing rule needs the stripped set (a hidden connector must not
   * project a landing) while the lints need the declared one, so one field
   * cannot serve both. Collapsing them is how #319 and #320 both arose.
   */
  allEntities: EntityNode[];
  /**
   * What was DECLARED — every entity, whatever the mode (spec 06 §10, ADR 0045,
   * #320). A REDACTION IS NOT THE DOCUMENT: `hidden` and `[gm]` decide what a
   * reader is shown, not what the document says, so a document produces the
   * same lints in both modes. Linting the redaction reported every secret
   * entrance as `unreachable-room` — stripping the only way in leaves a room
   * with no way in — unsilenceably, by default, with advice that destroyed the
   * secret if followed.
   */
  declaredEntities?: EntityNode[];
  /** Physical order, topmost first (spec 06 §8). */
  levels: string[];
}

export function coherenceLints(model: Model, level: string, diagnostics: Lint[], ctx?: LintContext): void {
  const all = ctx?.declaredEntities ?? ctx?.allEntities ?? model.entities;
  // The panel's own slice of the declared set. `model` here is the PANEL model,
  // whose entities are already level-filtered, and `impassableCells` iterates
  // them without filtering again — so handing it every level's entities would
  // make one storey's rock impassable on all of them.
  const lintModel: Model =
    ctx?.declaredEntities === undefined ? model : { ...model, entities: ctx.declaredEntities.filter((e) => e.level === level) };
  const on = <T extends { level: string }>(xs: T[]): T[] => xs.filter((x) => x.level === level);
  const structures = on(lintModel.entities.filter((e) => e.archetype === "structure"));
  // A relational extent is ground like any other, so the lints resolve it too
  // (spec 06 §6, ADR 0038) — it is deliberately NOT exempt, and that report is
  // what makes a derived extent auditable when its reference is edited.
  const hp = halfPlaneContext(model.doc, all);
  const surface = surfaceByCell(all, level, hp);
  const rock = impassableCells(lintModel);

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
    // The WINNING surface decides, and it is asked FIRST. `rock` is a narrower
    // reading of the same question — it counts only terrain and paths, where
    // this counts a bridge drawn as a band too — so asking it first let the
    // narrower answer overrule the wider one. Two definitions of "solid"
    // disagreeing is the shape of #131; this keeps one and demotes the other
    // to a backstop for cells the surface map never mentions.
    const word = surface.get(key);
    if (word !== undefined) {
      const chain = model.chainOf(word);
      // `terrace` is walkable raised ground; `air`/`void` are declared absence
      // of floor and `earth` is solid rock (spec 06 §5).
      if (chain.includes("terrace")) return true;
      return !chain.includes("air") && !chain.includes("earth");
    }
    if (rock.has(key)) return false;
    return true; // undeclared ground is ordinary floor
  };

  // 1 — door-onto-void: an opening whose far side is not walkable. Windows and
  // arrow-slits are exempt: facing open air is their job.
  const openingEdges: { e: EntityNode; seg: Segment; at: Address; dir: string }[] = [];
  for (const e of on(lintModel.entities)) {
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
        // On a SINGLE-LEVEL document there is no level below to name. The
        // message interpolated the string `(none)` and pointed at an edit that
        // cannot be made there — put a structure on the level underneath —
        // which is an edit requiring a `levels:` header the document does not
        // have (#399). The defect is real either way: the author declared the
        // ground unfloored and built on it. What differs is the remedy, so the
        // message names the one actually available.
        message: levelBelow === null
          ? `this structure stands on '${word}' with no solid ground under it — declare a surface beneath its footprint (spec 06 §5)`
          : `this structure stands on '${word}' with nothing beneath it on level '${levelBelow}' — a building on open air (spec 06 §5)`,
      });
      break;
    }
  }

  // An EDGE or CORNER token names a cell and a side of it — `A1.n`, `A1.nw` —
  // and the cell is right there in the token: `A1.n` is on `A1` (#326). Two
  // lints read placements and both saw only `address`, with opposite symptoms:
  // `unreachable-room` stopped counting the stair (a false warning about the
  // room below), and `dangling-connector` skipped the entity outright (a check
  // that never ran at all). Spec 06 §5 calls a transition "placed spanning a
  // boundary", so the edge spelling is the one its own language leads an author
  // to write.
  const cellOf = (p: EntityNode["placements"][number]): Address | null =>
    p.kind === "address" ? p : p.kind === "edge" ? p.at : null;

  // 3 — unreachable-room: no opening on its perimeter, and nothing inside it
  // that gets you in — a level connector, or a stair.
  //
  // Which cell an entity occupies: the explicit `at=` landing of spec 06 §8 if
  // it has one, else its own address placements. Those are already resolved
  // against a referent by the time they reach here, so `on cellar at A1`
  // correctly tests the cellar's B2 rather than the sheet's A1.
  const landsIn = (e: Pick<EntityNode, "pairs" | "placements">, cells: ReturnType<typeof structureCells>): boolean => {
    const landing = e.pairs.find((p) => p.key === "at")?.value ?? null;
    // An EDGE or CORNER token names a cell and a side of it — `A1.n`, `A1.nw` —
    // and the cell is right there in the token: `A1.n` is on `A1` (#326).
    // Reading only `address` placements meant one changed token turned a stair
    // into nothing, and the spelling that broke is the one spec 06 §5's own
    // language leads an author to write: a transition is "placed spanning a
    // boundary". The warning then advised adding a door to a room already
    // reached by a stair.
    const targets = landing
      ? [landing]
      : e.placements.map(cellOf).filter((a): a is Address => a !== null).map((a) => `${a.col}${a.row}`);
    return targets.some((t) => {
      // The `at=` PAIR takes the same tolerance, for the same reason: found
      // while fixing the placement form, and leaving one silent failure in the
      // function being repaired is how #408 happened. Whether `at=<edge>`
      // should be refused outright (spec 06 §8 says `at=<cell>`) is a separate
      // question; reporting an unrelated room as unreachable answers it badly.
      const m = /^([A-Z]+)(\d+)(?:\.(?:[nsew]|[ns][ew]))?$/.exec(t);
      return m !== null && cells.has(cellKey({ col: colNum(m[1]!), row: Number(m[2]) }));
    });
  };
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
      // A `to=` RANGE lands on every level between its endpoints (#112), not
      // just the two named — the renderer walks the same span via levelSpan()
      // (battlemap.ts), and the two must agree or a shaft's middle floors warn
      // unreachable while the render draws a landing into them (#322).
      const reachesHere = e.level === level || levelSpan(ctx?.levels ?? [level], to).includes(level);
      return reachesHere && landsIn(e, cells);
    });
    // A STAIR IS A WAY IN, with or without `to=` (#301, ADR 0052). The test
    // above is for LEVEL CONNECTION, and a SINGLE-LEVEL map has no level to
    // point at — so a cellar whose only entrance was its stair reported that
    // nothing could reach it, and the only ways to silence it were to invent a
    // door the map does not have or to invent a second level to connect to.
    // Matched through the chain, so `ladder : stairs` counts (spec 04 §2).
    const hasIngress = on(all).some(
      (e) => INGRESS_WORDS.some((w) => model.chainOf(e.typeWord).includes(w)) && landsIn(e, cells),
    );
    if (!hasOpening && !hasConnector && !hasIngress) {
      diagnostics.push({
        severity: "warning",
        line: s.line,
        message: `this structure has no opening and no connector inside it — nothing can reach it (spec 06 §3)`,
      });
    }
  }

  // 4 — dangling-connector: the landing cell is not walkable on the target level.
  for (const e of on(lintModel.entities)) {
    const to = e.pairs.find((p) => p.key === "to")?.value;
    if (to === undefined) continue;
    const landing = e.placements.map(cellOf).find((a): a is Address => a !== null);
    if (!landing) continue;
    const key = cellKey({ col: colNum(landing.col), row: landing.row });
    // EVERY LANDING OF THE FLIGHT, not only an unranged one (#344). A range was
    // skipped outright, so a shaft declared `to=upper..cellar` could land in
    // solid rock on every floor it passed through and nothing said so, while
    // the identical document written as separate single-level connectors was
    // checked normally. #338 named this as the sibling when it fixed the same
    // blind spot in `unreachable-room`. It is a check that never RAN rather
    // than one that fired wrongly, which is the kind found only by asking what
    // a check covers.
    //
    // A `through=` level declares NO LANDING (spec 06 §8): a shaft boring
    // through rock is what `through=` means, so reporting it would report the
    // feature as the defect. ADR 0048 subtracts them the same way when it
    // computes a flight's landings.
    const through = e.pairs.find((p) => p.key === "through")?.value;
    const levels = ctx?.levels ?? [level];
    const bored = new Set(through ? levelSpan(levels, through) : []);
    for (const lvl of levelSpan(levels, to)) {
      if (bored.has(lvl)) continue;
      if (roomsOn(lvl).has(key)) continue; // it lands in a room, which is a floor
      const word = surfaceByCell(all, lvl, hp).get(key);
      if (word === undefined) continue;
      const chain = model.chainOf(word);
      if (chain.includes("terrace") || (!chain.includes("air") && !chain.includes("earth"))) continue;
      diagnostics.push({
        severity: "warning",
        line: e.line,
        message: `this connector lands on '${word}' on level '${lvl}', which cannot be stood on (spec 06 §8)`,
      });
    }
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

  // 6 — terrain-crosses-wall: terrain that is partly inside a room and partly
  // OUT of it. The question is whether the terrain ESCAPES the footprint, not
  // whether it fills it (#146).
  //
  // The original test — covers some cells but not all — made the ordinary case
  // a defect. A pool in a hall, a dais on a chamber floor, a rubble heap in one
  // corner: terrain wholly inside a room, covering part of it, touching no
  // wall. Sixteen of seventeen warnings on a real map were this, and the
  // message asserted "a band running through a wall" about a pool that touched
  // nothing. A room with a uniform floor edge to edge is the exception.
  //
  // Under "does it escape", whole-footprint coverage stops needing its own
  // exemption: a flooded room is terrain that does not leave the room.
  const openingSegs = new Set(openingEdges.map((o) => segKey(o.seg)));
  for (const s of structures) {
    const cells = structureCells(s);
    if (cells.size === 0) continue;
    for (const t of on(lintModel.entities)) {
      if (t.archetype !== "terrain" && t.archetype !== "path") continue;
      const tc = surfaceCells(t, hp);
      if (tc.size === 0) continue;
      const inside = [...tc.keys()].filter((k) => cells.has(k)).length;
      if (inside === 0) continue; // never enters
      if (inside === tc.size) continue; // never leaves — a pool, a dais, a rubble heap (#146)
      // Covering the WHOLE footprint is not crossing a wall either: the wall is
      // submerged, not breached. This is the flooded room, and it is also what
      // keeps `earth : area A1..T20` — spec 06 §5's blanket ground layer, which
      // escapes every footprint on the level by construction — from reporting
      // every room on the map.
      if (inside === cells.size) continue;
      // A road that meets a gatehouse is a road going THROUGH THE GATE. What
      // makes a band through a wall a defect is that it crosses where there is
      // no way through, so find the perimeter edges this band actually crosses
      // and let it pass when every one of them carries an opening. The manor's
      // King's Road runs into the gatehouse at M12.s, which is a door.
      const crossings = new Set<string>();
      // WHERE it crosses, not merely THAT it does (#234). The edges are
      // computed here anyway, to check them against the openings; reporting
      // none of them left several crossings arriving as identical lines at
      // one line number, with nothing to tell them apart. Under a relational
      // extent (ADR 0038) the cause can be an edit to an entity the reported
      // line does not even mention, so the report has to carry the geometry.
      const at: string[] = [];
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
          at.push(`${colLetters(c.col)}${c.row}.${dir}`);
        }
      }
      if (crossings.size > 0 && [...crossings].every((k) => openingSegs.has(k))) continue;
      // Name the structure the way its author would recognise it, and say
      // where — capped, because a long band can cross a great many edges and
      // a message nobody finishes reading is the problem this fixes.
      const where = at.slice(0, 3).join(", ") + (at.length > 3 ? `, and ${at.length - 3} more` : "");
      // Its LINE as well as its name: this warning is reported against the
      // terrain, and the structure it names is declared somewhere else, so a
      // reader who jumps to the reported line finds the wrong entity.
      const structureName = `${s.name ?? s.ids[0] ?? s.typeWord ?? "a structure"}' (line ${s.line})`;
      diagnostics.push({
        severity: "warning",
        line: t.line,
        message: `'${t.typeWord ?? "terrain"}' runs both inside and outside '${structureName}, crossing its wall${at.length > 0 ? ` at ${where}` : ""} where there is no opening — terrain that stays wholly inside a room (a pool, a dais) is fine, as is terrain that crosses at a door (spec 06 §6)`,
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
