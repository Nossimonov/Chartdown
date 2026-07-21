/**
 * Battlemap renderer (spec 06): square-grid geometry-on-grid — terrain,
 * structures with details, props, tokens, staging zones, lights,
 * emergent-elevation ledges, and the GM/player split.
 */

import type { Address, AddressRange, Diagnostic, EntityNode, Placement } from "@chartdown/core";
import { anchorAttr, gmTitleFor, pairOf, type Model } from "./model";
import { GRID_LINE, hasBattlemapGlyph, INK, pathStrokeFor, sideColor, terrainFillFor } from "./theme";
import { colToNumber, el, fmt, measureToNumber, nearestOnPolyline, pointsAttr, text, visibilityPolygon, type Segment, type XY } from "./util";

const CELL = 32;
const MARGIN = 24;

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

const cellOrigin = (a: Address): XY => ({
  x: MARGIN + (colToNumber(a.col) - 1) * CELL,
  y: MARGIN + (a.row - 1) * CELL,
});
const cellCenter = (a: Address): XY => {
  const o = cellOrigin(a);
  return { x: o.x + CELL / 2, y: o.y + CELL / 2 };
};
const rangeRect = (r: AddressRange): { x: number; y: number; w: number; h: number } => {
  const a = cellOrigin(r.from);
  const b = cellOrigin(r.to);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x) + CELL, h: Math.abs(b.y - a.y) + CELL };
};

/** Real-world measure → cells, via the scale: header (e.g. light=20ft at 5ft scale = 4 cells). */
function measureToCells(measure: string, model: Model): number {
  const scale = measureToNumber(model.header.get("scale") ?? "5") || 5;
  return measureToNumber(measure) / scale;
}

