/**
 * Region-map renderer: gridless world-unit coordinates, relational placement
 * resolution (mirroring the parser's order-bounded guarantee), organic seeded
 * geometry, half-plane water, and derived labels (spec 05 §2, 07).
 *
 * Rendering is two-pass: all positions resolve first (so every marker is a
 * known obstacle), then labels place with full knowledge — a label can never
 * sit on a marker declared later in the document.
 */

import type { EntityNode, Point, Ref } from "@chartdown/core";
import { slugify } from "@chartdown/core";
import { SideLabelPlacer } from "./labels";
import { anchorAttr, entityAnchor, gmTitleFor, pairOf, type Model } from "./model";
import { INK, pathStrokeFor, terrainFill, terrainFillFor, tierFor } from "./theme";
import {
  blob, COMPASS_VECTORS, el, fmt, meander, measureToNumber,
  nearestOnPolyline, pointsAttr, rng, subPolylineBetween, text, type XY,
} from "./util";

interface Resolved {
  point?: XY;
  polyline?: XY[];
  polygon?: XY[];
  radius?: number;
  ridge?: boolean;
  halfPlane?: { compass: string; of: XY[] };
}

export function renderRegion(model: Model, body: string[], size: { w: number; h: number; scale: number }): void {
  const { w, h, scale } = size;
  const random = rng(model.seed + 7);
  const resolved = new Map<string, Resolved>();
  const byName = new Map<string, string>();
  /** Direction toward declared water (from e.g. `sea : west of coast`), for landward nudges. */
  let waterVector: XY | null = null;

  const keyOf = (e: EntityNode): string => entityAnchor(e) ?? `@anon-${e.line}`;
  const lookup = (ref: Ref): Resolved | undefined =>
    resolved.get(ref.form === "id" ? ref.value : (byName.get(ref.value) ?? slugify(ref.value)));
  const toXY = (p: Point): XY => ({ x: p.x * scale, y: p.y * scale });

  const refPoint = (ref: Ref): XY | null => {
    const r = lookup(ref);
    if (!r) return null;
    if (r.point) return r.point;
    if (r.polyline) return r.polyline[Math.floor(r.polyline.length / 2)]!;
    if (r.polygon) return centroid(r.polygon);
    return null;
  };

  /** Meander amplitude grows with length; rivers wander more than roads. */
  const meanderAmount = (pts: XY[], chain: string[]): number => {
    let length = 0;
    for (let i = 0; i < pts.length - 1; i++) length += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    const factor = chain.includes("river") ? 0.055 : chain.includes("road") ? 0.02 : 0.035;
    return Math.min(32, Math.max(6, length * factor));
  };

  const resolveEntity = (e: EntityNode): Resolved => {
    const chain = model.chainOf(e.typeWord);
    const out: Resolved = {};
    let onRef: Ref | null = null;
    for (const p of e.placements) {
      if (p.kind === "point") out.point = toXY(p);
      else if (p.kind === "point-range") {
        const a = toXY(p.from);
        const b = toXY(p.to);
        out.polygon = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      } else if (p.kind === "shape") {
        const pts = p.args.filter((arg): arg is Point => arg.kind === "point").map(toXY);
        if (p.shape === "blob") {
          const center = pts[0] ?? out.point ?? { x: w / 2, y: h / 2 };
          const radius = (measureToNumber(pairOf(e.pairs, "size") ?? "40") / 2) * scale;
          out.polygon = blob(center, radius, random);
          out.point = center;
          out.radius = radius;
        } else if (p.shape === "area") {
          out.polygon = pts;
        } else {
          out.polyline = meander(pts, meanderAmount(pts, chain), random);
          out.ridge = p.shape === "ridge";
        }
      } else if (p.kind === "relational") {
        switch (p.form) {
          case "at":
            if (p.target.kind === "point") out.point = toXY(p.target);
            break;
          case "offset-of": {
            const base = refPoint(p.ref);
            if (base) {
              const vec = COMPASS_VECTORS[p.compass]!;
              const d = measureToNumber(p.measure) * scale;
              out.point = { x: base.x + vec.x * d, y: base.y + vec.y * d };
            }
            break;
          }
          case "side-of": {
            const r = lookup(p.ref);
            if (r?.polyline) out.halfPlane = { compass: p.compass, of: r.polyline };
            else {
              const base = refPoint(p.ref);
              if (base) {
                const vec = COMPASS_VECTORS[p.compass]!;
                out.point = { x: base.x + vec.x * 40, y: base.y + vec.y * 40 };
              }
            }
            break;
          }
          case "edge-of": {
            const base = refPoint(p.ref);
            if (base) {
              const vec = COMPASS_VECTORS[p.compass]!;
              const reach = lookup(p.ref)?.radius ?? 30;
              out.point = { x: base.x + vec.x * reach, y: base.y + vec.y * reach };
            }
            break;
          }
          case "on":
            onRef = p.ref;
            if (p.point) out.point = toXY(p.point);
            break;
          case "near": {
            const target = p.target.kind === "point" ? toXY(p.target) : refPoint(p.target);
            if (target) out.point = { x: target.x + 8, y: target.y + 8 };
            break;
          }
          case "from-to": {
            const endpoint = (ep: typeof p.from): XY | null =>
              ep.point ? toXY(ep.point) : ep.at.kind === "point" ? toXY(ep.at) : refPoint(ep.at);
            const a = endpoint(p.from);
            const b = endpoint(p.to);
            if (a && b) {
              const raw = [a, ...p.via.map(toXY), b];
              out.polyline = meander(raw, meanderAmount(raw, chain), random);
            }
            break;
          }
          case "along": {
            const line = lookup(p.ref)?.polyline;
            if (line) {
              if (out.polyline) {
                // `A to B along X`: anchor at both endpoint markers and follow
                // X's shape between their projections — nudged landward so a
                // coast road runs beside the shoreline, not on it.
                const first = out.polyline[0]!;
                const last = out.polyline[out.polyline.length - 1]!;
                let guide = subPolylineBetween(line, first, last);
                if (waterVector) {
                  const vec = waterVector;
                  guide = guide.map((pt) => ({ x: pt.x - vec.x * 4, y: pt.y - vec.y * 4 }));
                }
                out.polyline = [first, ...guide, last];
              } else {
                out.polyline = line.map((pt) => ({ ...pt }));
              }
            }
            break;
          }
        }
      }
    }
    if (onRef) {
      const line = lookup(onRef)?.polyline;
      if (line) out.point = nearestOnPolyline(line, out.point ?? centroid(line));
      else if (!out.point) {
        const base = refPoint(onRef);
        if (base) out.point = { x: base.x, y: base.y };
      }
      // A settlement/feature "on" something sits on the land side of declared water.
      if (out.point && e.section !== "water" && waterVector) {
        out.point = { x: out.point.x - waterVector.x * 7, y: out.point.y - waterVector.y * 7 };
      }
    }
    return out;
  };

  // ---------- pass 1: resolve everything ----------
  interface Item {
    e: EntityNode;
    r: Resolved;
    chain: string[];
  }
  const items: Item[] = [];
  for (const e of model.entities) {
    const r = resolveEntity(e);
    const key = keyOf(e);
    resolved.set(key, r);
    if (e.name) byName.set(e.name, key);
    if (r.halfPlane && e.section === "water") waterVector = COMPASS_VECTORS[r.halfPlane.compass] ?? null;
    items.push({ e, r, chain: model.chainOf(e.typeWord) });
  }

  // ---------- pass 2: render, markers known before any label places ----------
  const placer = new SideLabelPlacer();
  for (const { e, r, chain } of items) {
    if (r.point) {
      const tier = tierFor(chain);
      placer.block(r.point.x - tier.r - 1, r.point.y - tier.r - 1, tier.r * 2 + 2, tier.r * 2 + 2);
    }
  }

  const overridden = (e: EntityNode): boolean =>
    model.labelOverrides.some((o) =>
      o.target.form === "name" ? o.target.value === e.name : e.ids.includes(o.target.value),
    );

  const layers = { areas: [] as string[], lines: [] as string[], points: [] as string[], labels: [] as string[] };

  for (const { e, r, chain } of items) {
    const anchor = anchorAttr(model, e);
    const title = gmTitleFor(model, e);
    const titleEl = title ? el("title", {}, title) : "";
    const wordFill = terrainFillFor(chain);

    if (r.halfPlane) {
      const poly = halfPlanePolygon(r.halfPlane, w, h);
      const isWater = e.section === "water";
      layers.areas.push(
        el("g", { id: anchor }, titleEl,
          el("polygon", { points: pointsAttr(poly), fill: isWater ? terrainFill("sea") : wordFill, opacity: isWater ? 1 : 0.14 }),
        ),
      );
      if (e.name && !e.flags.includes("nolabel") && !overridden(e)) {
        const c = centroid(poly);
        const labelText = e.name.toUpperCase();
        const y = placer.place(c.x, c.y, labelText, 18, "middle", labelText.length * (18 * 0.58 + 6));
        layers.labels.push(
          text(labelText, {
            x: c.x, y, "font-size": 18, "letter-spacing": 6,
            fill: isWater ? "#5a7a96" : INK, opacity: 0.55, "text-anchor": "middle", "font-family": "sans-serif",
          }),
        );
      }
      continue;
    }

    if (r.polygon) {
      layers.areas.push(
        el("g", { id: anchor }, titleEl,
          el("polygon", { points: pointsAttr(r.polygon), fill: wordFill, stroke: shade(wordFill), "stroke-width": 1 }),
        ),
      );
      if (e.name && !e.flags.includes("nolabel") && !overridden(e)) {
        const c = r.point ?? centroid(r.polygon);
        const y = placer.place(c.x, c.y, e.name, 11, "middle");
        layers.labels.push(
          text(e.name, { x: c.x, y, "font-size": 11, fill: INK, opacity: 0.8, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
        );
      }
      continue;
    }

    if (r.polyline) {
      if (r.ridge) {
        layers.lines.push(
          el("g", { id: anchor }, titleEl,
            el("polyline", { points: pointsAttr(r.polyline), fill: "none", stroke: "#a99a85", "stroke-width": 14, opacity: 0.5, "stroke-linejoin": "round", "stroke-linecap": "round" }),
            el("polyline", { points: pointsAttr(r.polyline), fill: "none", stroke: "#8d8171", "stroke-width": 2.5, "stroke-linejoin": "round" }),
          ),
        );
      } else {
        const stroke = pathStrokeFor(chain);
        const width = Number(pairOf(e.pairs, "width") ?? 2);
        layers.lines.push(
          el("g", { id: anchor }, titleEl,
            el("polyline", {
              points: pointsAttr(r.polyline), fill: "none", stroke: stroke.stroke,
              "stroke-width": width, "stroke-dasharray": stroke.dash, "stroke-linejoin": "round", "stroke-linecap": "round",
            }),
          ),
        );
      }
      if (e.name && !e.flags.includes("nolabel") && !overridden(e)) {
        const mid = r.polyline[Math.floor(r.polyline.length / 2)]!;
        const y = placer.place(mid.x + 4, mid.y - 4, e.name, 10, "start");
        layers.labels.push(
          text(e.name, { x: mid.x + 4, y, "font-size": 10, fill: INK, opacity: 0.75, "font-style": "italic", "font-family": "sans-serif" }),
        );
      }
      continue;
    }

    if (r.point) {
      const tier = tierFor(chain);
      layers.points.push(
        el("g", { id: anchor }, titleEl,
          chain.includes("capital")
            ? el("rect", {
                x: r.point.x - tier.r, y: r.point.y - tier.r, width: tier.r * 2, height: tier.r * 2,
                fill: INK, transform: `rotate(45 ${fmt(r.point.x)} ${fmt(r.point.y)})`,
              })
            : el("circle", { cx: r.point.x, cy: r.point.y, r: tier.r, fill: INK, stroke: "#fff", "stroke-width": 1 }),
        ),
      );
      const label = e.name ?? (e.archetypeSource !== "vocab" ? e.typeWord : null) ?? (e.typeWord === "note" ? e.texts[0] ?? null : null);
      if (label && !e.flags.includes("nolabel") && !overridden(e)) {
        const spot = placer.placeBeside(r.point.x + tier.r + 3, r.point.x - tier.r - 3, r.point.y + 4, label, tier.font);
        layers.labels.push(
          text(label, { x: spot.x, y: spot.y, "font-size": tier.font, "font-weight": tier.weight, fill: INK, "text-anchor": spot.anchor === "middle" ? undefined : spot.anchor, "font-family": "sans-serif" }),
        );
      }
    }
  }

  // Label overrides (spec 07 §2)
  for (const o of model.labelOverrides) {
    const key = o.target.form === "id" ? o.target.value : (byName.get(o.target.value) ?? slugify(o.target.value));
    const name = o.target.form === "name" ? o.target.value : key;
    if (o.hint.kind === "sprawl" && o.hint.range.kind === "point-range") {
      const a = toXY(o.hint.range.from);
      const b = toXY(o.hint.range.to);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      layers.labels.push(
        text(name.toUpperCase(), {
          x: cx, y: cy, "font-size": 16, "letter-spacing": 8, fill: "#5a7a96", opacity: 0.85,
          "text-anchor": "middle", "font-family": "sans-serif",
          transform: Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? `rotate(90 ${fmt(cx)} ${fmt(cy)})` : undefined,
        }),
      );
    } else if (o.hint.kind === "at" && o.hint.target.kind === "point") {
      const p = toXY(o.hint.target);
      layers.labels.push(text(name, { x: p.x, y: p.y, "font-size": 11, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
    } else if (o.hint.kind === "side") {
      const base = resolved.get(key)?.point;
      if (base) {
        const vec = COMPASS_VECTORS[o.hint.compass]!;
        layers.labels.push(text(name, { x: base.x + vec.x * 16, y: base.y + vec.y * 16, "font-size": 11, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
    }
  }

  body.push(...layers.areas, ...layers.lines, ...layers.points, ...layers.labels);
}

function halfPlanePolygon(hp: { compass: string; of: XY[] }, w: number, h: number): XY[] {
  const line = hp.of;
  const first = line[0]!;
  const last = line[line.length - 1]!;
  const c = hp.compass;
  if ((c.includes("n") || c.includes("s")) && !c.includes("e") && !c.includes("w")) {
    const edgeY = c.includes("n") ? 0 : h;
    return [...line, { x: last.x, y: edgeY }, { x: first.x, y: edgeY }];
  }
  const edgeX = c.includes("w") ? 0 : w;
  return [...line, { x: edgeX, y: last.y }, { x: edgeX, y: first.y }];
}

function centroid(pts: XY[]): XY {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const dim = (v: number): number => Math.max(0, Math.round(v * 0.8));
  return `#${(((dim((n >> 16) & 255)) << 16) | ((dim((n >> 8) & 255)) << 8) | dim(n & 255)).toString(16).padStart(6, "0")}`;
}
