/**
 * Battlemap renderer (spec 06): square-grid geometry-on-grid — terrain,
 * structures with details, props, tokens, staging zones, lights,
 * emergent-elevation ledges, and the GM/player split.
 */

import type { Address, AddressRange, EntityNode, Placement } from "@chartdown/core";
import { anchorAttr, gmTitleFor, pairOf, type Model } from "./model";
import { GRID_LINE, INK, pathStrokeFor, sideColor, terrainFillFor } from "./theme";
import { colToNumber, el, fmt, measureToNumber, pointsAttr, text, type XY } from "./util";

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

export function renderBattlemap(model: Model, body: string[], frame: Frame): void {
  const layers = {
    terrain: [] as string[], grid: [] as string[], structures: [] as string[],
    features: [] as string[], zones: [] as string[], tokens: [] as string[], labels: [] as string[],
  };

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
      renderTerrain(e, layers.terrain, titleEl, anchor);
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

  body.push(...layers.terrain, ...layers.grid, ...layers.structures, ...layers.zones, ...layers.features, ...layers.tokens, ...layers.labels);

  // ---------- helpers ----------

  function renderTerrain(e: EntityNode, into: string[], titleEl: string, anchor: string | undefined): void {
    const chain = model.chainOf(e.typeWord);
    const fill = terrainFillFor(chain);
    const parts: string[] = [titleEl];
    for (const p of e.placements) {
      if (p.kind === "shape" && p.shape === "area") {
        for (const arg of p.args) {
          if (arg.kind === "range") {
            const r = rangeRect(arg);
            parts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill }));
            if (e.flags.includes("difficult")) parts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
          } else if (arg.kind === "address") {
            const o = cellOrigin(arg);
            parts.push(el("rect", { x: o.x, y: o.y, width: CELL, height: CELL, fill }));
          }
        }
      } else if (p.kind === "shape" && p.shape === "path") {
        const pts = p.args.filter((a): a is Address => a.kind === "address").map(cellCenter);
        const width = Number(pairOf(e.pairs, "width") ?? 1) * CELL * 0.85;
        const stroke = pathStrokeFor(chain);
        parts.push(el("polyline", { points: pointsAttr(pts), fill: "none", stroke: chain.includes("river") ? terrainFillFor(["sea"]) : stroke.stroke, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      } else if (p.kind === "range") {
        const r = rangeRect(p);
        parts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill, opacity: 0.85 }));
        if (e.flags.includes("difficult")) parts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "url(#hatch)" }));
      } else if (p.kind === "address") {
        const o = cellOrigin(p);
        parts.push(el("rect", { x: o.x, y: o.y, width: CELL, height: CELL, fill }));
      }
    }
    into.push(el("g", { id: anchor }, ...parts));
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
      parts.push(el("circle", { cx: c.x, cy: c.y, r: radius, fill: "#ffd98a", opacity: 0.22 }));
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
    const label = e.name ?? (e.archetypeSource !== "vocab" ? e.typeWord : null);
    if (label && !e.flags.includes("nolabel")) {
      labels.push(text(label, { x: c.x, y: c.y + 20, "font-size": 8, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
    }
  }
}

function hasOnlyRange(e: EntityNode): boolean {
  return e.placements.length > 0 && e.placements.every((p: Placement) => p.kind === "range");
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
