/**
 * Battlemap renderer (spec 06): square-grid geometry-on-grid — terrain,
 * structures with details, props, tokens, staging zones, lights,
 * emergent-elevation ledges, and the GM/player split.
 */

import type { Address, AddressRange, Diagnostic, EntityNode, LabelHint, Placement } from "@chartdown/core";
import { CELL, cellCenter, cellOrigin, edgeSegment, halfPlaneContext, MARGIN, measureToCells, scaleOf, widthInCells, mergeEdgeRuns, perimeterEdges, rangeRect, segKey, structureCells, surfaceCells, type Cell } from "./grid";
import { anchorAttr, gmTitleFor, labelsOn, labelTextFor, pairOf, type Model } from "./model";
import { GRID_LINE, hasBattlemapGlyph, INK, PAPER, wordTint } from "./theme";
import { colLetters, colToNumber, el, esc as escapeText, fmt, inkStroke, levelSpan, nearestOnPolyline, pip, pointsAttr, type Segment, shade, svgTitle, text, visibilityPolygon, type XY } from "./util";
import { coherenceLints } from "./lints";
import { barrierSides, collectWalls, impassableCells, SIDE_NAME } from "./walls";

export interface Frame {
  cols: number;
  rows: number;
  w: number;
  h: number;
}

export function battlemapFrame(model: Model): Frame {
  const cols = model.doc.grid?.cols ?? 20;
  const rows = model.doc.grid?.rows ?? 15;
  return { cols, rows, w: MARGIN * 2 + cols * CELL, h: MARGIN * 2 + rows * CELL };
}

/**
 * One emitter's pool, as the shape it was drawn from plus who drew it (#290).
 *
 * The shape is whichever of the two forms occlusion selected — a visibility
 * polygon where sight blockers cut it, a circle where nothing does — so the
 * pool, the hole and the coverage test all read the SAME geometry rather than
 * three copies of the branch that chose it.
 */
type EmitterCover = {
  shape: { kind: "circle"; at: XY; r: number } | { kind: "poly"; pts: XY[] };
  /**
   * How the document named this emitter, for the report — display name, else
   * explicit id, else the type word. The id beats the type word because a map
   * with three lamps on it needs to be told WHICH lamp out-ranges the room.
   */
  label: string;
  /** Its declared range, verbatim — `60ft`, not 384. */
  measure: string;
  line: number;
};

export interface LevelContext {
  level: string;
  /** What is DRAWN — mode-stripped. What the renderer itself reads. */
  allEntities: EntityNode[];
  /**
   * What was DECLARED — passed straight through to the coherence lints, which
   * reason about the document rather than the redaction of it (spec 06 §10,
   * ADR 0045, #320). Nothing that DRAWS may read this.
   */
  declaredEntities?: EntityNode[];
  /** Physical order, topmost first (spec 06 §8). */
  levels: string[];
}

