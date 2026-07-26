/**
 * Battlemap renderer (spec 06): square-grid geometry-on-grid — terrain,
 * structures with details, props, tokens, staging zones, lights,
 * emergent-elevation ledges, and the GM/player split.
 */

import type { Address, AddressRange, Diagnostic, EntityNode, Placement } from "@chartdown/core";
import { CELL, cellCenter, cellOrigin, edgeSegment, MARGIN, measureToCells, mergeEdgeRuns, perimeterEdges, rangeRect, segKey, structureCells, type Cell } from "./grid";
import { anchorAttr, gmTitleFor, labelsOn, labelTextFor, pairOf, type Model } from "./model";
import { GRID_LINE, hasBattlemapGlyph, INK, wordTint } from "./theme";
import { colLetters, colToNumber, el, esc as escapeText, fmt, nearestOnPolyline, pointsAttr, svgTitle, text, visibilityPolygon, type Segment, type XY } from "./util";
import { coherenceLints } from "./lints";
import { barrierSides, collectWalls, impassableCells, SIDE_NAME } from "./walls";

interface Frame {
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

export interface LevelContext {
  level: string;
  allEntities: EntityNode[];
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
  const noteHole = (field: string, shape: string): void => {
    const list = fieldHoles.get(field) ?? [];
    list.push(shape);
    fieldHoles.set(field, list);
  };
  let noteCourseCount = 0;
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
  const crossingCells = new Set<string>();
  interface PendingCrossing {
    e: EntityNode;
    chain: string[];
    titleEl: string;
    anchor: string | undefined;
  }
  // Crossings render after the full pass so the paths they restyle are known.
  const pendingCrossings: PendingCrossing[] = [];

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
    layers.grid.push(el("line", { x1: x, y1: MARGIN, x2: x, y2: MARGIN + f.rows * CELL, stroke: model.theme.surface("grid", "stroke", GRID_LINE), "stroke-width": 0.6 }));
  }
  for (let r = 0; r <= f.rows; r++) {
    const y = MARGIN + r * CELL;
    layers.grid.push(el("line", { x1: MARGIN, y1: y, x2: MARGIN + f.cols * CELL, y2: y, stroke: model.theme.surface("grid", "stroke", GRID_LINE), "stroke-width": 0.6 }));
  }
  if (model.header.get("numbers") === "on") {
    for (let c = 1; c <= f.cols; c++) {
      layers.grid.push(text(colLetters(c), { x: MARGIN + (c - 0.5) * CELL, y: MARGIN - 7, "font-size": 9, fill: "#8a8272", "text-anchor": "middle", "font-family": "sans-serif" }));
    }
    for (let r = 1; r <= f.rows; r++) {
      layers.grid.push(text(String(r), { x: MARGIN - 7, y: MARGIN + (r - 0.5) * CELL + 3, "font-size": 9, fill: "#8a8272", "text-anchor": "end", "font-family": "sans-serif" }));
    }
  }

  for (const pending of pendingCrossings) renderCrossing(pending);

  // Coherence lints (#123): things a document can say that no rule forbids and
  // no reader would mean. Warnings only, and reachable from `check` because a
  // map is rendered there (#120) — a lint nobody runs is a lint nobody has.
  coherenceLints(model, levelCtx?.level ?? model.doc.defaultLevel, diagnostics, levelCtx);