export function renderBattlemap(model: Model, body: string[], frame: Frame, diagnostics: Diagnostic[]): void {
  const layers = {
    areas: [] as string[], paths: [] as string[], crossings: [] as string[], grid: [] as string[],
    structures: [] as string[], features: [] as string[], zones: [] as string[], tokens: [] as string[], labels: [] as string[],
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
  const sightBlockers: Segment[] = [];
  for (const e of model.entities) {
    if (e.archetype === "structure") {
      const range = e.placements.find((p): p is AddressRange => p.kind === "range");
      if (!range) continue;
      const r = rangeRect(range);
      const ruined = new Set(e.details.filter((d) => d.typeWord === "ruined").flatMap((d) => d.flags));
      const sides: Record<string, Segment> = {
        north: { a: { x: r.x, y: r.y }, b: { x: r.x + r.w, y: r.y } },
        south: { a: { x: r.x, y: r.y + r.h }, b: { x: r.x + r.w, y: r.y + r.h } },
        west: { a: { x: r.x, y: r.y }, b: { x: r.x, y: r.y + r.h } },
        east: { a: { x: r.x + r.w, y: r.y }, b: { x: r.x + r.w, y: r.y + r.h } },
      };
      for (const [side, seg] of Object.entries(sides)) {
        if (!ruined.has(side) && !ruined.has(side[0]!)) sightBlockers.push(seg);
      }
    } else if (e.archetype === "barrier" && !model.chainOf(e.typeWord).includes("fence")) {
      for (const p of e.placements) {
        if (p.kind === "edge") sightBlockers.push(edgeSegment(p.at, p.dir));
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
    const title = gmTitleFor(model, e);
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
    if (e.archetype === "zone" || hasOnlyRange(e)) {
      renderZone(e, layers.zones, layers.labels, titleEl, anchor, elevation);
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
    layers.grid.push(el("line", { x1: x, y1: MARGIN, x2: x, y2: MARGIN + f.rows * CELL, stroke: GRID_LINE, "stroke-width": 0.6 }));
  }
  for (let r = 0; r <= f.rows; r++) {
    const y = MARGIN + r * CELL;
    layers.grid.push(el("line", { x1: MARGIN, y1: y, x2: MARGIN + f.cols * CELL, y2: y, stroke: GRID_LINE, "stroke-width": 0.6 }));
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

  body.push(
    ...layers.areas, ...layers.paths, ...layers.crossings, ...layers.grid,
    ...layers.structures, ...layers.zones, ...layers.features, ...layers.tokens, ...layers.labels,
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
    const atCell = e.placements.find(
      (p): p is Extract<Placement, { kind: "relational"; form: "at" }> => p.kind === "relational" && p.form === "at",
    )?.target;

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
    const fill = terrainFillFor(chain);
    const areaParts: string[] = [];
    const pathParts: string[] = [];
    for (const p of e.placements) {
      if (p.kind === "shape" && p.shape === "area") {
        for (const arg of p.args) {
          if (arg.kind === "range") {
            const r = rangeRect(arg);
            areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill }));
            if (e.flags.includes("difficult")) areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
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
        const stroke = pathStrokeFor(chain);
        pathParts.push(el("polyline", { points: pointsAttr(pts), fill: "none", stroke: chain.includes("river") ? terrainFillFor(["sea"]) : stroke.stroke, "stroke-width": width, "stroke-linecap": "butt", "stroke-linejoin": "round" }));
        pathRecords.push({ e, cells: cellsAlong(pts), isWater: chain.includes("river"), isRoad: chain.includes("road"), pts, width });
      } else if (p.kind === "range") {
        const r = rangeRect(p);
        areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill, opacity: 0.85 }));
        if (e.flags.includes("difficult")) areaParts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
      } else if (p.kind === "address") {
        const o = cellOrigin(p);
        areaParts.push(el("rect", { x: o.x, y: o.y, width: CELL, height: CELL, fill }));
      }
    }
    if (areaParts.length > 0) layers.areas.push(el("g", { id: pathParts.length === 0 ? anchor : undefined }, titleEl, ...areaParts));
    if (pathParts.length > 0) layers.paths.push(el("g", { id: anchor }, titleEl, ...pathParts));
  }

  function renderStructure(e: EntityNode, into: string[], titleEl: string, anchor: string | undefined): void {
    const range = e.placements.find((p): p is AddressRange => p.kind === "range");
    if (!range) return;
    const r = rangeRect(range);
    const parts: string[] = [titleEl, el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "#efe9da", opacity: 0.8 })];

    const ruinedSides = new Set(e.details.filter((d) => d.typeWord === "ruined").flatMap((d) => d.flags));
    const sides: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {
      north: { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y },
      south: { x1: r.x, y1: r.y + r.h, x2: r.x + r.w, y2: r.y + r.h },
      west: { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h },
      east: { x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h },
    };
    for (const [side, seg] of Object.entries(sides)) {
      const ruined = ruinedSides.has(side) || ruinedSides.has(side[0]!);
      parts.push(el("line", { ...seg, stroke: INK, "stroke-width": 3, "stroke-dasharray": ruined ? "5 6" : undefined, opacity: ruined ? 0.7 : 1 }));
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
        if (d.typeWord === "door" || d.typeWord === "gate") {
          parts.push(el("line", { ...seg, stroke: "#a8763e", "stroke-width": 5 }));
        } else if (d.typeWord === "window" || d.typeWord === "arrow-slit") {
          parts.push(el("line", { ...seg, stroke: "#6fa8c9", "stroke-width": 2.5 }));
        } else {
          parts.push(el("line", { ...seg, stroke: INK, "stroke-width": 3 }));
        }
      }
    }
    into.push(el("g", { id: anchor }, ...parts));
    if (e.name && !e.flags.includes("nolabel")) {
      layers.labels.push(text(e.name, { x: r.x + r.w / 2, y: r.y - 5, "font-size": 10, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
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
    if (label && !e.flags.includes("nolabel")) {
      labels.push(text(elevation ? `${label} (${elevation})` : label, { x: r.x + r.w / 2, y: r.y + 12, "font-size": 9, fill: stroke, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
  }

  function renderToken(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined): void {
    const size = Number(pairOf(e.pairs, "size") ?? 1) || 1;
    const fill = sideColor(pairOf(e.pairs, "side"));
    const addresses = e.placements.filter((p): p is Address => p.kind === "address");
    addresses.forEach((a, idx) => {
      const base = cellCenter(a);
      const center = { x: base.x + ((size - 1) * CELL) / 2, y: base.y + ((size - 1) * CELL) / 2 };
      const radius = 0.38 * CELL * size;
      const label = addresses.length > 1 ? (e.ids[idx] ?? `${e.typeWord}${idx + 1}`) : (e.name ?? e.ids[0] ?? e.typeWord ?? "?");
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
      if (!e.flags.includes("nolabel")) {
        labels.push(text(label, { x: center.x, y: center.y + radius + 10, "font-size": 9, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
    });
  }

  function renderFeature(e: EntityNode, into: string[], labels: string[], titleEl: string, anchor: string | undefined): void {
    const address = e.placements.find((p): p is Address => p.kind === "address");
    if (!address) return;
    const c = cellCenter(address);
    const parts: string[] = [titleEl];
    const light = pairOf(e.pairs, "light");
    if (light) {
      const radius = measureToCells(light, model) * CELL;
      if (sightBlockers.length > 0) {
        const poly = visibilityPolygon(c, radius, sightBlockers);
        parts.push(el("polygon", { points: pointsAttr(poly), fill: "#ffd98a", opacity: 0.22 }));
      } else {
        parts.push(el("circle", { cx: c.x, cy: c.y, r: radius, fill: "#ffd98a", opacity: 0.22 }));
      }
    }
    const word = e.typeWord ?? "";
    if (word === "campfire" || word === "torch" || word === "brazier" || word === "lantern") {
      parts.push(el("circle", { cx: c.x, cy: c.y, r: 5, fill: "#d9822b", stroke: "#a8541e", "stroke-width": 1.5 }));
    } else if (word === "wagon") {
      const facing = pairOf(e.pairs, "facing");
      const rot = facing === "south" || facing === "north" ? 90 : 0;
      parts.push(
        el("rect", {
          x: c.x - CELL * 0.45, y: c.y - CELL * 0.28, width: CELL * 0.9, height: CELL * 0.56,
          fill: "#a8763e", stroke: INK, "stroke-width": 1.5,
          "stroke-dasharray": e.flags.includes("overturned") ? "4 3" : undefined,
          transform: rot ? `rotate(${rot} ${fmt(c.x)} ${fmt(c.y)})` : undefined,
        }),
      );
    } else {
      parts.push(el("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill: "#8f8474", stroke: INK, "stroke-width": 1 }));
    }
    into.push(el("g", { id: anchor }, ...parts));
    // Fallback-chain terminal (spec 04 §4): generic glyphs carry their word.
    const chain2 = model.chainOf(e.typeWord);
    const label = e.name ?? (hasBattlemapGlyph(chain2) ? null : e.typeWord);
    if (label && !e.flags.includes("nolabel")) {
      labels.push(text(label, { x: c.x, y: c.y + 20, "font-size": 8, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
  }
}

function hasOnlyRange(e: EntityNode): boolean {
  return e.placements.length > 0 && e.placements.every((p: Placement) => p.kind === "range");
}

function edgeSegment(at: Address, dir: string): Segment {
  const o = cellOrigin(at);
  switch (dir) {
    case "n": return { a: { x: o.x, y: o.y }, b: { x: o.x + CELL, y: o.y } };
    case "s": return { a: { x: o.x, y: o.y + CELL }, b: { x: o.x + CELL, y: o.y + CELL } };
    case "w": return { a: { x: o.x, y: o.y }, b: { x: o.x, y: o.y + CELL } };
    default: return { a: { x: o.x + CELL, y: o.y }, b: { x: o.x + CELL, y: o.y + CELL } };
  }
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

function colLetters(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