export function renderBattlemap(
  model: Model,
  body: string[],
  frame: Frame,
  diagnostics: Diagnostic[],
  levelCtx?: LevelContext,
): void {
  const layers = {
    areas: [] as string[], paths: [] as string[], crossings: [] as string[], grid: [] as string[],
    structures: [] as string[], openings: [] as string[], roomLabels: [] as string[], features: [] as string[], zones: [] as string[], tokens: [] as string[], labels: [] as string[],
  };

  /**
   * Every opening edge on the map, keyed geometrically (#103). Collected across
   * ALL structures because a shared wall is one wall (spec 06 §3): an opening
   * declared by either owner perforates it, so either owner's perimeter gaps.
   */
  // Declared with the other render state: renderFreeText runs inside the
  // entity loop below, before any later let would initialise.
  // Emitter pools per field, as mask holes for the ambient wash (#106).
  const fieldHoles = new Map<string, string[]>();
  /**
   * The same pools as GEOMETRY, with the emitter that made each one (#290).
   *
   * `fieldHoles` carries markup, which cannot be asked whether any of the wash
   * survives it. This carries the shape the markup was built from, so
   * `fillsTheField()` can answer that question and name who is responsible.
   */
  const fieldCovers = new Map<string, EmitterCover[]>();

  /**
   * The map field of THIS panel — the frame inset by its margin (ADR 0042).
   *
   * Everything a field draws stops here: the ambient wash, an emitter's pool,
   * and the hole the pool cuts in the wash. The margin band is the paper the
   * place is printed on and carries the apparatus for reading the map, so a
   * lightless cellar gets no black border and a torch lights no coordinate
   * letters. Per PANEL rather than per page, which is what stops a lamp in the
   * cellar lighting the floor above (#291) — each level renders into its own
   * `<g transform>` with these same local coordinates.
   *
   * Only the DRAWING is bounded. The declared range is world data and exports
   * at its true value, exactly as ADR 0037 keeps geometry in map units while
   * ink answers to the sheet.
   */
  const fieldRect = { x: MARGIN, y: MARGIN, w: frame.cols * CELL, h: frame.rows * CELL };
  const fieldClipId = `cdfieldclip-${model.doc.docId}${levelCtx?.level ? `-${levelCtx.level}` : ""}`;
  let fieldClipUsed = false;
  /** Reference the clip, emitting its def only if something actually needs it. */
  function clipToField(): string {
    fieldClipUsed = true;
    return `url(#${fieldClipId})`;
  }
  const noteHole = (field: string, shape: string, cover: EmitterCover): void => {
    const list = fieldHoles.get(field) ?? [];
    list.push(shape);
    fieldHoles.set(field, list);
    const covers = fieldCovers.get(field) ?? [];
    covers.push(cover);
    fieldCovers.set(field, covers);
  };
  let noteCourseCount = 0;
  let terrainCourseCount = 0;
  let openEdgeCache: Set<string> | null = null;
  const openingEdgeKeys = (): Set<string> => {
    if (openEdgeCache) return openEdgeCache;
    const keys = new Set<string>();
    for (const e of model.entities) {
      if (e.archetype !== "structure") continue;
      for (const d of e.details) {
        if (model.archetypeOf(d.typeWord) !== "opening") continue;
        for (const p of d.placements) {
          if (p.kind === "edge") keys.add(segKey(edgeSegment(p.at, p.dir)));
        }
      }
    }
    openEdgeCache = keys;
    return keys;
  };

  // Course-line cells of rendered paths, for crossing composition (spec 06 §6).
  interface PathRecord {
    e: EntityNode;
    cells: Set<string>;
    isWater: boolean;
    isRoad: boolean;
    pts: XY[];
    width: number;
  }
  const pathRecords: PathRecord[] = [];
  /**
   * EVERY BANK GOES DOWN BEFORE ANY WATER (ADR 0044, #315).
   *
   * A themed course draws a wide edge band and then a narrower core. Emitting
   * both per entity meant each course laid its bank across the water of every
   * course drawn before it, so a confluence came out as a lattice of banks over
   * the water — and WHICH cuts survived depended on the order the lines
   * happened to sit in the document, which made line order a drawing decision.
   *
   * Cores are collected here and emitted after every entity's band, so no bank
   * can land on any water whatever order the courses are written in. They leave
   * their entity's group to do it: the group keeps the id and the title, which
   * is what anchors and tooltips read, and a core carries neither.
   */
  const pathCores: string[] = [];
  const crossingCells = new Set<string>();
  interface PendingCrossing {
    e: EntityNode;
    chain: string[];
    titleEl: string;
    anchor: string | undefined;
  }
  // Crossings render after the full pass so the paths they restyle are known.
  const pendingCrossings: PendingCrossing[] = [];

  // A relational extent (spec 06 §6, ADR 0038) references another entity's
  // course, which may be declared further down the document — declaration
  // order is not significant — so it resolves after the full pass, like a
  // crossing. It still claims its place in `layers.areas` NOW: within a kind,
  // declaration order breaks ties (§6 layering), and a fill appended at the
  // end would paint over terrain the author wrote after it.
  interface PendingHalfPlane {
    e: EntityNode;
    compass: string;
    ref: { form: string; value: string };
    slot: number;
    titleEl: string;
    anchor: string | undefined;
  }
  const pendingHalfPlanes: PendingHalfPlane[] = [];

  // Terrain display names (spec 06 §7, #232). Deferred so spec 07 §5's claim
  // order can hold across the whole section rather than following whatever
  // order the document happens to declare a wood and a river in.
  interface PendingTerrainLabel {
    e: EntityNode;
    /** The drawn course, for a line feature; absent for an area. */
    course: XY[] | null;
  }
  const pendingTerrainLabels: PendingTerrainLabel[] = [];

  /** Compass words to a unit offset, y down as the canvas runs. */
  const COMPASS_OFFSET: Record<string, XY> = {
    n: { x: 0, y: -1 }, north: { x: 0, y: -1 },
    s: { x: 0, y: 1 }, south: { x: 0, y: 1 },
    e: { x: 1, y: 0 }, east: { x: 1, y: 0 },
    w: { x: -1, y: 0 }, west: { x: -1, y: 0 },
    ne: { x: 1, y: -1 }, northeast: { x: 1, y: -1 },
    nw: { x: -1, y: -1 }, northwest: { x: -1, y: -1 },
    se: { x: 1, y: 1 }, southeast: { x: 1, y: 1 },
    sw: { x: -1, y: 1 }, southwest: { x: -1, y: 1 },
  };

  /**
   * `[labels]` overrides, keyed by the entity they name (#252). Resolved once
   * here rather than searched per label site: a reference is by id or by
   * display name (spec 03 §2), and the renderer should not re-decide that.
   */
  const overrideHints = new Map<EntityNode, LabelHint>();
  for (const o of model.labelOverrides) {
    const target = model.entities.find((e) =>
      o.target.form === "id" ? e.ids.includes(o.target.value) : e.name === o.target.value);
    if (target) overrideHints.set(target, o.hint);
  }

  // Sight-blocking segments for light (spec 06: solid walls and closed doors
  // block sight; windows pass it; ruined walls are collapsed and pass).
  // Shared with the UVTT exporter via walls.ts — one wall geometry, two views.
  const sightBlockers: Segment[] = collectWalls(model).blockers;

  // Cells the pieces occupy — features, footprints, connectors, tokens — so
  // room labels can dodge them (they render BELOW the pieces; a label that
  // starts under a table would be unreadable forever, since neither moves).
  const labelObstructions: { x: number; y: number; w: number; h: number }[] = [];
  for (const e of model.entities) {
    if (e.archetype === "feature") {
      for (const p of e.placements) {
        if (p.kind === "address") {
          const o = cellOrigin(p);
          labelObstructions.push({ x: o.x, y: o.y, w: CELL, h: CELL });
        } else if (p.kind === "range" && !e.gmOnly && pairOf(e.pairs, "elevation") === undefined) {
          labelObstructions.push(rangeRect(p));
        }
      }
    } else if (e.archetype === "token" && !hasOnlyRange(e)) {
      const size = Number(pairOf(e.pairs, "size") ?? 1) || 1;
      for (const p of e.placements) {
        if (p.kind !== "address") continue;
        const o = cellOrigin(p);
        labelObstructions.push({ x: o.x, y: o.y, w: CELL * size, h: CELL * size });
      }
    }
  }

  // hatch pattern for difficult terrain
  body.push(
    `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse">` +
      `<path d="M0,6 L6,0" stroke="#7a7264" stroke-width="1" opacity="0.5"/></pattern></defs>`,
  );

  for (const e of model.entities) {
    const anchor = anchorAttr(model, e);
    // Relatively-placed entities surface their resolved absolute address (#34):
    // the DM-facing frame is always absolute, whatever frame the author chose.
    const title = [gmTitleFor(model, e), model.resolvedNotes.get(e)].filter(Boolean).join(" — ");
    const titleEl = title ? svgTitle(title) : "";
    const elevation = pairOf(e.pairs, "elevation");

    // Free text (spec 07 §2) is "a feature whose rendering is its text" — text
    // ALONE, at every placement form (#104). It was falling through to generic
    // feature rendering and drawing a marker, so every caption asserted there
    // was a thing at that spot; on a sheet where every other glyph is
    // something the party can interact with, a marker is a promise.
    if (model.chainOf(e.typeWord).includes("note")) {
      renderFreeText(e, layers.labels, titleEl, anchor);
      continue;
    }

    if (e.section === "terrain") {
      const chain = model.chainOf(e.typeWord);
      if (chain.includes("ford") || chain.includes("bridge")) {
        pendingCrossings.push({ e, chain, titleEl, anchor });
      } else {
        renderTerrain(e, titleEl, anchor);
      }
      continue;
    }
    if (e.archetype === "structure") {
      renderStructure(e, layers.structures, titleEl, anchor);
      continue;
    }
    // An opening with no parent structure (#113): the Doors of Durin are a
    // hole in a mountainside, not a door in a built wall. Legal where the edge
    // separates open floor from a declared impassable surface — the rock IS
    // the barrier, so it needs no invented chamber to live in.
    if (e.archetype === "opening") {
      renderUnparentedOpening(e, titleEl, anchor);
      continue;
    }
    // Freestanding barriers (#62): wall/fence edge runs and pillar cells draw
    // here — they always blocked light (walls.ts); now they're visible too.
    if (e.archetype === "barrier") {
      renderBarrier(e, layers.structures, titleEl, anchor);
      continue;
    }
    // Range-only entities: zones for zone/token archetypes, gm triggers, and
    // elevated areas; a range-only FEATURE is a footprint (the high table).
    // A staging zone is the `start` word (zone archetype) — not any token word
    // that happens to carry a range (#121, ADR 0015). gm-only ranges and
    // elevation areas keep their zone rendering.
    const zoneLike = e.archetype === "zone" || (hasOnlyRange(e) && (e.gmOnly || elevation !== undefined));
    if (zoneLike) {
      renderZone(e, layers.zones, layers.roomLabels, titleEl, anchor, elevation);
      continue;
    }
    if (e.archetype === "token") {
      renderToken(e, layers.tokens, layers.labels, titleEl, anchor);
      continue;
    }
    renderFeature(e, layers.features, layers.labels, titleEl, anchor);
  }

  // grid lines
  const f = frame;
  for (let c = 0; c <= f.cols; c++) {
    const x = MARGIN + c * CELL;
    layers.grid.push(el("line", { x1: x, y1: MARGIN, x2: x, y2: MARGIN + f.rows * CELL, stroke: model.theme.surface("grid", "stroke", GRID_LINE), ...inkStroke(0.6)}));
  }
  for (let r = 0; r <= f.rows; r++) {
    const y = MARGIN + r * CELL;
    layers.grid.push(el("line", { x1: MARGIN, y1: y, x2: MARGIN + f.cols * CELL, y2: y, stroke: model.theme.surface("grid", "stroke", GRID_LINE), ...inkStroke(0.6)}));
  }
  if (model.header.get("numbers") === "on") {
    // THE COORDINATES WERE NOT EVEN `INK` (#286). Every other piece of
    // furniture at least used the constant; these carried the literal
    // `#8a8272`, so no lever of any kind reached the letters a GM calls out in
    // play — and a fallback would not have helped, since the DEFAULT theme
    // declares `ink` and a surface lookup never reaches its fallback.
    //
    // They are ink drawn QUIETLY, and that is now what the output says. The
    // old literal is ink at 60% over paper — solved per channel it comes out
    // at 0.590/0.602/0.622, and 0.6 reproduces #878175 against a #8a8272
    // target, under 3/255 on every channel. So the subduing survives as an
    // opacity, which is a rendering choice, while the COLOUR comes from the
    // surface, which is the theme's to set.
    const coordinateInk = model.theme.surface("ink", "fill", INK);
    for (let c = 1; c <= f.cols; c++) {
      layers.grid.push(text(colLetters(c), { x: MARGIN + (c - 0.5) * CELL, y: MARGIN - 7, "font-size": 9, fill: coordinateInk, opacity: 0.6, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
    for (let r = 1; r <= f.rows; r++) {
      layers.grid.push(text(String(r), { x: MARGIN - 7, y: MARGIN + (r - 0.5) * CELL + 3, "font-size": 9, fill: coordinateInk, opacity: 0.6, "text-anchor": "end", "font-family": "sans-serif" }));
    }
  }

  for (const pending of pendingHalfPlanes) renderHalfPlane(pending);
  for (const pending of pendingCrossings) renderCrossing(pending);
  // Spec 07 §5's claim order, on a battlemap: a line feature's name reads as
  // that feature's name BECAUSE it lies along the feature, and set aside it
  // becomes a caption pointing at nothing. A name with room to roam — a wood,
  // a marsh — gives way instead, so courses are placed first and each placed
  // label joins the obstructions the next one dodges.
  for (const t of pendingTerrainLabels) if (t.course) renderCourseLabel(t);
  for (const t of pendingTerrainLabels) if (!t.course) renderAreaLabel(t);

  // Coherence lints (#123): things a document can say that no rule forbids and
  // no reader would mean. Warnings only, and reachable from `check` because a
  // map is rendered there (#120) — a lint nobody runs is a lint nobody has.
  coherenceLints(model, levelCtx?.level ?? model.doc.defaultLevel, diagnostics, levelCtx);

  // Reciprocal landings (spec 06 §8): connectors on other levels targeting
  // this one show their landing here automatically, unless an explicit
  // connector already occupies the cell.
  if (levelCtx) {
    // THE SOURCE SIDE IS THE DRAWN SET, and that is half of ADR 0046.
    //
    // A hidden connector must project a landing NOWHERE — spec 01 §6 is
    // fail-closed, and a stripped connector that still projected would
    // RECONSTRUCT the secret on the far panel out of the very entity that was
    // removed to keep it. Measured: reading the declared set here draws
    // `▲ house` on the cellar panel for a document whose only connector is a
    // lone `hidden` trapdoor. The guard below reads the OTHER set on purpose.
    for (const source of levelCtx.allEntities) {
      const to = pairOf(source.pairs, "to");
      if (to === undefined || source.level === levelCtx.level) continue;
      // A `to=` RANGE lands on every level it names (#112), so one declaration
      // is one stair with four landings rather than four stairs that nothing
      // says are the same flight.
      const lands = levelSpan(levelCtx.levels, to).includes(levelCtx.level);
      // A `through=` level is occupied but NOT opened onto: the shaft passes
      // through the rock there. Drawing a landing would invite the party onto
      // a step that does not exist.
      const throughValue = pairOf(source.pairs, "through");
      const passes = throughValue !== undefined && levelSpan(levelCtx.levels, throughValue).includes(levelCtx.level);
      if (passes) {
        const atV = pairOf(source.pairs, "at");
        const shaftAt = atV ? parseCell(atV) : source.placements.find((p): p is Address => p.kind === "address");
        if (shaftAt) renderShaft(cellCenter(shaftAt), layers.features);
        continue;
      }
      if (!lands) continue;
      const atValue = pairOf(source.pairs, "at");
      const landing = atValue ? parseCell(atValue) : source.placements.find((p): p is Address => p.kind === "address");
      if (!landing) continue;
      // A LANDING IS SUPPRESSED BY A DECLARATION, NOT BY A DRAWING
      // (spec 06 §8, ADR 0046, #319). Spec 06 §8's word is DECLARED, so this
      // asks what the document SAID and not what this mode DRAWS. Asking the
      // drawn set meant player mode stripped a hidden connector, the cell read
      // as unoccupied, and the far end's projection drew a stair into the
      // square the strip had just emptied — the secret, on the players' sheet.
      //
      // FILTERED TO THIS PANEL'S LEVEL, and the filter is load-bearing: the
      // declared set spans the whole document while the stripped set it
      // replaces was already per-panel (`index.ts`). Without it, a house
      // connector at A1 makes the cellar's A1 read as occupied and an ordinary
      // two-level map with no secrets in it silently loses its landing.
      const occupied = (levelCtx.declaredEntities ?? model.entities)
        .filter((e) => e.level === levelCtx.level)
        .some(
          (e) => pairOf(e.pairs, "to") !== undefined &&
            e.placements.some((p) => p.kind === "address" && p.col === landing.col && p.row === landing.row),
        );
      if (occupied) continue;
      const c = cellCenter(landing);
      // The connector's OWN `to=` and its OWN declaring level, not this panel's
      // (spec 06 §8, ADR 0048, #321). This call used to pass `source.level` as
      // the `to` argument, so a projected landing announced the level the stair
      // was WRITTEN ON — correct only when the two happen to be adjacent, which
      // is every two-level map and no shaft.
      renderConnector(source, model.chainOf(source.typeWord), c, to, [], layers.features, undefined, source.level);
    }
  }

  // Implied-crossing warnings (spec 06 §6): water × road overlap with no crossing.
  for (const water of pathRecords.filter((p) => p.isWater)) {
    for (const road of pathRecords.filter((p) => p.isRoad)) {
      const uncovered = [...water.cells].filter((c) => road.cells.has(c) && !crossingCells.has(c));
      if (uncovered.length > 0) {
        const [col, row] = uncovered[0]!.split(":").map(Number) as [number, number];
        const waterName = water.e.name ?? water.e.typeWord ?? "water";
        const roadName = road.e.name ?? road.e.typeWord ?? "road";
        diagnostics.push({
          severity: "warning",
          line: road.e.line,
          message: `'${roadName}' crosses '${waterName}' at ${colLetters(col)}${row} with no ford or bridge — the render implies one (spec 06 §6)`,
        });
      }
    }
  }

  // Openings render above ALL structure walls: a door on a shared wall must
  // not be overpainted by the sibling structure's coincident wall line.
  // The deferred cores, after every course's band and before anything that
  // draws over water (crossings, the grid, structures) — ADR 0044.
  layers.paths.push(...pathCores);
  body.push(
    ...layers.areas, ...layers.paths, ...layers.crossings, ...layers.grid,
    ...layers.structures, ...layers.openings, ...layers.roomLabels, ...layers.zones, ...layers.features, ...layers.tokens,
  );
  // Ambient field wash (#106): the declared baseline is a fact about the place,
  // so a `light: dark` map draws dark and its emitters read as pools in it.
  // The wash sits above the map and BELOW labels — a dark sheet is still a
  // sheet the GM has to read. Emitter pools are punched out with a mask, the
  // same technique the land mask uses for water.
  body.push(...ambientWash());
  body.push(...layers.labels);

  // Emitted only if something referenced it, so a map that draws no field is
  // byte-identical to before (ADR 0042). A `<clipPath>` resolves document-wide
  // rather than by document order, so defining it after its users is legal —
  // and this is the one point where every user has already run.
  if (fieldClipUsed) {
    body.unshift(
      `<defs><clipPath id="${fieldClipId}">`
        + el("rect", { x: fieldRect.x, y: fieldRect.y, width: fieldRect.w, height: fieldRect.h })
        + `</clipPath></defs>`,
    );
  }

  // ---------- helpers ----------

  /**
   * The declared ambient for a field on this level, honouring the per-level
   * qualifier: `light celebdil: daylight` beats `light: dark` on that panel.
   */
  function ambientOf(field: string): string | undefined {
    const level = levelCtx?.level;
    let general: string | undefined;
    for (const h of model.doc.header) {
      if (h.key !== field) continue;
      if (h.qualifier === undefined) general = h.value;
      else if (level !== undefined && h.qualifier === level) return h.value;
    }
    return general;
  }

  /**
   * The shape one emitter's field reaches. Occlusion follows the field's
   * `occluded=` facet (spec 04 §5): `sight` (light's default) traces against
   * sight blockers, `none` fills through matter — an antimagic zone or a
   * radiation hazard is not stopped by a wall.
   *
   * Chosen ONCE per emitter. The pool, the hole it cuts in the wash and the
   * coverage test of #290 are three readings of this one shape; when each made
   * the choice for itself they could disagree, and the identical branch stood
   * in three places.
   */
  function emitterShape(at: XY, radius: number): EmitterCover["shape"] {
    const occluded = model.facetOf("light", "occluded") ?? "sight";
    if (occluded !== "none" && sightBlockers.length > 0) {
      return { kind: "poly", pts: visibilityPolygon(at, radius, sightBlockers) };
    }
    return { kind: "circle", at, r: radius };
  }

  /** The hole that shape cuts in the ambient wash. */
  function emitterHole(shape: EmitterCover["shape"]): string {
    return shape.kind === "poly"
      ? el("polygon", { points: pointsAttr(shape.pts), fill: "#000" })
      : el("circle", { cx: shape.at.x, cy: shape.at.y, r: shape.r, fill: "#000" });
  }

  /**
   * The pool itself, painted on the field and bounded by it (ADR 0042).
   *
   * NOT built from `emitterShape()`, deliberately. The pool has always branched
   * on blockers ALONE while the hole consults `occluded=` as well, so a field
   * declared `occluded=none` on a map with walls draws a pool traced against
   * those walls and a cut-out that ignores them — the two disagree about the
   * same emitter. That is a real defect and it is not #290's; unifying them
   * here would move renders this change promises not to move, and would ship an
   * unfiled fix inside a filed one. Left exactly as it was, on purpose.
   */
  function emitterPool(at: XY, radius: number): string {
    const fill = model.theme.surface("light", "fill", "#ffd98a");
    return sightBlockers.length > 0
      ? el("polygon", { points: pointsAttr(visibilityPolygon(at, radius, sightBlockers)), fill, opacity: 0.22, "clip-path": clipToField() })
      : el("circle", { cx: at.x, cy: at.y, r: radius, fill, opacity: 0.22, "clip-path": clipToField() });
  }

  function coversPoint(shape: EmitterCover["shape"], p: XY): boolean {
    return shape.kind === "circle"
      ? Math.hypot(p.x - shape.at.x, p.y - shape.at.y) <= shape.r
      : pip(p, shape.pts);
  }

  /**
   * Does nothing of the wash survive these pools? (#290, ADR 0050.)
   *
   * Union-of-shapes against a rect has no exact form the renderer can afford —
   * `render-svg` carries no runtime dependencies (ADR 0007) — so the field is
   * SAMPLED on a lattice and the answer is "no point of it stayed uncovered".
   *
   * The step is a quarter cell, and the limitation that buys is admitted rather
   * than hidden: a surviving filament of ambient thinner than 8px on the page
   * goes unreported. That is the intended trade. The question this answers is
   * whether any darkness READS on the sheet, and a sub-8px thread does not.
   *
   * It errs toward SILENCE in the other direction too. Boundary samples sit
   * exactly on the field edge, where `pip()` on a polygon whose blockers run
   * along that same edge — the cave idiom — may answer either way; a false
   * "not covered" costs a report that would have been true, and a false report
   * would cost the author's trust in every other one.
   */
  function fillsTheField(covers: EmitterCover[]): boolean {
    if (covers.length === 0) return false;
    const step = CELL / 4;
    const nx = Math.round(fieldRect.w / step);
    const ny = Math.round(fieldRect.h / step);
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const p = { x: fieldRect.x + i * step, y: fieldRect.y + j * step };
        if (!covers.some((c) => coversPoint(c.shape, p))) return false;
      }
    }
    return true;
  }

  /** Full-frame wash for every declared ambient whose theme entry has a fill. */
  function ambientWash(): string[] {
    const out: string[] = [];
    const fields = new Set(model.doc.header.filter((h) => model.archetypeOf(h.key) === "field").map((h) => h.key));
    for (const field of fields) {
      const value = ambientOf(field);
      if (value === undefined) continue;
      const fill = model.theme.prop(model.chainOf(field), "fill", { state: value });
      // No theme entry for this condition: the renderer has nothing to say
      // about it, and inventing a tone would be guessing (spec 04 §4).
      if (!fill) continue;
      // A DECLARED TONE WITH NO DECLARED WEIGHT IS REPORTED (#263). The
      // fallback below is what let `daylight` render at a darkness value
      // without anything saying so, and the same hole waits for the next word
      // added to a field's closed set. Named rather than guessed at, in the
      // spirit of the dead-declaration warnings (#116, ADR 0022) — the wash
      // still draws, so a theme is not silently disabled by the report.
      const declared = model.theme.prop(model.chainOf(field), "opacity", { state: value });
      if (declared === undefined) {
        diagnostics.push({
          severity: "warning",
          line: 1,
          message: `'${field}: ${value}' gives a colour but no opacity, so it is drawn at the default weight — declare \`${field}.${value} : opacity=\` to say how heavy it should be (spec 08 §2)`,
        });
      }
      const opacity = declared ?? "0.82";
      const holes = fieldHoles.get(field) ?? [];
      // A POOL THAT FILLS ITS FIELD IS REPORTED, NOT REDRAWN (#290, ADR 0050).
      //
      // A 60ft lantern in a 15ft room leaves no ambient visible, and that
      // render is FAITHFUL — the lamp does light the room, and an emitter is a
      // pool of its range cut into the wash. So nothing below softens the pool
      // or shortens the range; the wash is emitted exactly as it always was.
      //
      // What was missing is the author. The document declares two things that
      // cannot both show, the renderer picks one silently, and `check` passes
      // over a sheet that contradicts its own first lines. This is the ruling
      // #287 already makes one bullet up in spec 04 §5: an author who writes
      // `light: dark` is picturing a dark sheet, and silence would let them
      // keep picturing it. Only they can say which of the two they meant.
      //
      // Per PANEL, because ambientWash() is — a lamp that fills the cellar
      // says nothing about the floor above it (ADR 0042).
      const covers = fieldCovers.get(field) ?? [];
      if (fillsTheField(covers)) {
        // Named where one emitter does it alone, counted where only the
        // combination does: "shorten this one" is advice, and pointing at an
        // arbitrary member of a set that jointly covers the field is not.
        const alone = covers.find((c) => fillsTheField([c]));
        diagnostics.push({
          severity: "warning",
          line: alone?.line ?? 1,
          message:
            `'${field}: ${value}' declares an ambient this map never shows: `
            + (alone
              ? `'${alone.label}' reaches ${alone.measure}, which covers`
              : `its ${covers.length} emitters together cover`)
            + ` the whole map field, so no part of the map renders ${value} — `
            + `shorten the ${alone ? "range" : "ranges"}, or drop the ambient (spec 04 §5)`,
        });
      }
      const id = `cdfield-${model.doc.docId}-${field}${levelCtx?.level ? `-${levelCtx.level}` : ""}`;
      out.push(
        `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${fmt(fieldRect.x)}" y="${fmt(fieldRect.y)}" width="${fmt(fieldRect.w)}" height="${fmt(fieldRect.h)}">` +
          el("rect", { x: fieldRect.x, y: fieldRect.y, width: fieldRect.w, height: fieldRect.h, fill: "#fff" }) +
          holes.join("") +
          `</mask></defs>` +
          el("rect", { x: fieldRect.x, y: fieldRect.y, width: fieldRect.w, height: fieldRect.h, fill, opacity, mask: `url(#${id})` }),
      );
    }
    return out;
  }

  function cellsAlong(pts: XY[]): Set<string> {
    const cells = new Set<string>();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 4)));
      for (let s = 0; s <= steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / steps;
        const y = a.y + ((b.y - a.y) * s) / steps;
        const col = Math.floor((x - MARGIN) / CELL) + 1;
        const row = Math.floor((y - MARGIN) / CELL) + 1;
        if (col >= 1 && col <= frame.cols && row >= 1 && row <= frame.rows) cells.add(`${col}:${row}`);
      }
    }
    return cells;
  }

  function entityCells(e: EntityNode): { col: number; row: number }[] {
    const out: { col: number; row: number }[] = [];
    for (const p of e.placements) {
      if (p.kind === "address") out.push({ col: colToNumber(p.col), row: p.row });
      else if (p.kind === "range") {
        const c1 = colToNumber(p.from.col);
        const c2 = colToNumber(p.to.col);
        for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) {
          for (let row = Math.min(p.from.row, p.to.row); row <= Math.max(p.from.row, p.to.row); row++) {
            out.push({ col, row });
          }
        }
      }
    }
    return out;
  }

  /** Cells covered by a path's band: center within stroke half-width of the polyline. */
  function bandCells(record: PathRecord): Set<string> {
    const half = record.width / 2 + 1;
    const cells = new Set<string>();
    for (let col = 1; col <= frame.cols; col++) {
      for (let row = 1; row <= frame.rows; row++) {
        const center = { x: MARGIN + (col - 0.5) * CELL, y: MARGIN + (row - 0.5) * CELL };
        const nearest = nearestOnPolyline(record.pts, center);
        if (Math.hypot(nearest.x - center.x, nearest.y - center.y) <= half) cells.add(`${col}:${row}`);
      }
    }
    return cells;
  }

  function connectedClusters(keys: Set<string>): string[][] {
    const remaining = new Set(keys);
    const clusters: string[][] = [];
    while (remaining.size > 0) {
      const seed = remaining.values().next().value as string;
      const queue = [seed];
      remaining.delete(seed);
      const cluster: string[] = [];
      while (queue.length > 0) {
        const key = queue.pop()!;
        cluster.push(key);
        const [col, row] = key.split(":").map(Number) as [number, number];
        for (let dc = -1; dc <= 1; dc++) {
          for (let dr = -1; dr <= 1; dr++) {
            const neighbor = `${col + dc}:${row + dr}`;
            if (remaining.has(neighbor)) {
              remaining.delete(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }
      clusters.push(cluster.sort());
    }
    return clusters.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  }

  /**
   * Crossings (spec 06 §6): placed `on <water> on <road>`, the region derives
   * from the bands' intersection — location is a consequence, not a fact.
   * Explicit cells remain the fallback for underivable cases.
   */
  function renderCrossing(pending: PendingCrossing): void {
    const { e, chain, titleEl, anchor } = pending;
    const isBridge = chain.includes("bridge");
    const findRecord = (ref: { form: string; value: string }): PathRecord | undefined =>
      pathRecords.find((p) => (ref.form === "id" ? p.e.ids.includes(ref.value) : p.e.name === ref.value));

    const onRefs = e.placements.filter(
      (p): p is Extract<Placement, { kind: "relational"; form: "on" }> => p.kind === "relational" && p.form === "on",
    );
    // The chooser cell arrives either standalone (`… at K9` after both bands)
    // or bound to an `on` ref (#34's greedy at-clause) — a path's frame is
    // the document grid, so both spell the same global cell.
    const atCell =
      e.placements.find(
        (p): p is Extract<Placement, { kind: "relational"; form: "at" }> => p.kind === "relational" && p.form === "at",
      )?.target ?? onRefs.map((p) => p.at).find((a) => a?.kind === "address");

    let cells: { col: number; row: number }[] = [];
    let host: PathRecord | undefined;

    if (onRefs.length >= 2) {
      const records = onRefs.map((p) => findRecord(p.ref)).filter((r): r is PathRecord => r !== undefined);
      if (records.length >= 2) {
        const water = records.find((r) => r.isWater) ?? records[0]!;
        const other = records.find((r) => r !== water)!;
        const intersection = new Set([...bandCells(water)].filter((c) => bandCells(other).has(c)));
        const clusters = connectedClusters(intersection);
        let chosen = clusters;
        if (clusters.length > 1) {
          if (atCell?.kind === "address") {
            const key = `${colToNumber(atCell.col)}:${atCell.row}`;
            const match = clusters.find((cluster) => cluster.includes(key));
            chosen = match ? [match] : clusters;
          }
          if (chosen.length > 1) {
            diagnostics.push({
              severity: "error",
              line: e.line,
              message: `'${e.typeWord}' on '${water.e.name ?? water.e.typeWord}' and '${other.e.name ?? other.e.typeWord}' is ambiguous — they cross at ${clusters.map((c) => cellName(c[0]!)).join(" and ")}; add 'at <cell>' to choose (spec 06 §6)`,
            });
          }
        }
        cells = chosen.flat().map((key) => {
          const [col, row] = key.split(":").map(Number) as [number, number];
          return { col, row };
        });
        host = isBridge ? (records.find((r) => r.isRoad) ?? other) : water;
      }
    }
    if (cells.length === 0) {
      cells = entityCells(e);
      const cellKeys = new Set(cells.map((c) => `${c.col}:${c.row}`));
      host = pathRecords.find((p) => (isBridge ? p.isRoad : p.isWater) && [...p.cells].some((c) => cellKeys.has(c)));
    }
    for (const c of cells) crossingCells.add(`${c.col}:${c.row}`);

    const parts: string[] = [titleEl];
    const derivedRecords = onRefs.map((p) => findRecord(p.ref)).filter((r): r is PathRecord => r !== undefined);
    const water = derivedRecords.find((r) => r.isWater);
    const roadRec = derivedRecords.find((r) => r.isRoad);
    if (water && roadRec) {
      // Exact geometric intersection: paint one band clipped by the other's
      // band shape — aligned with both by construction, no cell quantization.
      const hostRec = isBridge ? roadRec : water;
      const clipRec = isBridge ? water : roadRec;
      const clipId = `xing-${e.line}`;
      parts.push(`<clipPath id="${clipId}">${bandQuads(clipRec)}</clipPath>`);
      const scope: string[] = [];
      const band = (stroke: string, width: number): string =>
        el("polyline", {
          points: pointsAttr(hostRec.pts), fill: "none", stroke, "stroke-width": width,
          "stroke-linecap": "butt", "stroke-linejoin": "round", "clip-path": `url(#${clipId})`,
        });
      // A CROSSING IS THEMABLE LIKE ANYTHING ELSE (#208). These three colours
      // were literals at the draw site, so `ford : fill=…` and a theme's
      // `bridge : stroke=…` both reached nothing — the one feature on the map
      // whose whole job is to be noticed was the one a theme could not restyle.
      // Resolution goes through the CHAIN, so a derived word (`plank : bridge`,
      // `stepping-stones : ford`) inherits its base's styling per ADR 0016.
      //
      // The lookup stops AT the crossing word. Read down the whole chain it
      // reaches `feature`, whose generic tint is not a ford — measured, that
      // repainted every existing ford from the water colour to #cfd4b8, which
      // is a default change nobody asked for rather than the themability this
      // is about. Slicing keeps derivation working (`stepping-stones : ford`
      // still inherits `ford`'s styling, ADR 0016) while a word's archetype
      // default stays out of it.
      const stop = chain.findIndex((w) => w === "ford" || w === "bridge");
      const xingChain = stop >= 0 ? chain.slice(0, stop + 1) : chain;
      const themedFill = model.theme.prop(xingChain, "fill");
      const themedStroke = model.theme.prop(xingChain, "stroke");
      if (isBridge) {
        // The deck's outline, then its planking. A theme naming only one gets
        // the other from the pair it belongs to rather than a clashing default.
        // Derive the rail from a themed deck ONLY when the theme gave a deck
        // and no rail. Deriving unconditionally recoloured every existing
        // bridge — measured on fairwater-manor, #6b4a26 became #865e32 for a
        // document that names no theme at all, which is a default change
        // masquerading as a themability fix.
        scope.push(band(themedStroke ?? (themedFill ? shade(themedFill) : "#6b4a26"), hostRec.width + 6));
        scope.push(band(themedFill ?? "#a8763e", hostRec.width));
      } else {
        // A ford is water you can cross: its fill is the water showing through.
        scope.push(band(themedFill ?? "#c2d4dc", hostRec.width));
        if (e.flags.includes("difficult")) scope.push(band("url(#hatch)", hostRec.width));
      }
      // With multiple crossings and an `at` chooser, restrict to the chosen one.
      if (atCell?.kind === "address" && cells.length > 0) {
        const outerId = `xing-scope-${e.line}`;
        const pad = CELL;
        const rects = cells
          .map((c) =>
            el("rect", {
              x: MARGIN + (c.col - 1) * CELL - pad, y: MARGIN + (c.row - 1) * CELL - pad,
              width: CELL + 2 * pad, height: CELL + 2 * pad,
            }),
          )
          .join("");
        parts.push(`<clipPath id="${outerId}">${rects}</clipPath>`);
        parts.push(`<g clip-path="url(#${outerId})">${scope.join("")}</g>`);
      } else {
        parts.push(...scope);
      }
    } else if (host && cells.length > 0) {
      const clipId = `xing-${e.line}`;
      const clipRects = cells
        .map((c) =>
          el("rect", { x: MARGIN + (c.col - 1) * CELL, y: MARGIN + (c.row - 1) * CELL, width: CELL, height: CELL }),
        )
        .join("");
      parts.push(`<clipPath id="${clipId}">${clipRects}</clipPath>`);
      const band = (stroke: string, width: number): string =>
        el("polyline", {
          points: pointsAttr(host!.pts), fill: "none", stroke, "stroke-width": width,
          "stroke-linecap": "butt", "stroke-linejoin": "round", "clip-path": `url(#${clipId})`,
        });
      if (isBridge) {
        parts.push(band("#6b4a26", host.width + 6));
        parts.push(band("#a8763e", host.width));
      } else {
        parts.push(band("#c2d4dc", host.width));
        if (e.flags.includes("difficult")) parts.push(band("url(#hatch)", host.width));
      }
    } else {
      for (const { col, row } of cells) {
        const x = MARGIN + (col - 1) * CELL;
        const y = MARGIN + (row - 1) * CELL;
        parts.push(el("rect", { x, y, width: CELL, height: CELL, fill: isBridge ? "#a8763e" : "#c2d4dc", opacity: 0.95 }));
        if (!isBridge && e.flags.includes("difficult")) parts.push(el("rect", { x, y, width: CELL, height: CELL, fill: "url(#hatch)" }));
      }
    }
    layers.crossings.push(el("g", { id: anchor }, ...parts));
  }

  function cellName(key: string): string {
    const [col, row] = key.split(":").map(Number) as [number, number];
    return `${colLetters(col)}${row}`;
  }

  function parseCell(value: string): Address | null {
    const m = /^([A-Z]+)(\d+)$/.exec(value);
    return m ? { kind: "address", col: m[1]!, row: Number(m[2]!) } : null;
  }

  /**
   * The `drop` flag (spec 06 §5): an area's boundary is a fall edge, rendered
   * as the classic ticked cliff line — boundary stroke plus short outward ticks.
   */
  function dropEdge(r: { x: number; y: number; w: number; h: number }): string {
    const ink = model.theme.surface("ledge", "stroke", "#6b5d4a");
    const parts: string[] = [
      el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke: ink, ...inkStroke(2), class: "drop" }),
    ];
    const tick = 4;
    for (let x = r.x + 5; x < r.x + r.w; x += 9) {
      parts.push(el("line", { x1: x, y1: r.y, x2: x - 2, y2: r.y - tick, stroke: ink, ...inkStroke(1.2)}));
      parts.push(el("line", { x1: x, y1: r.y + r.h, x2: x - 2, y2: r.y + r.h + tick, stroke: ink, ...inkStroke(1.2)}));
    }
    for (let y = r.y + 5; y < r.y + r.h; y += 9) {
      parts.push(el("line", { x1: r.x, y1: y, x2: r.x - tick, y2: y - 2, stroke: ink, ...inkStroke(1.2)}));
      parts.push(el("line", { x1: r.x + r.w, y1: y, x2: r.x + r.w + tick, y2: y - 2, stroke: ink, ...inkStroke(1.2)}));
    }
    return el("g", {}, ...parts);
  }

  /**
   * A shaft passing through a level without opening onto it (#112): the
   * footprint is drawn as an obstruction — a walled well, hatched — not floor
   * and not a landing.
   *
   * This is the ground truth that was missing. The Endless Stair bores through
   * six levels, and on every one of them those cells were indistinguishable
   * from solid rock, so a party standing at that address was standing inside a
   * stairwell the map called stone.
   */
  function renderShaft(c: XY, into: string[]): void {
    const ink = model.theme.surface("ink", "fill", INK);
    const half = CELL * 0.42;
    into.push(
      el("rect", {
        x: c.x - half, y: c.y - half, width: half * 2, height: half * 2,
        fill: "none", stroke: ink, ...inkStroke(1.6),
      }),
      el("line", { x1: c.x - half, y1: c.y - half, x2: c.x + half, y2: c.y + half, stroke: ink, ...inkStroke(1)}),
      el("line", { x1: c.x + half, y1: c.y - half, x2: c.x - half, y2: c.y + half, stroke: ink, ...inkStroke(1)}),
    );
  }

  /**
   * The nearest landing other than the level being drawn. `landings` arrives in
   * `levels:` order (topmost first) and the comparison is strict, so an exact
   * tie — a panel with a landing one step above and one step below — keeps the
   * first seen and therefore resolves UPWARD. That is spec 06 §8's stated
   * tie-break (ADR 0048), not an artefact of the iteration: an interior panel
   * of a shaft genuinely has two next landings and the spec has to pick one.
   */
  function nextLandingIndex(levels: string[], landings: string[], from: number): number {
    let best = -1;
    for (const name of landings) {
      const idx = levels.indexOf(name);
      if (idx === -1 || idx === from) continue;
      if (best === -1 || Math.abs(idx - from) < Math.abs(best - from)) best = idx;
    }
    return best;
  }

  /**
   * The levels a flight actually stops at (spec 06 §8, ADR 0048, #321).
   *
   * All three terms are load-bearing and each looks redundant from a different
   * starting document. The DECLARING LEVEL is not in the `to=` value — a stair
   * `to=cellar` written on `house` stops at both — and without it a reciprocal
   * panel has no landing to name but itself. The `through=` range must be
   * SUBTRACTED because §8 gives those levels no landing at all; naming one
   * sends the party off a step that does not exist. And a `to=a..b` range
   * usually already contains its own declaring level, which is exactly what
   * makes the union look like dead weight on the first document you read.
   */
  function landingsOf(e: EntityNode, to: string, declaredLevel: string, levels: string[]): string[] {
    const named = new Set(levelSpan(levels, to));
    named.add(declaredLevel);
    const throughValue = pairOf(e.pairs, "through");
    if (throughValue !== undefined) for (const l of levelSpan(levels, throughValue)) named.delete(l);
    return levels.filter((l) => named.has(l));
  }

  /**
   * A level connector (spec 06 §8): themed via the word's chain with the
   * reserved up/down auto-state (`ladder.up : glyph=…`); default render is a
   * stair glyph. The direction/destination annotation is navigational and
   * renders even under labels: none.
   */
  function renderConnector(
    e: EntityNode,
    chain: string[],
    c: XY,
    to: string,
    parts: string[],
    into: string[],
    anchor: string | undefined,
    declaredLevel: string,
  ): void {
    if (!levelCtx) return;
    const currentIdx = levelCtx.levels.indexOf(levelCtx.level);
    // With a level RANGE (#112) the destination shown is the next landing in
    // the direction of travel, not the far end of the flight: standing on the
    // Third Level of one long stair, what matters is that the next landing
    // down is the First. Naming the bottom of the whole run would misreport
    // the step the party is about to take.
    //
    // THE ANNOTATION IS A PROPERTY OF THE FLIGHT, NOT OF THE PANEL THAT DREW IT
    // (spec 06 §8, ADR 0048, #321). So `declaredLevel` is a parameter and NOT
    // `levelCtx.level`: on the reciprocal path this is a DIFFERENT entity's
    // level than the panel being drawn, and collapsing the two — which is the
    // obvious simplification — is what makes every projected landing name the
    // level the stair was written on. `to` is likewise the connector's own
    // `to=` value on both paths, never the panel's.
    const targetIdx = nextLandingIndex(
      levelCtx.levels,
      landingsOf(e, to, declaredLevel, levelCtx.levels),
      currentIdx,
    );
    const up = targetIdx !== -1 && targetIdx < currentIdx;
    // Falls back to the raw `to=` only when nothing resolved — an undeclared
    // level, which fails loud elsewhere (§8).
    const shown = levelCtx.levels[targetIdx] ?? to;
    const ink = model.theme.surface("ink", "fill", INK);
    const themed =
      model.theme.glyphFor(chain, c.x, c.y, { state: up ? "up" : "down" }) ?? model.theme.glyphFor(chain, c.x, c.y);
    if (themed) {
      parts.push(
        `<path d="${themed}" transform="translate(${fmt(c.x)} ${fmt(c.y)}) scale(0.9)" fill="none" stroke="${ink}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`,
      );
    } else {
      // Default stair glyph: three treads narrowing toward the destination.
      for (let i = 0; i < 3; i++) {
        const half = 10 - i * 3;
        const y = c.y + (up ? 6 - i * 6 : -6 + i * 6);
        parts.push(el("line", { x1: c.x - half, y1: y, x2: c.x + half, y2: y, stroke: ink, ...inkStroke(2.2)}));
      }
    }
    parts.push(
      text(`${up ? "▲" : "▼"} ${shown}`, {
        x: c.x, y: c.y + CELL * 0.72, "font-size": 7.5, fill: ink, "text-anchor": "middle", "font-family": "sans-serif",
      }),
    );
    into.push(el("g", { id: anchor }, ...parts));
  }

  /** A path band as clipPath geometry: one quad per segment (butt caps). */
  function bandQuads(record: PathRecord): string {
    const half = record.width / 2;
    const quads: string[] = [];
    for (let i = 0; i < record.pts.length - 1; i++) {
      const a = record.pts[i]!;
      const b = record.pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * half;
      const ny = (dx / len) * half;
      quads.push(
        el("polygon", {
          points: pointsAttr([
            { x: a.x + nx, y: a.y + ny },
            { x: b.x + nx, y: b.y + ny },
            { x: b.x - nx, y: b.y - ny },
            { x: a.x - nx, y: a.y - ny },
          ]),
        }),
      );
    }
    return quads.join("");
  }

  function renderTerrain(e: EntityNode, titleEl: string, anchor: string | undefined): void {
    const chain = model.chainOf(e.typeWord);
    const fill = model.theme.terrainFill(chain);
    // Appearance zones on an AREA (spec 08 §2, #150): the boundary band in the
    // edge style, the interior in core. A rect union bands per rect — an inset
    // rect is the interior, and the base rect showing round it is the band.
    const zones = model.theme.zones(chain, fill);
    const bandRect = (r: { x: number; y: number; w: number; h: number }): string => {
      if (!zones) return el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill });
      const inset = Math.min(zones.width, r.w / 2, r.h / 2);
      return (
        el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: zones.edge }) +
        el("rect", { x: r.x + inset, y: r.y + inset, width: r.w - 2 * inset, height: r.h - 2 * inset, fill: zones.core })
      );
    };
    const areaParts: string[] = [];
    // One fall annotation per entity, not one per range in its footprint.
    let fellAnnotated = false;
    const pathParts: string[] = [];
    for (const p of e.placements) {
      if (p.kind === "shape" && p.shape === "area") {
        for (const arg of p.args) {
          if (arg.kind === "range") {
            const r = rangeRect(arg);
            areaParts.push(bandRect(r));
            if (e.flags.includes("difficult")) areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
            if (e.flags.includes("drop")) areaParts.push(dropEdge(r));
            // An unfloored area falls to the level below (spec 06 §5); `to=`
            // states where it actually lands when that is further down (#112).
            // The most famous fall in fantasy literature was a GM note,
            // because the geometry could not carry it.
            const fallsTo = pairOf(e.pairs, "to");
            if (fallsTo !== undefined && model.chainOf(e.typeWord).includes("air") && !fellAnnotated) {
              fellAnnotated = true;
              areaParts.push(
                text(`▼ falls to ${fallsTo}`, {
                  x: r.x + r.w / 2, y: r.y + r.h / 2,
                  "font-size": 8, fill: model.theme.surface("ledge", "stroke", "#6b5d4a"),
                  "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif",
                }),
              );
            }
          } else if (arg.kind === "address") {
            const o = cellOrigin(arg);
            areaParts.push(bandRect({ x: o.x, y: o.y, w: CELL, h: CELL }));
          }
        }
      } else if (p.kind === "shape" && p.shape === "path") {
        const addresses = p.args.filter((a): a is Address => a.kind === "address");
        const pts = addresses.map(cellCenter);
        // Drawn to the edges of the terminal cells; RECORDED as the declared
        // spine (#145) — see extendToCellEdge.
        const drawn = extendToCellEdge(pts, p.joinsAtEnd === true);
        // Unit-aware, and shared with `surfaceCells` so the ink and the ground
        // agree (#374). `width=10ft` at `scale: 5ft` is `width=2`.
        const width = widthInCells(pairOf(e.pairs, "width"), scaleOf(model)) * CELL * 0.85;
        const stroke = model.theme.pathStroke(chain);
        const bandStroke = chain.includes("river") ? model.theme.terrainFill(["sea"]) : stroke.stroke;
        // Zones on a path BAND (spec 08 §2, #150): the full width in the edge
        // style, then a narrower centre strip in core — a metalled road with
        // verges, a river with shallows.
        const pathZones = model.theme.zones(chain, bandStroke);
        if (pathZones) {
          pathParts.push(el("polyline", { points: pointsAttr(drawn), fill: "none", stroke: pathZones.edge, "stroke-width": width, "stroke-linecap": "butt", "stroke-linejoin": "round" }));
          const coreWidth = Math.max(width - 2 * pathZones.width, 1);
          pathCores.push(el("polyline", { points: pointsAttr(drawn), fill: "none", stroke: pathZones.core, "stroke-width": coreWidth, "stroke-linecap": "butt", "stroke-linejoin": "round" }));
        } else {
          pathParts.push(el("polyline", { points: pointsAttr(drawn), fill: "none", stroke: bandStroke, "stroke-width": width, "stroke-linecap": "butt", "stroke-linejoin": "round" }));
        }
        pathRecords.push({ e, cells: cellsAlong(pts), isWater: chain.includes("river"), isRoad: chain.includes("road"), pts, width });
        // A DISPLAY NAME is visible text at battle scale (spec 06 §7): the
        // tooltip rule covers the fallback WORD of an unnamed entity, not a
        // name the author wrote. Registered on the DRAWN course, since §7
        // anchors the label on the course as rendered.
        pendingTerrainLabels.push({ e, course: drawn });
      } else if (p.kind === "relational" && p.form === "side-of") {
        pendingHalfPlanes.push({
          e, compass: p.compass, ref: p.ref, slot: layers.areas.push("") - 1, titleEl, anchor,
        });
        // A derived extent is ground like any other, so it labels like any
        // other — over the cells it resolved to, not the ones it declared.
        if (!pendingTerrainLabels.some((t) => t.e === e)) pendingTerrainLabels.push({ e, course: null });
      } else if (p.kind === "range") {
        const r = rangeRect(p);
        areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill, opacity: 0.85 }));
        if (e.flags.includes("difficult")) areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
        if (e.flags.includes("drop")) areaParts.push(dropEdge(r));
      } else if (p.kind === "address") {
        const o = cellOrigin(p);
        areaParts.push(el("rect", { x: o.x, y: o.y, width: CELL, height: CELL, fill }));
      }
    }
    if (areaParts.length > 0 && !pendingTerrainLabels.some((t) => t.e === e)) pendingTerrainLabels.push({ e, course: null });
    if (areaParts.length > 0) layers.areas.push(el("g", { id: pathParts.length === 0 ? anchor : undefined }, titleEl, ...areaParts));
    if (pathParts.length > 0) layers.paths.push(el("g", { id: anchor }, titleEl, ...pathParts));
  }

  /**
   * A relational extent: terrain on the far side of another entity's course
   * (spec 06 §6, ADR 0038).
   *
   * THE INK STOPS AT THE REFERENCE'S CENTERLINE, and the cells stop half a
   * cell short of it — the two answers are deliberately different, as they
   * already are for a path's band (#145). The fill renders beneath that band,
   * so a fill stopping where its cells stop would leave a hairline of paper
   * down the whole reference: a `width=1` band inks 85% of its cell, so 2.4px
   * of a 32px cell shows on each side. Filling to the centerline puts terrain
   * under that margin instead, which is the bank §6 already describes.
   */
  function renderHalfPlane(p: PendingHalfPlane): void {
    const host = pathRecords.find((r) =>
      p.ref.form === "id" ? r.e.ids.includes(p.ref.value) : r.e.name === p.ref.value);
    if (!host || host.pts.length < 2) {
      diagnostics.push({
        severity: "warning",
        line: p.e.line,
        message: `'${p.e.typeWord ?? "terrain"}' is placed ${p.compass} of '${p.ref.value}', which declares no course to take a side of — reference a path, or give the cells (spec 06 §6)`,
      });
      return;
    }
    const chain = model.chainOf(p.e.typeWord);
    // The DRAWN course, so the fill meets the band it hides under all the way
    // into the terminal cells (#145) rather than stopping at their centres.
    const poly = halfPlaneArea(p.compass, extendToCellEdge(host.pts), frame);
    if (poly.length < 3) return;
    const parts = [el("polygon", { points: pointsAttr(poly), fill: model.theme.terrainFill(chain), opacity: 0.85 })];
    if (p.e.flags.includes("difficult")) parts.push(el("polygon", { points: pointsAttr(poly), fill: "url(#hatch)" }));
    layers.areas[p.slot] = el("g", { id: p.anchor }, p.titleEl, ...parts);
  }

  /**
   * An author-placed `[labels]` override, applied (#252).
   *
   * Spec 07 §5 states one absolute — "author-placed `[labels]` overrides are
   * never omitted" — and this renderer read none of them. The override was
   * parsed, resolved against the entity, and validated fail-loud (a typo'd
   * subject is a hard error here), so an author had positive evidence their
   * line was good, and the label rendered at its default position anyway.
   *
   * `at` returns a point in cell space; `side` offsets from wherever the
   * caller would have put it, so each site keeps its own idea of "beside";
   * `sprawl` letter-spaces across the declared range, as free text does; and
   * `along` rides the referenced course, reusing the machinery notes use.
   *
   * Returns true when it has emitted the label, so the caller skips its own.
   */
  function emitOverride(e: EntityNode, label: string, at: XY, into: string[]): boolean {
    const hint = overrideHints.get(e);
    if (!hint) return false;
    const base = { "font-size": 10, fill: INK, "font-family": "sans-serif" } as const;
    if (hint.kind === "at") {
      if (hint.target.kind === "point") {
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `'${label}' is placed at a gridless point on a battlemap — give the cell you mean (\`F6\`) (spec 07 §2)`,
        });
        return false;
      }
      const c = cellCenter(hint.target);
      into.push(text(label, { ...base, x: c.x, y: c.y + 4, "text-anchor": "middle" }));
      return true;
    }
    if (hint.kind === "side") {
      const d = COMPASS_OFFSET[hint.compass.toLowerCase()] ?? { x: 0, y: -1 };
      const gap = CELL * 0.75;
      into.push(text(label, {
        ...base,
        x: at.x + d.x * gap,
        y: at.y + d.y * gap + 4,
        "text-anchor": d.x > 0 ? "start" : d.x < 0 ? "end" : "middle",
      }));
      return true;
    }
    if (hint.kind === "sprawl") {
      if (hint.range.kind !== "range") return false;
      const r = rangeRect(hint.range);
      const size = 10;
      const spacing = Math.max(0, (r.w - label.length * size * 0.58) / Math.max(1, label.length - 1));
      into.push(text(label, {
        ...base, x: r.x + r.w / 2, y: r.y + r.h / 2 + 4, "letter-spacing": spacing, "text-anchor": "middle",
      }));
      return true;
    }
    // `along <ref>` — the same textPath a caption uses (spec 07 §2).
    const course = courseOf(hint.ref);
    if (!course || course.length < 2) return false;
    const pid = `cdoverride-${model.doc.docId}-${terrainCourseCount++}`;
    const leftward = course[course.length - 1]!.x < course[0]!.x;
    const ride = leftward ? [...course].reverse() : course;
    const d = `M${fmt(ride[0]!.x)} ${fmt(ride[0]!.y)}` + ride.slice(1).map((q) => `L${fmt(q.x)} ${fmt(q.y)}`).join("");
    into.push(
      `<defs><path id="${pid}" d="${d}"/></defs>` +
        `<text font-size="10" fill="${INK}" text-anchor="middle" font-family="sans-serif">` +
        `<textPath href="#${pid}" startOffset="50%"><tspan dy="-3">${escapeText(label)}</tspan></textPath></text>`,
    );
    return true;
  }

  /** The text a terrain entity labels itself with, or null if it labels none. */
  function terrainLabelText(e: EntityNode): string | null {
    if (!e.name || e.flags.includes("nolabel") || !labelsOn(model)) return null;
    return labelTextFor(model, e) ?? e.name;
  }

  /** A point a fraction of the way along a polyline, by arc length. */
  function alongCourse(course: XY[], t: number): XY {
    const segs: number[] = [];
    let total = 0;
    for (let i = 0; i < course.length - 1; i++) {
      const d = Math.hypot(course[i + 1]!.x - course[i]!.x, course[i + 1]!.y - course[i]!.y);
      segs.push(d);
      total += d;
    }
    let want = total * t;
    for (let i = 0; i < segs.length; i++) {
      if (want > segs[i]!) { want -= segs[i]!; continue; }
      const f = segs[i]! === 0 ? 0 : want / segs[i]!;
      return {
        x: course[i]!.x + (course[i + 1]!.x - course[i]!.x) * f,
        y: course[i]!.y + (course[i + 1]!.y - course[i]!.y) * f,
      };
    }
    return course[course.length - 1]!;
  }

  /**
   * A line feature's name, ON its course (spec 06 §7, #232).
   *
   * Anchored at the **arc-length midpoint of the drawn course**, never at an
   * endpoint — a name at the end of a river reads as labelling the place the
   * river stops. Where the midpoint is crowded the label SLIDES ALONG the
   * course to the nearest clear point rather than stepping off it: a name
   * pushed off a road reads as labelling the ground beside it.
   */
  function renderCourseLabel(t: PendingTerrainLabel): void {
    const label = terrainLabelText(t.e);
    if (label === null || !t.course || t.course.length < 2) return;
    const course = t.course;
    // An override outranks the arc-length rule: the author said where.
    if (emitOverride(t.e, label, alongCourse(t.course, 0.5), layers.roomLabels)) return;
    const w = label.length * 9 * 0.58;
    // Text on a path RIDES the path, so a name on a north-south road is drawn
    // turned on its side. Measured as a horizontal box the way every other
    // label is, it reports no collision where the ink plainly collides — a
    // river's name and a road's name met exactly over the ford they cross at,
    // each having found the midpoint clear. The footprint follows the course's
    // own direction at the point the label would sit.
    const footprint = (frac: number): { x: number; y: number; w: number; h: number } => {
      const at = alongCourse(course, frac);
      const a = alongCourse(course, Math.max(0, frac - 0.02));
      const b = alongCourse(course, Math.min(1, frac + 0.02));
      return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
        ? { x: at.x - w / 2, y: at.y - 9, w, h: 10 }
        : { x: at.x - 10, y: at.y - w / 2, w: 10, h: w };
    };
    const clash = (frac: number): number => {
      const box = footprint(frac);
      let overlap = 0;
      for (const o of labelObstructions) {
        const ox = Math.max(0, Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x));
        const oy = Math.max(0, Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y));
        overlap += ox * oy;
      }
      return overlap;
    };
    // Outward from the middle, so the nearest clear point wins and the name
    // stays as close to mid-course as the map allows (spec 06 §7).
    const offsets = [50, 42, 58, 34, 66, 26, 74, 18, 82];
    let best = offsets[0]!;
    let bestClash = Infinity;
    for (const o of offsets) {
      const c = clash(o / 100);
      if (c < bestClash) { bestClash = c; best = o; }
      if (c === 0) break;
    }
    labelObstructions.push(footprint(best / 100));
    const pid = `cdterrain-${model.doc.docId}-${terrainCourseCount++}`;
    // TEXT ON A PATH RUNS THE PATH'S WAY, so a course declared east-to-west
    // draws its name mirrored — upside down and reading backwards. The
    // author's declaration order is not a statement about typography: a seep
    // running from its spring down to the runnel is written spring-first
    // because that is where it starts, not because the name should be
    // reversed. Where the course runs leftward the label rides a reversed
    // copy, and the offset flips with it so it still lands mid-course.
    const leftward = course[course.length - 1]!.x < course[0]!.x;
    const lettered = leftward ? [...course].reverse() : course;
    const offset = leftward ? 100 - best : best;
    const d = `M${fmt(lettered[0]!.x)} ${fmt(lettered[0]!.y)}` +
      lettered.slice(1).map((p) => `L${fmt(p.x)} ${fmt(p.y)}`).join("");
    layers.roomLabels.push(
      `<defs><path id="${pid}" d="${d}"/></defs>` +
        `<text font-size="9" fill="${INK}" opacity="0.85" text-anchor="middle" font-family="sans-serif"` +
        `${model.labelsMode === "keyed" ? ' font-weight="bold"' : ""}>` +
        `<textPath href="#${pid}" startOffset="${offset}%"><tspan dy="-3">${escapeText(label)}</tspan></textPath></text>`,
    );
  }

  /** An area's name, within its own footprint — including a derived one. */
  function renderAreaLabel(t: PendingTerrainLabel): void {
    const label = terrainLabelText(t.e);
    if (label === null) return;
    const cells = surfaceCells(t.e, halfPlaneContext(model.doc, model.entities));
    if (cells.size === 0) return;
    const at = placeRoomLabel(label, cells);
    if (emitOverride(t.e, label, at, layers.roomLabels)) return;
    const w = label.length * 10 * 0.58;
    labelObstructions.push({ x: at.x - w / 2, y: at.y - 8, w, h: 10 });
    layers.roomLabels.push(
      text(label, {
        x: at.x, y: at.y, "font-size": 10, fill: INK,
        "font-weight": model.labelsMode === "keyed" ? "bold" : undefined,
        opacity: 0.8, "text-anchor": "middle", "font-family": "sans-serif",
      }),
    );
  }

  function renderStructure(e: EntityNode, into: string[], titleEl: string, anchor: string | undefined): void {
    // Cell-union footprint (spec 06 §3, #45): the union of ranges and cells,
    // with the perimeter DERIVED — an L-shaped hall is `K5..M8 K9..K12`.
    const cells = structureCells(e);
    if (cells.size === 0) return;
    // The `open` flag (spec 06 §3, #33): walls without a ceiling. The interior
    // reads as outdoor ground, themable as a state (`building.open : fill=…`).
    const open = e.flags.includes("open");
    const fill = model.theme.prop(model.chainOf(e.typeWord), "fill", open ? { state: "open" } : {}) ?? "#efe9da";

    let colMin = Infinity, colMax = -Infinity, rowMin = Infinity, rowMax = -Infinity;
    for (const c of cells.values()) {
      colMin = Math.min(colMin, c.col); colMax = Math.max(colMax, c.col);
      rowMin = Math.min(rowMin, c.row); rowMax = Math.max(rowMax, c.row);
    }
    const isRect = cells.size === (colMax - colMin + 1) * (rowMax - rowMin + 1);
    const parts: string[] = [titleEl];
    if (isRect) {
      const r = { x: MARGIN + (colMin - 1) * CELL, y: MARGIN + (rowMin - 1) * CELL, w: (colMax - colMin + 1) * CELL, h: (rowMax - rowMin + 1) * CELL };
      parts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill, opacity: 0.8 }));
    } else {
      // One path of per-cell squares: nonzero fill merges interior seams.
      const d = [...cells.values()]
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((c) => `M${fmt(MARGIN + (c.col - 1) * CELL)} ${fmt(MARGIN + (c.row - 1) * CELL)}h${CELL}v${CELL}h-${CELL}Z`)
        .join("");
      parts.push(el("path", { d, fill, opacity: 0.8 }));
    }

    // Walls: merged perimeter runs; a `ruined` side word selects runs FACING
    // that direction (whole-side semantics generalized to unions).
    // Opening edges are SUBTRACTED before merging (#103): an opening is a hole,
    // and spec 06 §9's UVTT line_of_sight already says so normatively. Drawing
    // the wall straight across meant the render and the export disagreed about
    // the same document — and an archway read as unbroken stone.
    // `ruined` reaches a structure two ways: as a detail line selecting sides
    // by facing (`ruined : north east`, spec 06 §3) or as the bare state the
    // stdlib declares on `building` (spec 06 §2) — which selects every side.
    // Only the first was honoured, so a flag-form ruin drew as intact walls
    // (freestanding barriers already read the flag; structures did not).
    const ruinedSides = new Set(e.details.filter((d) => d.typeWord === "ruined").flatMap((d) => d.flags));
    const ruinedAll = e.flags.includes("ruined");
    const openEdges = openingEdgeKeys();
    const solidEdges = perimeterEdges(cells).filter((pe) => {
      const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
      return !openEdges.has(segKey(edgeSegment(address, pe.dir)));
    });
    // Sides replaced by another barrier (#130) are drawn as THAT barrier, so
    // they leave the structure's own perimeter run and merge among themselves
    // — otherwise a cave-in would inherit the room's stroke and the line would
    // say one thing while looking like another.
    const replacedEdges = barrierSides(model, e);
    const ownEdges = solidEdges.filter((pe) => {
      const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
      return !replacedEdges.has(segKey(edgeSegment(address, pe.dir)));
    });
    // A structure's perimeter is a theme subject like every other archetype
    // (#117): the room outline is the most visually defining thing on a
    // battlemap, and it was drawn in literal ink at a literal weight, so no
    // theme could restyle it by any lever. Resolves through the structure's
    // own vocabulary word, so derived words and `word.state` both answer.
    const structChain = model.chainOf(e.typeWord);
    const wallCtx = open ? { state: "open" } : {};
    const wallStroke = model.theme.prop(structChain, "stroke", wallCtx) ?? INK;
    const wallWidth = Number(model.theme.prop(structChain, "width", wallCtx) ?? 3) || 3;
    // Each replaced barrier draws its own merged runs, themed by its own word.
    for (const word of new Set(replacedEdges.values())) {
      const mine = solidEdges.filter((pe) => {
        const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
        return replacedEdges.get(segKey(edgeSegment(address, pe.dir))) === word;
      });
      const chain = model.chainOf(word);
      const stroke = model.theme.prop(chain, "stroke", {}) ?? INK;
      const width = Number(model.theme.prop(chain, "width", {}) ?? 3) || 3;
      const dash = model.theme.prop(chain, "dash", {})?.replace(",", " ");
      for (const run of mergeEdgeRuns(mine)) {
        parts.push(
          el("line", {
            x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2,
            stroke, ...inkStroke(width), "stroke-dasharray": dash,
          }),
        );
      }
    }
    for (const run of mergeEdgeRuns(ownEdges)) {
      const ruined = ruinedAll || ruinedSides.has(SIDE_NAME[run.dir]) || ruinedSides.has(run.dir);
      // `ruined` is a state, so a theme may restyle it — falling back to the
      // built-in collapsed dashes when it says nothing.
      const ruinedStroke = ruined ? model.theme.prop(structChain, "stroke", { state: "ruined" }) : undefined;
      const ruinedDash = ruined ? model.theme.prop(structChain, "dash", { state: "ruined" })?.replace(",", " ") : undefined;
      parts.push(
        el("line", {
          x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2,
          stroke: ruinedStroke ?? wallStroke,
          ...inkStroke(wallWidth),
          "stroke-dasharray": ruined ? (ruinedDash ?? "5 6") : (model.theme.prop(structChain, "dash", wallCtx)?.replace(",", " ")),
          opacity: ruined ? 0.7 : 1,
        }),
      );
    }
    // SPEC 06 §3 IS A CLOSED SET, AND BOTH HALVES OF IT WERE UNENFORCED.
    // A structure detail's subject is a wall state, an opening, or a barrier
    // word; its predicate is side words or edge tokens. Anything else used to
    // be swallowed instead of refused: a cell predicate hit the `continue`
    // below and rendered byte-identically to its own absence, doors included
    // (#293), and a subject outside the three drew a line in the wall's own
    // ink at the wall's own weight — invisible, on top of the wall it sat on
    // (#294, the else-branch #103 left live). A barrier subject fared worse
    // still: it drew there AND on its own themed run, so a `fence` edge came
    // out twice at two different weights.
    //
    // What the author almost always means by a detail the slot cannot take is
    // a thing standing IN the room, which is an entity of its own — so the
    // messages name that spelling rather than only refusing.
    const detailParent = e.ids[0] ?? e.name ?? e.typeWord ?? "the structure";
    const wallStates = model.statesOf(e.typeWord);
    for (const d of e.details) {
      const subject = d.typeWord;
      const archetype = model.archetypeOf(subject);
      // `ruined` and its kin resolve to no archetype — they are states of the
      // structure's own word, which is why this asks the parent rather than
      // matching a literal (the trap #103 named).
      const isWallState = subject !== null && archetype === null && wallStates.has(subject);
      if (subject !== null && archetype !== "opening" && archetype !== "barrier" && !isWallState) {
        diagnostics.push({
          severity: "error",
          line: d.line,
          message:
            `'${subject}' is not an opening, a wall state, or a barrier, so it cannot be a detail of `
            + `'${detailParent}' — those three are what an indented line under a structure may say `
            + `(spec 06 §3). For something standing in the room, give it its own line: `
            + `'${subject} : on ${detailParent} at A1'`,
        });
        continue;
      }
      for (const p of d.placements) {
        if (p.kind !== "edge") {
          // An opening wants an EDGE — telling its author to move the door
          // out of the room would be answering a question they did not ask.
          const fix = archetype === "opening"
            ? `name the edge it sits on: '${subject} : at A1.n'`
            : `give it its own line: '${subject ?? "it"} : on ${detailParent} at A1'`;
          diagnostics.push({
            severity: "error",
            line: d.line,
            message:
              `'${subject ?? "this detail"}' is placed on a cell, but a structure detail addresses a `
              + `WALL — side words ('north east') or edge tokens ('A1.n') (spec 06 §3). ${fix}`,
          });
          continue;
        }
        const o = cellOrigin(p.at);
        const seg =
          p.dir === "n" ? { x1: o.x, y1: o.y, x2: o.x + CELL, y2: o.y }
          : p.dir === "s" ? { x1: o.x, y1: o.y + CELL, x2: o.x + CELL, y2: o.y + CELL }
          : p.dir === "w" ? { x1: o.x, y1: o.y, x2: o.x, y2: o.y + CELL }
          : { x1: o.x + CELL, y1: o.y, x2: o.x + CELL, y2: o.y + CELL };
        // Openings go to their own layer, above every structure's walls (spec 06 §3).
        // Appearance resolves through the vocabulary CHAIN, never the literal
        // word (#103): `portal : door` is a door. The old literal match sent
        // every derived opening to an else-branch that drew it in the wall's
        // own ink at the wall's own weight — invisible, on top of the wall.
        const openingChain = model.chainOf(d.typeWord);
        // A barrier and a wall state are drawn by their own paths above — the
        // barrier as its own themed run, the state on the perimeter it marks.
        // Drawing them here as well is what doubled a `fence` edge at two
        // different weights; the subject check above has already refused
        // everything that belongs to neither path.
        if (model.archetypeOf(d.typeWord) !== "opening") continue;
        const windowLike = openingChain.includes("window") || openingChain.includes("arrow-slit");
        const stroke = model.theme.prop(openingChain, "stroke") ?? (windowLike ? "#6fa8c9" : "#a8763e");
        const width = Number(model.theme.prop(openingChain, "width") ?? (windowLike ? 2.5 : 5)) || (windowLike ? 2.5 : 5);
        // A DOOR'S STATE IS DRAWN HERE TOO (#206). This is the common path —
        // an opening declared as a detail line under its structure — and it is
        // the one the four `door` states were invisible on.
        const ruinedOpening = d.flags.includes("ruined");
        layers.openings.push(el("line", {
          ...seg, stroke, ...inkStroke(width),
          "stroke-dasharray": ruinedOpening ? "4 4" : undefined,
          opacity: ruinedOpening ? 0.6 : undefined,
        }));
        layers.openings.push(...openingStateMarks(
          d, { a: { x: seg.x1, y: seg.y1 }, b: { x: seg.x2, y: seg.y2 } }, stroke, width,
          model.theme.surface("paper", "fill", PAPER),
        ));
      }
    }
    into.push(el("g", { id: anchor }, ...parts));
    // Room labels sit in the middle of the rooms they label (module convention;
    // also keeps them on the room's light fill rather than e.g. dark earth) —
    // and BELOW features and tokens: floor-plan text never occludes the pieces.
    // Since the label can't win a z-fight, it dodges instead: among the room's
    // cell rows, prefer the one nearest center whose span is clear of pieces.
    if (e.name && !e.flags.includes("nolabel") && labelsOn(model)) {
      const lbl = labelTextFor(model, e);
      if (lbl !== null) {
        const at = placeRoomLabel(lbl, cells);
        if (emitOverride(e, lbl, at, layers.roomLabels)) return;
        layers.roomLabels.push(
          text(lbl, {
            x: at.x, y: at.y, "font-size": 10, fill: INK,
            "font-weight": model.labelsMode === "keyed" ? "bold" : undefined,
            opacity: 0.8, "text-anchor": "middle", "font-family": "sans-serif",
          }),
        );
      }
    }
  }

  /**
   * Room-label position: candidate baselines at the center of each cell-row's
   * contiguous runs WITHIN the footprint union (an L-shape's bounding-rect
   * center can lie outside the room), scored by overlap with the pieces'
   * cells, a small pull toward the room's centroid, and a penalty for runs
   * narrower than the label. A clear row near center wins; a fully cluttered
   * room degrades to the least-covered row.
   */
  function placeRoomLabel(name: string, cells: Map<string, Cell>): XY {
    let sx = 0, sy = 0;
    const rows = new Map<number, number[]>();
    for (const c of cells.values()) {
      sx += MARGIN + (c.col - 0.5) * CELL;
      sy += MARGIN + (c.row - 0.5) * CELL;
      const list = rows.get(c.row) ?? [];
      list.push(c.col);
      rows.set(c.row, list);
    }
    const cx = sx / cells.size;
    const cy = sy / cells.size;
    const w = name.length * 10 * 0.58;
    let best: XY = { x: cx, y: cy - 8 };
    let bestScore = Infinity;
    const candidates: { x: number; rowY: number; runW: number }[] = [];
    for (const [row, cols] of rows) {
      cols.sort((a, b) => a - b);
      const rowY = MARGIN + (row - 0.5) * CELL;
      let start = cols[0]!;
      let prev = cols[0]!;
      const flush = (end: number): void =>
        void candidates.push({ x: MARGIN + ((start + end) / 2 - 0.5) * CELL, rowY, runW: (end - start + 1) * CELL });
      for (const col of cols.slice(1)) {
        if (col !== prev + 1) {
          flush(prev);
          start = col;
        }
        prev = col;
      }
      flush(prev);
    }
    for (const { x, rowY, runW } of candidates) {
      const box = { x: x - w / 2, y: rowY - 5, w, h: 10 };
      let overlap = 0;
      for (const o of labelObstructions) {
        const ox = Math.max(0, Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x));
        const oy = Math.max(0, Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y));
        overlap += ox * oy;
      }
      const score = overlap + Math.abs(rowY - cy) * 0.5 + Math.abs(x - cx) * 0.1 + Math.max(0, w - runW) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y: rowY + 3.5 };
      }
    }
    return best;
  }

  /**
   * An opening perforating declared terrain, with no parent structure
   * (spec 06 §3, #113). Fail-loud where the geometry doesn't support it:
   * passable on both sides is a door standing in open air; impassable on both
   * is a door inside solid rock. Neither is a passage through anything.
   */
  function renderUnparentedOpening(e: EntityNode, titleEl: string, anchor: string | undefined): void {
    const rock = impassableCells(model);
    // A barrier to perforate can be any of the three spec 06 §3 allows, and the
    // error message promises all three: a structure's perimeter, a freestanding
    // barrier, or (new in #113) a declared impassable surface. Checking only
    // the last rejected two forms the language has always permitted.
    const barrierEdges = new Set<string>();
    for (const other of model.entities) {
      if (other.archetype === "structure") {
        const cells = structureCells(other);
        for (const pe of perimeterEdges(cells)) {
          const address: Address = { kind: "address", col: colLetters(pe.cell.col), row: pe.cell.row };
          barrierEdges.add(segKey(edgeSegment(address, pe.dir)));
        }
      } else if (other.archetype === "barrier") {
        for (const p of other.placements) {
          if (p.kind === "edge") barrierEdges.add(segKey(edgeSegment(p.at, p.dir)));
        }
      }
    }
    const chain = model.chainOf(e.typeWord);
    const windowLike = chain.includes("window") || chain.includes("arrow-slit");
    const stroke = model.theme.prop(chain, "stroke") ?? (windowLike ? "#6fa8c9" : "#a8763e");
    const width = Number(model.theme.prop(chain, "width") ?? (windowLike ? 2.5 : 5)) || (windowLike ? 2.5 : 5);
    const parts: string[] = [titleEl];
    for (const p of e.placements) {
      if (p.kind !== "edge") continue;
      const here = { col: colToNumber(p.at.col), row: p.at.row };
      // Only the four cell edges separate two cells; a corner token addresses
      // a point, which nothing can be a passage through.
      const steps: Record<string, { dc: number; dr: number }> = {
        n: { dc: 0, dr: -1 }, s: { dc: 0, dr: 1 }, e: { dc: 1, dr: 0 }, w: { dc: -1, dr: 0 },
      };
      const n = steps[p.dir];
      if (!n) {
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `an opening takes a cell EDGE (n/e/s/w), not the corner ${p.at.col}${p.at.row}.${p.dir} (spec 02 §5)`,
        });
        continue;
      }
      const onBarrier = barrierEdges.has(segKey(edgeSegment(p.at, p.dir)));
      const solidHere = rock.has(`${here.col}:${here.row}`);
      const solidThere = rock.has(`${here.col + n.dc}:${here.row + n.dr}`);
      if (!onBarrier && solidHere === solidThere) {
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: solidHere
            ? `opening '${e.typeWord ?? ""}' at ${p.at.col}${p.at.row}.${p.dir} has solid ground on both sides — it passes through nothing (spec 06 §3)`
            : `opening '${e.typeWord ?? ""}' at ${p.at.col}${p.at.row}.${p.dir} has no barrier to perforate — give it a parent structure, a freestanding wall, or a declared impassable surface (spec 06 §3)`,
        });
        continue;
      }
      const s = edgeSegment(p.at, p.dir);
      // A DOOR'S STATE IS DRAWN (#206). `door` declares four — locked, barred,
      // stuck, ruined — and every one of them rendered as an ordinary door, so
      // the four most common facts a GM records about the most common opening
      // in any dungeon were legal, checked, and invisible. A state that renders
      // identically to its absence is the document saying something the map
      // does not.
      //
      // `ruined` reuses the convention barriers already use for it — dashed and
      // faded — so a reader learns one rule for the word rather than one per
      // archetype. The other three are marks laid ON the opening, in its own
      // ink, so they read at battle scale without a legend.
      const ruinedDoor = e.flags.includes("ruined");
      parts.push(el("line", {
        x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, stroke, ...inkStroke(width),
        "stroke-dasharray": ruinedDoor ? "4 4" : undefined,
        opacity: ruinedDoor ? 0.6 : undefined,
      }));
      parts.push(...openingStateMarks(e, s, stroke, width, model.theme.surface("paper", "fill", PAPER)));
    }
    if (parts.length > 1) layers.openings.push(el("g", { id: anchor }, ...parts));
  }

  /** The cell-centre course of a referenced path entity, for `along` captions. */
  function courseOf(ref: { form: string; value: string }): XY[] | null {
    const key = ref.value;
    for (const other of model.entities) {
      const matches = ref.form === "id" ? other.ids.includes(key) : other.name === key;
      if (!matches) continue;
      for (const p of other.placements) {
        if (p.kind === "shape" && p.shape === "path") {
          const addresses = p.args.filter((a): a is Address => a.kind === "address");
          if (addresses.length > 1) return addresses.map(cellCenter);
        }
      }
    }
    return null;
  }

  /**
   * Free text: the caption and nothing else (spec 07 §2, #104). `sprawl`
   * spreads it across its range, which is the only thing distinguishing it
   * from a bare range placement.
   */
  function renderFreeText(e: EntityNode, into: string[], titleEl: string, anchor: string | undefined): void {
    const label = e.texts[0] ?? e.name;
    if (!label) return;
    // A caption takes the word's own `fill` (spec 08 §3), with the `ink`
    // surface as the default. `note : fill=` reached nothing before (#150),
    // and a caption you cannot colour disappears into the paper on a dark map.
    const textFill = model.theme.prop(model.chainOf(e.typeWord), "fill") ?? model.theme.surface("ink", "fill", INK);
    const range = e.placements.find((p): p is AddressRange => p.kind === "range");
    const address = e.placements.find((p): p is Address => p.kind === "address");
    let at: XY | null = null;
    let span = 0;
    if (range) {
      const r = rangeRect(range);
      at = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      span = r.w;
    } else if (address) {
      at = cellCenter(address);
    }
    if (!at) {
      // `along <ref>` sets the caption ON the referenced course (spec 07 §2,
      // #107) — the placement set is closed, so anything else is a parse error
      // and this is the only remaining form.
      const along = e.placements.find((p) => p.kind === "relational" && p.form === "along");
      const course = along && along.kind === "relational" ? courseOf(along.ref) : null;
      if (course && course.length > 1) {
        const pid = `cdnote-${model.doc.docId}-${noteCourseCount++}`;
        const d = `M${fmt(course[0]!.x)} ${fmt(course[0]!.y)}` + course.slice(1).map((pt) => `L${fmt(pt.x)} ${fmt(pt.y)}`).join("");
        into.push(
          `<defs><path id="${pid}" d="${d}"/></defs>` +
            `<text font-size="9" fill="${textFill}" text-anchor="middle" font-family="sans-serif">` +
            `<textPath href="#${pid}" startOffset="50%"><tspan dy="-4">${escapeText(label)}</tspan></textPath></text>`,
        );
        return;
      }
      diagnostics.push({
        severity: "warning",
        line: e.line,
        message: `free text "${label}" has no cell, range, or resolvable course — this renderer draws nothing for it (spec 07 §2)`,
      });
      return;
    }
    const size = 9;
    const spacing =
      e.flags.includes("sprawl") && span > 0
        ? Math.max(0, (span - label.length * size * 0.58) / Math.max(1, label.length - 1))
        : undefined;
    into.push(
      el("g", { id: anchor }, titleEl,
        text(label, {
          x: at.x, y: at.y, "font-size": size, "letter-spacing": spacing,
          fill: textFill, "text-anchor": "middle", "font-family": "sans-serif",
        }),
      ),
    );
  }

  function renderZone(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined, elevation: string | undefined): void {
    const range = e.placements.find((p): p is AddressRange => p.kind === "range");
    if (!range) return;
    const r = rangeRect(range);
    const gmZone = e.gmOnly;
    // A zone's own theme entry wins (#105); the built-in role colours (gm red,
    // ledge tan, staging green) remain the fallback when nothing is declared.
    const themed = model.theme.prop(model.chainOf(e.typeWord), "fill");
    const stroke = themed ?? (gmZone ? "#b5504a" : elevation ? "#6b5d4a" : "#4a9a6a");
    into.push(
      el("g", { id: anchor, class: elevation ? "ledge" : undefined },
        titleEl,
        el("rect", {
          x: r.x, y: r.y, width: r.w, height: r.h,
          fill: themed ?? (gmZone ? "#b5504a" : elevation ? "#efe6d2" : "#4a9a6a"),
          opacity: elevation ? 0.7 : 0.12,
        }),
        el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke, ...inkStroke(elevation ? 3.5 : 1.5), "stroke-dasharray": elevation ? undefined : "6 4" }),
      ),
    );
    const label = e.name ?? e.ids[0] ?? e.typeWord;
    if (label && !e.flags.includes("nolabel") && labelsOn(model)) {
      const zoneAt = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      if (!emitOverride(e, label, zoneAt, labels))
      labels.push(text(elevation ? `${label} (${elevation})` : label, { x: r.x + r.w / 2, y: r.y + 12, "font-size": 9, fill: stroke, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
  }

  /**
   * Freestanding barriers (#62, spec 06 §3): edge runs draw as wall lines —
   * fences lighter and dashed (they pass sight), `ruined` collapsed like a
   * structure's ruined side; cell placements (pillars) draw as dark posts.
   */
  function renderBarrier(e: EntityNode, into: string[], titleEl: string, anchor: string | undefined): void {
    const chain = model.chainOf(e.typeWord);
    const isFence = chain.includes("fence");
    const ruined = e.flags.includes("ruined");
    const parts: string[] = [titleEl];
    if (!e.name && !titleEl && e.typeWord) parts.unshift(svgTitle(e.typeWord));
    // Barriers are theme subjects like any other archetype (#105); the chain
    // carries derived words (`palisade : fence` keeps the dashes).
    const themedStroke = model.theme.prop(chain, "stroke");
    const themedDash = model.theme.prop(chain, "dash")?.replace(",", " ");
    const themedWidth = model.theme.prop(chain, "width");
    for (const p of e.placements) {
      if (p.kind === "edge") {
        const s = edgeSegment(p.at, p.dir);
        parts.push(
          el("line", {
            x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y,
            stroke: themedStroke ?? (isFence ? "#8a7a5c" : INK),
            ...inkStroke(Number(themedWidth ?? (isFence ? 2 : 3)) || (isFence ? 2 : 3)),
            "stroke-dasharray": ruined && !isFence ? "5 6" : (themedDash ?? (isFence ? "3 3" : undefined)),
            opacity: ruined ? 0.7 : 1,
            "stroke-linecap": "square",
          }),
        );
      } else if (p.kind === "address") {
        const c = cellCenter(p);
        // A point-placed barrier occupies a cell exactly like a point feature,
        // so it takes a glyph like one (#119) — a pillar wants a column mark.
        const glyph = model.theme.glyphFor(chain, c.x, c.y);
        if (glyph) {
          parts.push(themedGlyphPath(glyph, chain, c));
        } else {
          const fill = model.theme.prop(chain, "fill") ?? "#5a5244";
          parts.push(el("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill, stroke: INK, ...inkStroke(1)}));
        }
      }
    }
    into.push(el("g", { id: anchor }, ...parts));
    if (e.name && !e.flags.includes("nolabel") && labelsOn(model)) {
      const first = e.placements.find((p) => p.kind === "edge" || p.kind === "address");
      if (first) {
        const at = first.kind === "edge" ? edgeSegment(first.at, first.dir).a : cellCenter(first);
        const lbl = labelTextFor(model, e) ?? e.name;
        layers.labels.push(text(lbl, { x: at.x, y: at.y - 6, "font-size": 8, fill: INK, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
    }
  }

  /**
   * A themed glyph carries its entry's colour (#119). Spec 08 §3 lists `fill`
   * and `glyph` as independent members of one closed set, so a themer should
   * not have to choose the shape OR the colour — `fill=` paints the path and
   * `stroke=` inks it, each falling back to the previous outline-only look.
   */
  function themedGlyphPath(d: string, chain: string[], c: XY): string {
    const fill = model.theme.prop(chain, "fill");
    const stroke = model.theme.prop(chain, "stroke") ?? model.theme.surface("ink", "fill", INK);
    const width = Number(model.theme.prop(chain, "width") ?? 1.6) || 1.6;
    const opacity = model.theme.prop(chain, "opacity");
    return (
      `<path d="${d}" transform="translate(${fmt(c.x)} ${fmt(c.y)}) scale(0.9)" fill="${fill ?? "none"}"` +
      ` stroke="${stroke}" stroke-width="${fmt(width)}"${opacity ? ` opacity="${opacity}"` : ""}` +
      ` vector-effect="non-scaling-stroke" stroke-linecap="round"/>`
    );
  }

  /**
   * Hand-drawn glyph fallbacks, CHAIN-resolved (#64): a derived
   * `hearth : campfire` keeps the flame — derivation carries semantics
   * (spec 04 §2); themes may still override via [glyphs].
   */
  function fallbackGlyph(e: EntityNode, chain: string[], c: XY, scale: number, parts: string[]): boolean {
    const has = (w: string): boolean => chain.includes(w);
    if (has("campfire") || has("torch") || has("brazier") || has("lantern")) {
      // Sized to be seen (#66): the ember plus a flame lick above it.
      parts.push(el("circle", { cx: c.x, cy: c.y + 1.5 * scale, r: 6 * scale, fill: "#d9822b", stroke: "#a8541e", ...inkStroke(1.5)}));
      parts.push(
        el("path", {
          d: `M${fmt(c.x - 3 * scale)} ${fmt(c.y - 3 * scale)} Q${fmt(c.x - 1 * scale)} ${fmt(c.y - 9 * scale)} ${fmt(c.x + 1 * scale)} ${fmt(c.y - 5 * scale)} Q${fmt(c.x + 2.5 * scale)} ${fmt(c.y - 8 * scale)} ${fmt(c.x + 3.5 * scale)} ${fmt(c.y - 3.5 * scale)}`,
          fill: "none", stroke: "#a8541e", ...inkStroke(1.5), "stroke-linecap": "round",
        }),
      );
      return true;
    }
    if (has("wagon")) {
      const facing = pairOf(e.pairs, "facing");
      const rot = facing === "south" || facing === "north" ? 90 : 0;
      parts.push(
        el("rect", {
          x: c.x - CELL * 0.45 * scale, y: c.y - CELL * 0.28 * scale, width: CELL * 0.9 * scale, height: CELL * 0.56 * scale,
          fill: "#a8763e", stroke: INK, ...inkStroke(1.5),
          "stroke-dasharray": e.flags.includes("overturned") ? "4 3" : undefined,
          transform: rot ? `rotate(${rot} ${fmt(c.x)} ${fmt(c.y)})` : undefined,
        }),
      );
      return true;
    }
    if (has("stairs") || has("ramp")) {
      // Treads narrow toward the ascent, capped by a chevron (#66); `facing=`
      // turns the flight (the direction climbed): n (default), e, s, w.
      const facing = pairOf(e.pairs, "facing") ?? "n";
      const rot = { n: 0, e: 90, s: 180, w: 270 }[facing] ?? 0;
      const stair: string[] = [];
      for (const [i, w] of [4, 7, 10].entries()) {
        const y = c.y + (i - 1) * 6 * scale;
        stair.push(el("line", { x1: c.x - w * scale, y1: y, x2: c.x + w * scale, y2: y, stroke: INK, ...inkStroke(2.2)}));
      }
      stair.push(
        el("path", {
          d: `M${fmt(c.x - 3 * scale)} ${fmt(c.y - 9 * scale)} L${fmt(c.x)} ${fmt(c.y - 13 * scale)} L${fmt(c.x + 3 * scale)} ${fmt(c.y - 9 * scale)}`,
          fill: "none", stroke: INK, ...inkStroke(1.8), "stroke-linecap": "round", "stroke-linejoin": "round",
        }),
      );
      parts.push(rot === 0 ? stair.join("") : el("g", { transform: `rotate(${rot} ${fmt(c.x)} ${fmt(c.y)})` }, ...stair));
      return true;
    }
    return false;
  }

  function renderToken(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined): void {
    const size = Number(pairOf(e.pairs, "size") ?? 1) || 1;
    const fill = model.theme.side(pairOf(e.pairs, "side"));
    const addresses = e.placements.filter((p): p is Address => p.kind === "address");
    addresses.forEach((a, idx) => {
      const base = cellCenter(a);
      const center = { x: base.x + ((size - 1) * CELL) / 2, y: base.y + ((size - 1) * CELL) / 2 };
      const radius = 0.38 * CELL * size;
      // Token identifiers (g1, g2) stay identifiers; named tokens key like any name.
      const label =
        addresses.length > 1
          ? (e.ids[idx] ?? `${e.typeWord}${idx + 1}`)
          : (labelTextFor(model, e) ?? e.ids[0] ?? e.typeWord ?? "?");
      into.push(
        el("g", { id: idx === 0 ? anchor : undefined },
          titleEl,
          el("circle", {
            cx: center.x, cy: center.y, r: radius, fill, opacity: 0.9,
            stroke: e.flags.includes("hidden") ? "#fff" : "#3d3629",
            ...inkStroke(1.5),
            "stroke-dasharray": e.flags.includes("hidden") ? "3 3" : undefined,
          }),
        ),
      );
      if (!e.flags.includes("nolabel") && labelsOn(model)) {
        if (!emitOverride(e, label, center, labels))
        labels.push(text(label, { x: center.x, y: center.y + radius + 10, "font-size": 9, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
    });
  }

  /**
   * A feature line places one entity per cell it names — `torch : D8 H8 L8`
   * is three torches, exactly as `pillar : D8 H8 L8` is three pillars.
   *
   * Only the FIRST address was drawn (#140). Barriers had always drawn every
   * placement, so the two archetypes disagreed about what a cell list means,
   * and the feature reading was the wrong one: a row of lamps down a gallery
   * rendered as a single lamp at its head, silently, however many cells the
   * author listed. `every … along` made it visible by generating such lists
   * automatically, but the bug predates it and bites hand-written lines too.
   *
   * Only the first address takes the LABEL: the set is named once, not once
   * per cell (spec 07 §1).
   */
  function renderFeature(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined): void {
    const addresses = e.placements.filter((p): p is Address => p.kind === "address");
    if (addresses.length > 1) {
      addresses.forEach((a, idx) => {
        const one: EntityNode = { ...e, placements: [a], name: idx === 0 ? e.name : null };
        renderFeature(one, into, labels, idx === 0 ? titleEl : "", idx === 0 ? anchor : undefined);
      });
      return;
    }
    const address = addresses[0];
    const range = e.placements.find((p): p is AddressRange => p.kind === "range");
    if (!address && !range) {
      // A FEATURE'S FOOTPRINT IS CELLS, AND `area` IS REFUSED (#207). It used
      // to fall out here in silence: `pit p : area D4..F6` rendered
      // byte-identical to a document with no pit in it — no mark, no label, no
      // diagnostic — which is the failure this phase spent its length removing,
      // at the placement layer. An author who writes `area` having just written
      // it for terrain three lines above gets a clean render with their
      // oubliette missing, and no way to find out but to notice an absence.
      //
      // Refused rather than drawn, because §2 already gives the footprint as a
      // RANGE and the two forms would then say the same thing two ways. On a
      // REGION map an `area` on a feature is a declared outline (ADR 0026) and
      // means something quite different — which is why this lives here, in the
      // battlemap renderer, rather than in the parser.
      const shape = e.placements.find((p) => p.kind === "shape");
      if (shape) {
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `'${e.typeWord ?? "feature"}' is placed with '${shape.kind === "shape" ? shape.shape : "a shape"}', and a feature's footprint on a battlemap is CELLS — give it a cell (\`F6\`) or a range (\`D4..F6\`). Drawn shapes are terrain's, not a feature's (spec 06 §2)`,
        });
      }
      return;
    }

    // A range placement is a feature's footprint (spec 06 §2): the high table
    // spans G3..I3 — dimensions are declared as placement, like everything else.
    if (!address && range) {
      const r = rangeRect(range);
      const chainR = model.chainOf(e.typeWord);
      const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const footprintParts: string[] = [titleEl];
      if (!e.name && !titleEl && e.typeWord) footprintParts.unshift(svgTitle(e.typeWord));
      // Vocab facet defaults (#64, spec 06 §2): a campfire glows unless told otherwise.
      const light = pairOf(e.pairs, "light") ?? model.facetOf(e.typeWord, "light");
      if (light) {
        const radius = measureToCells(light, model) * CELL;
        const shape = emitterShape(center, radius);
        noteHole("light", emitterHole(shape), { shape, label: e.name ?? e.ids[0] ?? e.typeWord ?? "emitter", measure: light, line: e.line });
        footprintParts.push(emitterPool(center, radius));
      }
      const themed0 = model.theme.glyphFor(chainR, center.x, center.y);
      const glyphless = !themed0 && !["campfire", "torch", "brazier", "lantern", "wagon", "stairs", "ramp"].some((w) => chainR.includes(w));
      const slabFill = glyphless
        ? (model.theme.prop(chainR, "fill") ?? wordTint(chainR[chainR.length - 1] ?? ""))
        : "#8f8474";
      footprintParts.push(
        el("rect", { x: r.x + 3, y: r.y + 3, width: r.w - 6, height: r.h - 6, fill: slabFill, stroke: INK, ...inkStroke(1.2), rx: 2 }),
      );
      const themed = themed0;
      if (themed) {
        const ink = model.theme.surface("ink", "fill", INK);
        const scale = (Math.min(r.w, r.h) / 24) * 0.7;
        footprintParts.push(
          `<path d="${themed}" transform="translate(${fmt(center.x)} ${fmt(center.y)}) scale(${fmt(scale)})" fill="none" stroke="${ink}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`,
        );
      } else {
        // Chain-resolved hand-drawn fallback (#64): a footprint hearth keeps
        // its flame, footprint stairs their treads.
        fallbackGlyph(e, chainR, center, Math.max(1, Math.min(r.w, r.h) / CELL) * 0.8, footprintParts);
      }
      // DIFFICULT IS DRAWN ON A FEATURE TOO (#206). The hatch reached terrain
      // and crossings and never features, so `pit : D4..F6 difficult` — a hole
      // in the floor, which is the whole reason the word carries the state —
      // rendered exactly like a pit you can walk over. Laid OVER the glyph, so
      // a hatched footprint still reads as the thing it is.
      if (e.flags.includes("difficult")) {
        footprintParts.push(el("rect", { x: r.x + 3, y: r.y + 3, width: r.w - 6, height: r.h - 6, fill: "url(#hatch)", rx: 2 }));
      }
      into.push(el("g", { id: anchor }, ...footprintParts));
      if (e.name && !e.flags.includes("nolabel") && labelsOn(model)) {
        const lbl = labelTextFor(model, e) ?? e.name;
        if (!emitOverride(e, lbl, center, labels))
        labels.push(text(lbl, { x: center.x, y: r.y + r.h + 10, "font-size": 8, fill: INK, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
      return;
    }

    const c = cellCenter(address!);
    const parts: string[] = [titleEl];

    // Level connectors (spec 06 §8): any feature with to=<level>.
    const to = pairOf(e.pairs, "to");
    if (to !== undefined && levelCtx) {
      renderConnector(e, model.chainOf(e.typeWord), c, to, parts, into, anchor, e.level);
      return;
    }
    // Vocab facet defaults (#64, spec 06 §2): a campfire glows unless told otherwise.
    const light = pairOf(e.pairs, "light") ?? model.facetOf(e.typeWord, "light");
    if (light) {
      const radius = measureToCells(light, model) * CELL;
      const shape = emitterShape(c, radius);
      noteHole("light", emitterHole(shape), { shape, label: e.name ?? e.ids[0] ?? e.typeWord ?? "emitter", measure: light, line: e.line });
      parts.push(emitterPool(c, radius));
    }
    const chain = model.chainOf(e.typeWord);
    const themedGlyph = model.theme.glyphFor(chain, c.x, c.y);
    let drewFallback = false;
    if (themedGlyph) {
      parts.push(themedGlyphPath(themedGlyph, chain, c));
    } else if (fallbackGlyph(e, chain, c, 1, parts)) {
      drewFallback = true;
    } else {
      // Glyphless words tint deterministically (#71): theme fill wins, else
      // the word-hash — table and barrel stop being the same grey square.
      const fill = model.theme.prop(chain, "fill") ?? wordTint(chain[chain.length - 1] ?? "");
      parts.push(el("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill, stroke: INK, ...inkStroke(1)}));
    }
    // Label conduct (spec 06 §7): at battlemap scale, fallback word-labels are
    // tooltips — visible text is reserved for display names, tokens, and zones.
    if (!e.name && !hasBattlemapGlyph(chain) && !themedGlyph && !drewFallback && !titleEl && e.typeWord) {
      parts.unshift(svgTitle(e.typeWord));
    }
    // A point-placed feature occupies its cell, so `difficult` hatches that
    // cell (#206) — the same mark the terrain beside it uses, so the state
    // reads the same wherever it is declared.
    if (e.flags.includes("difficult")) {
      const o = cellOrigin(address!);
      parts.push(el("rect", { x: o.x, y: o.y, width: CELL, height: CELL, fill: "url(#hatch)" }));
    }
    into.push(el("g", { id: anchor }, ...parts));
    if (e.name && !e.flags.includes("nolabel") && labelsOn(model)) {
      const lbl = labelTextFor(model, e) ?? e.name;
      if (!emitOverride(e, lbl, c, labels))
      labels.push(text(lbl, { x: c.x, y: c.y + 20, "font-size": 8, fill: INK, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
  }
}

function hasOnlyRange(e: EntityNode): boolean {
  return e.placements.length > 0 && e.placements.every((p: Placement) => p.kind === "range");
}

/**
 * The mark that says which state an opening is in (#206).
 *
 * Laid ON the opening rather than beside it, in the opening's own ink and
 * scaled to its own width, so it reads at battle scale and needs no legend:
 *
 * - **locked** — a keyhole: a dot PUNCHED through the leaf, in the paper's
 *   own colour, because a keyhole is a hole. Drawn in the door's ink it is a
 *   brown dot on a brown door and cannot be seen at all — which is how it
 *   first shipped, and why this is checked by eye and not only by a diff.
 * - **barred** — the bar: a line across the opening, set off to one side, which
 *   is how a barred door is drawn and how it works.
 * - **stuck** — the wedge that jammed it, at the midpoint.
 *
 * `ruined` is not here: it dashes and fades the opening itself, which is the
 * convention barriers already use for that word.
 */
function openingStateMarks(
  e: { flags: string[] }, s: { a: XY; b: XY }, stroke: string, width: number, paper: string,
): string[] {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Outward from the opening, on the side the mark sits.
  const nx = -uy;
  const ny = ux;
  const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
  const out: string[] = [];
  if (e.flags.includes("locked")) {
    out.push(el("circle", { cx: mid.x, cy: mid.y, r: Math.max(1.6, width * 0.32), fill: paper }));
  }
  if (e.flags.includes("barred")) {
    const off = width * 0.9;
    const reach = len * 0.42;
    out.push(el("line", {
      x1: mid.x - ux * reach + nx * off, y1: mid.y - uy * reach + ny * off,
      x2: mid.x + ux * reach + nx * off, y2: mid.y + uy * reach + ny * off,
      stroke, ...inkStroke(Math.max(1.2, width * 0.4)), "stroke-linecap": "round",
    }));
  }
  if (e.flags.includes("stuck")) {
    const h = width * 0.85;
    const w = len * 0.16;
    out.push(el("polygon", {
      points: [
        `${fmt(mid.x - ux * w)},${fmt(mid.y - uy * w)}`,
        `${fmt(mid.x + ux * w)},${fmt(mid.y + uy * w)}`,
        `${fmt(mid.x + nx * h)},${fmt(mid.y + ny * h)}`,
      ].join(" "),
      fill: stroke,
    }));
  }
  return out;
}

/**
 * A path's ends reach the edge of their own terminal cells (#145).
 *
 * A path is drawn through cell CENTRES, so its last vertex used to land in the
 * middle of its final square and a road running to something — a gatehouse
 * wall, a shoreline, the map's own edge — visibly stopped halfway through the
 * square it was meant to reach. Fairwater Manor's King's Road was authored
 * around it, ending a cell INSIDE the gatehouse so the two would meet, which
 * put a road's band in a building's interior and said something the author
 * never meant. The document was bent to fit the drawing.
 *
 * The rule is not "add half a cell" but a consequence of what a path already
 * is: **a path occupies whole cells**, which is the model spec 06 §10's lints
 * reason with ("a path is its band and a band is ground", #123/#147). So the
 * drawn band spans its terminal cells rather than stopping at their middles,
 * and a road ending at M13 covers M13.
 *
 * Along the direction of travel, so a diagonal run leaves through the corner
 * rather than being clipped square. This SUBSUMES the frame case it replaces:
 * a terminal cell on the boundary has its outer face ON the frame, so a road
 * running off-map still reaches the edge — and one running ALONG the boundary
 * now extends forward instead of being snapped sideways onto it.
 *
 * The DECLARED spine is left alone: `cells`, crossings and the lints keep
 * reading the cell centres, because this is about where the ink stops and not
 * about what the path covers. Extending those too would have the band's own
 * footprint depend on its stroke width at the ends.
 */
/**
 * The polygon a half-plane inks: the course itself, its ends run out to the
 * frame, closed along the compass side.
 *
 * The ends extend because a half-plane covers the FULL map beyond its frontier
 * — the same reading spec 05 §2 gives it on a region map, where a frostline
 * drawn across the middle still freezes the corners. A course that stops short
 * of the edge is a course, not a shorter claim.
 */
function halfPlaneArea(compass: string, course: XY[], frame: { cols: number; rows: number }): XY[] {
  // Bounded by the GRID, not the canvas: the margin is the coordinate gutter,
  // and terrain drawn into it is terrain on no cell — an ink/coverage
  // disagreement in the one direction the cell rule cannot answer for.
  const left = MARGIN;
  const top = MARGIN;
  const right = MARGIN + frame.cols * CELL;
  const bottom = MARGIN + frame.rows * CELL;
  const clampX = (x: number): number => Math.min(Math.max(x, left), right);
  const clampY = (y: number): number => Math.min(Math.max(y, top), bottom);
  const inside = course.map((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
  const c = compass.toLowerCase();
  const first = inside[0]!;
  const last = inside[inside.length - 1]!;
  if ((c.includes("n") || c.includes("s")) && !c.includes("e") && !c.includes("w")) {
    const edgeY = c.includes("n") ? top : bottom;
    const ltr = first.x <= last.x;
    const x0 = ltr ? left : right;
    const x1 = ltr ? right : left;
    return [{ x: x0, y: first.y }, ...inside, { x: x1, y: last.y }, { x: x1, y: edgeY }, { x: x0, y: edgeY }];
  }
  const edgeX = c.includes("w") ? left : right;
  const ttb = first.y <= last.y;
  const y0 = ttb ? top : bottom;
  const y1 = ttb ? bottom : top;
  return [{ x: first.x, y: y0 }, ...inside, { x: last.x, y: y1 }, { x: edgeX, y: y1 }, { x: edgeX, y: y0 }];
}

/**
 * Push each end of a course out to its terminal cell's face, so the course
 * fills the cell it ends in (#145) rather than stopping at the middle of it.
 *
 * `joinsAtEnd` holds the LAST point back (ADR 0044, #314): a course that meets
 * another does not terminate in a cell of its own, and extending it there sends
 * it through the trunk and out the far side. The first point is unaffected —
 * `from` is always a free end.
 */
function extendToCellEdge(pts: XY[], joinsAtEnd = false): XY[] {
  if (pts.length < 2) return pts;
  const out = pts.map((p) => ({ ...p }));
  const reach = (end: XY, inward: XY): void => {
    const dx = end.x - inward.x;
    const dy = end.y - inward.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const ux = dx / len;
    const uy = dy / len;
    // Where the ray from the cell's centre leaves the cell: the nearer face,
    // which is the corner when the two components are equal.
    const half = CELL / 2;
    const t = Math.min(
      Math.abs(ux) > 1e-9 ? half / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-9 ? half / Math.abs(uy) : Infinity,
    );
    end.x += ux * t;
    end.y += uy * t;
  };
  reach(out[0]!, out[1]!);
  if (!joinsAtEnd) reach(out[out.length - 1]!, out[out.length - 2]!);
  return out;
}