  // Reciprocal landings (spec 06 §8): connectors on other levels targeting
  // this one show their landing here automatically, unless an explicit
  // connector already occupies the cell.
  if (levelCtx) {
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
      const occupied = model.entities.some(
        (e) => pairOf(e.pairs, "to") !== undefined &&
          e.placements.some((p) => p.kind === "address" && p.col === landing.col && p.row === landing.row),
      );
      if (occupied) continue;
      const c = cellCenter(landing);
      renderConnector(source, model.chainOf(source.typeWord), c, source.level, [], layers.features, undefined);
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
   * A hole in the ambient wash for one emitter. Occlusion follows the field's
   * `occluded=` facet (spec 04 §5): `sight` (light's default) traces against
   * sight blockers, `none` fills through matter — an antimagic zone or a
   * radiation hazard is not stopped by a wall.
   */
  function emitterHole(at: XY, radius: number): string {
    const occluded = model.facetOf("light", "occluded") ?? "sight";
    if (occluded !== "none" && sightBlockers.length > 0) {
      return el("polygon", { points: pointsAttr(visibilityPolygon(at, radius, sightBlockers)), fill: "#000" });
    }
    return el("circle", { cx: at.x, cy: at.y, r: radius, fill: "#000" });
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
      const opacity = model.theme.prop(model.chainOf(field), "opacity", { state: value }) ?? "0.82";
      const holes = fieldHoles.get(field) ?? [];
      const id = `cdfield-${model.doc.docId}-${field}${levelCtx?.level ? `-${levelCtx.level}` : ""}`;
      out.push(
        `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(frame.w)}" height="${fmt(frame.h)}">` +
          el("rect", { x: 0, y: 0, width: frame.w, height: frame.h, fill: "#fff" }) +
          holes.join("") +
          `</mask></defs>` +
          el("rect", { x: 0, y: 0, width: frame.w, height: frame.h, fill, opacity, mask: `url(#${id})` }),
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
      if (isBridge) {
        scope.push(band("#6b4a26", hostRec.width + 6));
        scope.push(band("#a8763e", hostRec.width));
      } else {
        scope.push(band("#c2d4dc", hostRec.width));
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
      el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke: ink, "stroke-width": 2, class: "drop" }),
    ];
    const tick = 4;
    for (let x = r.x + 5; x < r.x + r.w; x += 9) {
      parts.push(el("line", { x1: x, y1: r.y, x2: x - 2, y2: r.y - tick, stroke: ink, "stroke-width": 1.2 }));
      parts.push(el("line", { x1: x, y1: r.y + r.h, x2: x - 2, y2: r.y + r.h + tick, stroke: ink, "stroke-width": 1.2 }));
    }
    for (let y = r.y + 5; y < r.y + r.h; y += 9) {
      parts.push(el("line", { x1: r.x, y1: y, x2: r.x - tick, y2: y - 2, stroke: ink, "stroke-width": 1.2 }));
      parts.push(el("line", { x1: r.x + r.w, y1: y, x2: r.x + r.w + tick, y2: y - 2, stroke: ink, "stroke-width": 1.2 }));
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
        fill: "none", stroke: ink, "stroke-width": 1.6,
      }),
      el("line", { x1: c.x - half, y1: c.y - half, x2: c.x + half, y2: c.y + half, stroke: ink, "stroke-width": 1 }),
      el("line", { x1: c.x + half, y1: c.y - half, x2: c.x - half, y2: c.y + half, stroke: ink, "stroke-width": 1 }),
    );
  }

  /**
   * The levels a `to=`/`through=` value covers (#112). A single name is a
   * one-level span; `a..b` is every declared level between them inclusive, in
   * the document's own physical order — so an author need not know which end
   * they wrote first.
   */
  function levelSpan(levels: string[], value: string): string[] {
    const [a, b] = value.split("..");
    if (b === undefined) return levels.includes(a!) ? [a!] : [];
    const i = levels.indexOf(a!);
    const j = levels.indexOf(b!);
    if (i === -1 || j === -1) return [];
    return levels.slice(Math.min(i, j), Math.max(i, j) + 1);
  }

  /** The nearest landing in the span other than the level being drawn. */
  function nextLandingIndex(levels: string[], span: string[], from: number): number {
    let best = -1;
    for (const name of span) {
      const idx = levels.indexOf(name);
      if (idx === -1 || idx === from) continue;
      if (best === -1 || Math.abs(idx - from) < Math.abs(best - from)) best = idx;
    }
    return best;
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
  ): void {
    if (!levelCtx) return;
    const currentIdx = levelCtx.levels.indexOf(levelCtx.level);
    // With a level RANGE (#112) the destination shown is the next landing in
    // the direction of travel, not the far end of the flight: standing on the
    // Third Level of one long stair, what matters is that the next landing
    // down is the First. Naming the bottom of the whole run would misreport
    // the step the party is about to take.
    const span = levelSpan(levelCtx.levels, to);
    const targetIdx = span.length > 1
      ? nextLandingIndex(levelCtx.levels, span, currentIdx)
      : levelCtx.levels.indexOf(to);
    const up = targetIdx !== -1 && targetIdx < currentIdx;
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
        parts.push(el("line", { x1: c.x - half, y1: y, x2: c.x + half, y2: y, stroke: ink, "stroke-width": 2.2 }));
      }
    }
    parts.push(
      text(`${up ? "▲" : "▼"} ${to}`, {
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
    const areaParts: string[] = [];
    // One fall annotation per entity, not one per range in its footprint.
    let fellAnnotated = false;
    const pathParts: string[] = [];
    for (const p of e.placements) {
      if (p.kind === "shape" && p.shape === "area") {
        for (const arg of p.args) {
          if (arg.kind === "range") {
            const r = rangeRect(arg);
            areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill }));
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
            areaParts.push(el("rect", { x: o.x, y: o.y, width: CELL, height: CELL, fill }));
          }
        }
      } else if (p.kind === "shape" && p.shape === "path") {
        const addresses = p.args.filter((a): a is Address => a.kind === "address");
        const pts = addresses.map(cellCenter);
        extendToFrame(pts, addresses, frame);
        const width = Number(pairOf(e.pairs, "width") ?? 1) * CELL * 0.85;
        const stroke = model.theme.pathStroke(chain);
        pathParts.push(el("polyline", { points: pointsAttr(pts), fill: "none", stroke: chain.includes("river") ? model.theme.terrainFill(["sea"]) : stroke.stroke, "stroke-width": width, "stroke-linecap": "butt", "stroke-linejoin": "round" }));
        pathRecords.push({ e, cells: cellsAlong(pts), isWater: chain.includes("river"), isRoad: chain.includes("road"), pts, width });
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
    if (areaParts.length > 0) layers.areas.push(el("g", { id: pathParts.length === 0 ? anchor : undefined }, titleEl, ...areaParts));
    if (pathParts.length > 0) layers.paths.push(el("g", { id: anchor }, titleEl, ...pathParts));
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
            stroke, "stroke-width": width, "stroke-dasharray": dash,
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
          "stroke-width": wallWidth,
          "stroke-dasharray": ruined ? (ruinedDash ?? "5 6") : (model.theme.prop(structChain, "dash", wallCtx)?.replace(",", " ")),
          opacity: ruined ? 0.7 : 1,
        }),
      );
    }
    for (const d of e.details) {
      for (const p of d.placements) {
        if (p.kind !== "edge") continue;
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
        if (model.archetypeOf(d.typeWord) !== "opening") {
          parts.push(el("line", { ...seg, stroke: model.theme.prop(openingChain, "stroke") ?? INK, "stroke-width": 3 }));
          continue;
        }
        const windowLike = openingChain.includes("window") || openingChain.includes("arrow-slit");
        const stroke = model.theme.prop(openingChain, "stroke") ?? (windowLike ? "#6fa8c9" : "#a8763e");
        const width = Number(model.theme.prop(openingChain, "width") ?? (windowLike ? 2.5 : 5)) || (windowLike ? 2.5 : 5);
        layers.openings.push(el("line", { ...seg, stroke, "stroke-width": width }));
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
      parts.push(el("line", { x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, stroke, "stroke-width": width }));
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
            `<text font-size="9" fill="${INK}" text-anchor="middle" font-family="sans-serif">` +
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
          fill: INK, "text-anchor": "middle", "font-family": "sans-serif",
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
        el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke, "stroke-width": elevation ? 3.5 : 1.5, "stroke-dasharray": elevation ? undefined : "6 4" }),
      ),
    );
    const label = e.name ?? e.ids[0] ?? e.typeWord;
    if (label && !e.flags.includes("nolabel") && labelsOn(model)) {
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
            "stroke-width": Number(themedWidth ?? (isFence ? 2 : 3)) || (isFence ? 2 : 3),
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
          parts.push(el("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill, stroke: INK, "stroke-width": 1 }));
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
      parts.push(el("circle", { cx: c.x, cy: c.y + 1.5 * scale, r: 6 * scale, fill: "#d9822b", stroke: "#a8541e", "stroke-width": 1.5 }));
      parts.push(
        el("path", {
          d: `M${fmt(c.x - 3 * scale)} ${fmt(c.y - 3 * scale)} Q${fmt(c.x - 1 * scale)} ${fmt(c.y - 9 * scale)} ${fmt(c.x + 1 * scale)} ${fmt(c.y - 5 * scale)} Q${fmt(c.x + 2.5 * scale)} ${fmt(c.y - 8 * scale)} ${fmt(c.x + 3.5 * scale)} ${fmt(c.y - 3.5 * scale)}`,
          fill: "none", stroke: "#a8541e", "stroke-width": 1.5, "stroke-linecap": "round",
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
          fill: "#a8763e", stroke: INK, "stroke-width": 1.5,
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
        stair.push(el("line", { x1: c.x - w * scale, y1: y, x2: c.x + w * scale, y2: y, stroke: INK, "stroke-width": 2.2 }));
      }
      stair.push(
        el("path", {
          d: `M${fmt(c.x - 3 * scale)} ${fmt(c.y - 9 * scale)} L${fmt(c.x)} ${fmt(c.y - 13 * scale)} L${fmt(c.x + 3 * scale)} ${fmt(c.y - 9 * scale)}`,
          fill: "none", stroke: INK, "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round",
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
            "stroke-width": 1.5,
            "stroke-dasharray": e.flags.includes("hidden") ? "3 3" : undefined,
          }),
        ),
      );
      if (!e.flags.includes("nolabel") && labelsOn(model)) {
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
    if (!address && !range) return;

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
        noteHole("light", emitterHole(center, radius));
        footprintParts.push(
          sightBlockers.length > 0
            ? el("polygon", { points: pointsAttr(visibilityPolygon(center, radius, sightBlockers)), fill: model.theme.surface("light", "fill", "#ffd98a"), opacity: 0.22 })
            : el("circle", { cx: center.x, cy: center.y, r: radius, fill: model.theme.surface("light", "fill", "#ffd98a"), opacity: 0.22 }),
        );
      }
      const themed0 = model.theme.glyphFor(chainR, center.x, center.y);
      const glyphless = !themed0 && !["campfire", "torch", "brazier", "lantern", "wagon", "stairs", "ramp"].some((w) => chainR.includes(w));
      const slabFill = glyphless
        ? (model.theme.prop(chainR, "fill") ?? wordTint(chainR[chainR.length - 1] ?? ""))
        : "#8f8474";
      footprintParts.push(
        el("rect", { x: r.x + 3, y: r.y + 3, width: r.w - 6, height: r.h - 6, fill: slabFill, stroke: INK, "stroke-width": 1.2, rx: 2 }),
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
      into.push(el("g", { id: anchor }, ...footprintParts));
      if (e.name && !e.flags.includes("nolabel") && labelsOn(model)) {
        const lbl = labelTextFor(model, e) ?? e.name;
        labels.push(text(lbl, { x: center.x, y: r.y + r.h + 10, "font-size": 8, fill: INK, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
      return;
    }

    const c = cellCenter(address!);
    const parts: string[] = [titleEl];

    // Level connectors (spec 06 §8): any feature with to=<level>.
    const to = pairOf(e.pairs, "to");
    if (to !== undefined && levelCtx) {
      renderConnector(e, model.chainOf(e.typeWord), c, to, parts, into, anchor);
      return;
    }
    // Vocab facet defaults (#64, spec 06 §2): a campfire glows unless told otherwise.
    const light = pairOf(e.pairs, "light") ?? model.facetOf(e.typeWord, "light");
    if (light) {
      const radius = measureToCells(light, model) * CELL;
      noteHole("light", emitterHole(c, radius));
      if (sightBlockers.length > 0) {
        const poly = visibilityPolygon(c, radius, sightBlockers);
        parts.push(el("polygon", { points: pointsAttr(poly), fill: model.theme.surface("light", "fill", "#ffd98a"), opacity: 0.22 }));
      } else {
        parts.push(el("circle", { cx: c.x, cy: c.y, r: radius, fill: model.theme.surface("light", "fill", "#ffd98a"), opacity: 0.22 }));
      }
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
      parts.push(el("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill, stroke: INK, "stroke-width": 1 }));
    }
    // Label conduct (spec 06 §7): at battlemap scale, fallback word-labels are
    // tooltips — visible text is reserved for display names, tokens, and zones.
    if (!e.name && !hasBattlemapGlyph(chain) && !themedGlyph && !drewFallback && !titleEl && e.typeWord) {
      parts.unshift(svgTitle(e.typeWord));
    }
    into.push(el("g", { id: anchor }, ...parts));
    if (e.name && !e.flags.includes("nolabel") && labelsOn(model)) {
      const lbl = labelTextFor(model, e) ?? e.name;
      labels.push(text(lbl, { x: c.x, y: c.y + 20, "font-size": 8, fill: INK, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
  }
}

function hasOnlyRange(e: EntityNode): boolean {
  return e.placements.length > 0 && e.placements.every((p: Placement) => p.kind === "range");
}

/**
 * Paths whose terminal cells touch the map boundary extend to the frame edge,
 * so a road that runs off-map reads as continuing rather than stopping short.
 */
function extendToFrame(pts: XY[], addresses: Address[], frame: Frame): void {
  if (pts.length < 2 || addresses.length < 2) return;
  const fix = (index: 0 | -1): void => {
    const address = index === 0 ? addresses[0]! : addresses[addresses.length - 1]!;
    const point = index === 0 ? pts[0]! : pts[pts.length - 1]!;
    const col = colToNumber(address.col);
    if (address.row === 1) point.y = MARGIN;
    else if (address.row === frame.rows) point.y = MARGIN + frame.rows * CELL;
    else if (col === 1) point.x = MARGIN;
    else if (col === frame.cols) point.x = MARGIN + frame.cols * CELL;
  };
  fix(0);
  fix(-1);
}
