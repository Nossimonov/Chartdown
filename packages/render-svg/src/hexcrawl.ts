/**
 * Hexcrawl renderer (spec 05 §3): pointy/flat hexes with offset parity,
 * the cell-content model (fog for unmentioned hexes, `seen`/`unexplored`
 * states), routes through hex centers, and derived region boundaries.
 */

import type { Address, AddressRange, EntityNode, HexLineNode } from "@chartdown/core";
import { slugify } from "@chartdown/core";
import { LabelPlacer } from "./labels";
import { gmTitleFor, labelsOn, labelTextFor, pairOf, type Model } from "./model";
import { FOG, GRID_LINE, INK, tierOf } from "./theme";
import { colToNumber, el, fmt, pointsAttr, text, type XY } from "./util";

const R = 24;
const MARGIN = 30;

interface HexFrame {
  cols: number;
  rows: number;
  w: number;
  h: number;
}

const hexW = Math.sqrt(3) * R;

export function hexFrame(model: Model): HexFrame {
  const cols = model.doc.grid?.cols ?? 8;
  const rows = model.doc.grid?.rows ?? 8;
  return { cols, rows, w: MARGIN * 2 + cols * hexW + hexW / 2, h: MARGIN * 2 + (rows - 1) * 1.5 * R + 2 * R };
}

interface HexCell {
  terrain: string;
  contents: string[];
  name: string | null;
  flags: string[];
  gm: string | undefined;
}

const keyOf = (col: number, row: number): string => `${col}:${row}`;

function shifted(row: number, parity: string): boolean {
  const idx = parity.startsWith("odd") ? (row - 1) % 2 === 1 : (row - 1) % 2 === 0;
  return idx;
}

