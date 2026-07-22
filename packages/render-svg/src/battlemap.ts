/**
 * Battlemap renderer (spec 06): square-grid geometry-on-grid — terrain,
 * structures with details, props, tokens, staging zones, lights,
 * emergent-elevation ledges, and the GM/player split.
 */

import type { Address, AddressRange, Diagnostic, EntityNode, Placement } from "@chartdown/core";
import { CELL, cellCenter, cellOrigin, edgeSegment, MARGIN, measureToCells, mergeEdgeRuns, perimeterEdges, rangeRect, structureCells, type Cell } from "./grid";
import { anchorAttr, gmTitleFor, labelsOn, labelTextFor, pairOf, type Model } from "./model";
import { GRID_LINE, hasBattlemapGlyph, INK, wordTint } from "./theme";
import { colLetters, colToNumber, el, fmt, nearestOnPolyline, pointsAttr, text, visibilityPolygon, type Segment, type XY } from "./util";
import { collectWalls, SIDE_NAME } from "./walls";

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
    const titleEl = title ? el("title", {}, title) : "";
    const elevation = pairOf(e.pairs, "elevation");

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
    // Freestanding barriers (#62): wall/fence edge runs and pillar cells draw
    // here — they always blocked light (walls.ts); now they're visible too.
    if (e.archetype === "barrier") {
      renderBarrier(e, layers.structures, titleEl, anchor);
      continue;
    }
    // Range-only entities: zones for zone/token archetypes, gm triggers, and
    // elevated areas; a range-only FEATURE is a footprint (the high table).
    const zoneLike = e.archetype === "zone" || (hasOnlyRange(e) && (e.archetype === "token" || e.gmOnly || elevation !== undefined));
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

  // Reciprocal landings (spec 06 §8): connectors on other levels targeting
  // this one show their landing here automatically, unless an explicit
  // connector already occupies the cell.
  if (levelCtx) {
    for (const source of levelCtx.allEntities) {
      const to = pairOf(source.pairs, "to");
      if (to !== levelCtx.level || source.level === levelCtx.level) continue;
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
    ...layers.structures, ...layers.openings, ...layers.roomLabels, ...layers.zones, ...layers.features, ...layers.tokens, ...layers.labels,
  );

  // ---------- helpers ----------

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
    const targetIdx = levelCtx.levels.indexOf(to);
    const up = targetIdx !== -1 && targetIdx < currentIdx;
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
    const pathParts: string[] = [];
    for (const p of e.placements) {
      if (p.kind === "shape" && p.shape === "area") {
        for (const arg of p.args) {
          if (arg.kind === "range") {
            const r = rangeRect(arg);
            areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill }));
            if (e.flags.includes("difficult")) areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
            if (e.flags.includes("drop")) areaParts.push(dropEdge(r));
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
    const ruinedSides = new Set(e.details.filter((d) => d.typeWord === "ruined").flatMap((d) => d.flags));
    for (const run of mergeEdgeRuns(perimeterEdges(cells))) {
      const ruined = ruinedSides.has(SIDE_NAME[run.dir]) || ruinedSides.has(run.dir);
      parts.push(el("line", { x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2, stroke: INK, "stroke-width": 3, "stroke-dasharray": ruined ? "5 6" : undefined, opacity: ruined ? 0.7 : 1 }));
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
        if (d.typeWord === "door" || d.typeWord === "gate") {
          layers.openings.push(el("line", { ...seg, stroke: "#a8763e", "stroke-width": 5 }));
        } else if (d.typeWord === "window" || d.typeWord === "arrow-slit") {
          layers.openings.push(el("line", { ...seg, stroke: "#6fa8c9", "stroke-width": 2.5 }));
        } else {
          parts.push(el("line", { ...seg, stroke: INK, "stroke-width": 3 }));
        }
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

  function renderZone(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined, elevation: string | undefined): void {
    const range = e.placements.find((p): p is AddressRange => p.kind === "range");
    if (!range) return;
    const r = rangeRect(range);
    const gmZone = e.gmOnly;
    const stroke = gmZone ? "#b5504a" : elevation ? "#6b5d4a" : "#4a9a6a";
    into.push(
      el("g", { id: anchor, class: elevation ? "ledge" : undefined },
        titleEl,
        el("rect", {
          x: r.x, y: r.y, width: r.w, height: r.h,
          fill: gmZone ? "#b5504a" : elevation ? "#efe6d2" : "#4a9a6a",
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
    if (!e.name && !titleEl && e.typeWord) parts.unshift(el("title", {}, e.typeWord));
    for (const p of e.placements) {
      if (p.kind === "edge") {
        const s = edgeSegment(p.at, p.dir);
        parts.push(
          el("line", {
            x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y,
            stroke: isFence ? "#8a7a5c" : INK,
            "stroke-width": isFence ? 2 : 3,
            "stroke-dasharray": isFence ? "3 3" : ruined ? "5 6" : undefined,
            opacity: ruined ? 0.7 : 1,
            "stroke-linecap": "square",
          }),
        );
      } else if (p.kind === "address") {
        const c = cellCenter(p);
        parts.push(el("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill: "#5a5244", stroke: INK, "stroke-width": 1 }));
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

  function renderFeature(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined): void {
    const address = e.placements.find((p): p is Address => p.kind === "address");
    const range = e.placements.find((p): p is AddressRange => p.kind === "range");
    if (!address && !range) return;

    // A range placement is a feature's footprint (spec 06 §2): the high table
    // spans G3..I3 — dimensions are declared as placement, like everything else.
    if (!address && range) {
      const r = rangeRect(range);
      const chainR = model.chainOf(e.typeWord);
      const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const footprintParts: string[] = [titleEl];
      if (!e.name && !titleEl && e.typeWord) footprintParts.unshift(el("title", {}, e.typeWord));
      // Vocab facet defaults (#64, spec 06 §2): a campfire glows unless told otherwise.
      const light = pairOf(e.pairs, "light") ?? model.facetOf(e.typeWord, "light");
      if (light) {
        const radius = measureToCells(light, model) * CELL;
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
      const ink = model.theme.surface("ink", "fill", INK);
      parts.push(
        `<path d="${themedGlyph}" transform="translate(${fmt(c.x)} ${fmt(c.y)}) scale(0.9)" fill="none" stroke="${ink}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`,
      );
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
      parts.unshift(el("title", {}, e.typeWord));
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