export function renderHexcrawl(model: Model, body: string[]): void {
  const grid = model.doc.grid;
  const parity = grid?.parity ?? "odd-row";
  const cols = grid?.cols ?? 8;
  const rows = grid?.rows ?? 8;

  const center = (col: number, row: number): XY => ({
    x: MARGIN + (col - 1) * hexW + hexW / 2 + (shifted(row, parity) ? hexW / 2 : 0),
    y: MARGIN + (row - 1) * 1.5 * R + R,
  });

  const corners = (c: XY): XY[] => {
    const pts: XY[] = [];
    for (let k = 0; k < 6; k++) {
      const angle = ((60 * k - 30) * Math.PI) / 180;
      pts.push({ x: c.x + R * Math.cos(angle), y: c.y + R * Math.sin(angle) });
    }
    return pts;
  };

  // Expand hex lines into a cell map.
  const cells = new Map<string, HexCell>();
  const expand = (a: Address | AddressRange): { col: number; row: number }[] => {
    if (a.kind === "address") return [{ col: colToNumber(a.col), row: a.row }];
    const c1 = colToNumber(a.from.col);
    const c2 = colToNumber(a.to.col);
    const out: { col: number; row: number }[] = [];
    for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) {
      for (let row = Math.min(a.from.row, a.to.row); row <= Math.max(a.from.row, a.to.row); row++) {
        out.push({ col, row });
      }
    }
    return out;
  };
  for (const line of model.hexLines) {
    for (const addr of line.addresses) {
      for (const { col, row } of expand(addr)) {
        cells.set(keyOf(col, row), {
          terrain: line.terrain,
          contents: line.contents,
          name: line.name,
          flags: line.flags,
          gm: pairOf(line.pairs, "gm"),
        });
      }
    }
  }
  // Grouped form: entities in [hexes] with address placements.
  for (const e of model.entities) {
    if (e.section !== "hexes" || !e.typeWord) continue;
    for (const p of e.placements) {
      if (p.kind === "address" || p.kind === "range") {
        for (const { col, row } of expand(p)) {
          cells.set(keyOf(col, row), { terrain: e.typeWord, contents: [], name: e.name, flags: e.flags, gm: pairOf(e.pairs, "gm") });
        }
      }
    }
  }

  const hexLayer: string[] = [];
  const contentLayer: string[] = [];
  const labelLayer: string[] = [];
  const numbersOn = model.header.get("numbers") === "on";
  const gmMode = model.mode === "gm";
  const placer = new LabelPlacer();

  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const c = center(col, row);
      const poly = pointsAttr(corners(c));
      const cell = cells.get(keyOf(col, row));
      const foggedForPlayer = !gmMode && (!cell || cell.flags.includes("unexplored"));
      const fogged = !cell || foggedForPlayer;
      const seen = !gmMode && !!cell && cell.flags.includes("seen");

      const fill = fogged ? model.theme.surface("fog", "fill", FOG) : model.theme.terrainFill(model.chainOf(cell!.terrain));
      const parts: string[] = [];
      if (gmMode && cell?.gm) parts.push(el("title", {}, cell.gm));
      parts.push(el("polygon", { points: poly, fill, stroke: GRID_LINE, "stroke-width": 1 }));

      if (!fogged && cell) {
        if (seen) {
          contentLayer.push(text("?", { x: c.x, y: c.y + 4, "font-size": 11, fill: "#8a8272", "text-anchor": "middle", "font-family": "sans-serif" }));
        } else {
          cell.contents.forEach((word, idx) => {
            const at = { x: c.x, y: c.y - 3 + idx * 9 };
            placer.block(at.x - 5, at.y - 5, 10, 10);
            contentLayer.push(glyph(word, at));
          });
          if (cell.name && labelsOn(model)) {
            const lbl = labelTextFor(model, cell) ?? cell.name;
            const anchorId = `cd-${model.doc.docId}-${slugify(cell.name)}`;
            const y = placer.place(c.x, c.y + R * 0.62, lbl, 7.5, "middle");
            labelLayer.push(
              el("g", { id: anchorId },
                text(lbl, { x: c.x, y, "font-size": 7.5, fill: INK, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }),
              ),
            );
          }
          if (gmMode && cell.gm) {
            contentLayer.push(el("circle", { cx: c.x + R * 0.55, cy: c.y - R * 0.55, r: 3, fill: "#b5504a" }));
          }
        }
      }
      if (numbersOn && !fogged) {
        // Top-left corner, small and faint — clear of content glyphs and names.
        labelLayer.push(text(`${colLetters(col)}${row}`, { x: c.x - hexW * 0.26, y: c.y - R * 0.45, "font-size": 6, fill: "#8a8272", opacity: 0.75, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
      hexLayer.push(el("g", {}, ...parts));
    }
  }

  // Routes and regions
  const routeLayer: string[] = [];
  const regionLayer: string[] = [];
  for (const e of model.entities) {
    if (e.section === "routes") {
      const addresses = e.placements.filter((p): p is Address => p.kind === "address");
      const pts = addresses.map((a) => center(colToNumber(a.col), a.row));
      if (pts.length < 2) continue;
      const chain = model.chainOf(e.typeWord);
      // A route ending in a water hex stops at that hex's edge — a river
      // discharges at the coast; it doesn't run to the middle of the sea.
      const isWaterHex = (a: Address): boolean => {
        const cell = cells.get(keyOf(colToNumber(a.col), a.row));
        const terrainChain = cell ? model.chainOf(cell.terrain) : [];
        return terrainChain.some((word) => word === "sea" || word === "lake" || word === "water");
      };
      if (isWaterHex(addresses[0]!)) {
        pts[0] = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
      }
      if (isWaterHex(addresses[addresses.length - 1]!)) {
        const n = pts.length;
        pts[n - 1] = { x: (pts[n - 1]!.x + pts[n - 2]!.x) / 2, y: (pts[n - 1]!.y + pts[n - 2]!.y) / 2 };
      }
      const stroke = model.theme.pathStroke(chain);
      const title = gmTitleFor(model, e);
      routeLayer.push(
        el("g", { id: e.name ? `cd-${model.doc.docId}-${slugify(e.name)}` : undefined },
          title ? el("title", {}, title) : "",
          el("polyline", { points: pointsAttr(pts), fill: "none", stroke: stroke.stroke, "stroke-width": chain.includes("river") ? 4 : 3, "stroke-dasharray": stroke.dash ?? (chain.includes("road") ? "8 4" : undefined), "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.85 }),
        ),
      );
      if (e.name && labelsOn(model)) {
        // Mid-course labeling names the whole line, not an endpoint — measured
        // by arc length of the RENDERED course (after coast clipping), not by
        // point index, which lands near the terminus on clipped rivers. When
        // mid-course is crowded, slide ALONG the course rather than off it.
        const candidates = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74].map((t) => {
          const p = arcPoint(pts, t);
          return { x: p.x, y: p.y - R * 0.55 };
        });
        const lbl = labelTextFor(model, e) ?? e.name;
        const at = placer.placeAlong(candidates, lbl, 8, "middle");
        labelLayer.push(text(lbl, { x: at.x, y: at.y, "font-size": 8, fill: INK, opacity: 0.8, "font-style": "italic", "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
      continue;
    }
    if (e.section === "regions") {
      const set = new Set<string>();
      for (const p of e.placements) {
        if (p.kind === "address" || p.kind === "range") for (const { col, row } of expand(p)) set.add(keyOf(col, row));
      }
      const edges: string[] = [];
      for (const key of set) {
        const [col, row] = key.split(":").map(Number) as [number, number];
        const c = center(col, row);
        const cs = corners(c);
        const neighborDirs = neighborDeltas(shifted(row, parity));
        // Corners start at -30°: corner pair (k,k+1) faces E,SE,SW,W,NW,NE in order.
        const faceOrder: (keyof typeof neighborDirs)[] = ["e", "se", "sw", "w", "nw", "ne"];
        faceOrder.forEach((face, k) => {
          const d = neighborDirs[face]!;
          if (!set.has(keyOf(col + d.x, row + d.y))) {
            const a = cs[k]!;
            const b = cs[(k + 1) % 6]!;
            edges.push(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#7a5aa0", "stroke-width": 2.5, opacity: 0.75 }));
          }
        });
      }
      regionLayer.push(el("g", { id: e.name ? `cd-${model.doc.docId}-${slugify(e.name)}` : undefined }, ...edges));
      if (e.name && set.size > 0 && labelsOn(model)) {
        // Label sits above the region's topmost hexes, clear of their contents.
        let sx = 0;
        let minY = Infinity;
        let count = 0;
        for (const key of set) {
          const [col, row] = key.split(":").map(Number) as [number, number];
          const c = center(col, row);
          sx += c.x;
          count++;
          if (c.y < minY) minY = c.y;
        }
        const keyedLbl = labelTextFor(model, e);
        const labelText = model.labelsMode === "keyed" && keyedLbl !== null ? keyedLbl : e.name.toUpperCase();
        const width = labelText.length * (11 * 0.58 + 3);
        const y = placer.place(sx / count, minY - R * 1.35, labelText, 11, "middle", width);
        labelLayer.push(
          text(labelText, { x: sx / count, y, "font-size": 11, "letter-spacing": model.labelsMode === "keyed" ? undefined : 3, fill: "#7a5aa0", opacity: 0.85, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-family": "sans-serif" }),
        );
      }
    }
  }

  body.push(...hexLayer, ...routeLayer, ...regionLayer, ...contentLayer, ...labelLayer);
}

/** Point at fraction t (0..1) of the polyline's total arc length. */
function arcPoint(pts: XY[], t: number): XY {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let want = total * t;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (want <= d && d > 0) {
      const f = want / d;
      return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * f, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * f };
    }
    want -= d;
  }
  return pts[pts.length - 1]!;
}

function glyph(word: string, at: XY): string {
  const tier = tierOf(word);
  switch (word) {
    case "dungeon":
      return el("rect", { x: at.x - 4, y: at.y - 4, width: 8, height: 8, fill: INK });
    case "ruin":
      return el("rect", { x: at.x - 4, y: at.y - 4, width: 8, height: 8, fill: "none", stroke: INK, "stroke-width": 1.2, "stroke-dasharray": "2 2" });
    case "keep":
    case "castle":
    case "tower":
      return el("polygon", { points: `${fmt(at.x - 4)},${fmt(at.y + 4)} ${fmt(at.x + 4)},${fmt(at.y + 4)} ${fmt(at.x)},${fmt(at.y - 5)}`, fill: INK });
    case "lair":
      return el("polygon", { points: `${fmt(at.x - 4)},${fmt(at.y + 4)} ${fmt(at.x + 4)},${fmt(at.y + 4)} ${fmt(at.x)},${fmt(at.y - 5)}`, fill: "none", stroke: INK, "stroke-width": 1.2 });
    default:
      return el("circle", { cx: at.x, cy: at.y, r: tier.r, fill: INK, stroke: "#fff", "stroke-width": 0.8 });
  }
}

function neighborDeltas(isShifted: boolean): Record<"e" | "w" | "ne" | "nw" | "se" | "sw", { x: number; y: number }> {
  return isShifted
    ? { e: { x: 1, y: 0 }, w: { x: -1, y: 0 }, ne: { x: 1, y: -1 }, nw: { x: 0, y: -1 }, se: { x: 1, y: 1 }, sw: { x: 0, y: 1 } }
    : { e: { x: 1, y: 0 }, w: { x: -1, y: 0 }, ne: { x: 0, y: -1 }, nw: { x: -1, y: -1 }, se: { x: 0, y: 1 }, sw: { x: -1, y: 1 } };
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
