/**
 * Region-map renderer: gridless world-unit coordinates, relational placement
 * resolution (mirroring the parser's order-bounded guarantee), organic seeded
 * geometry, half-plane water, and derived labels (spec 05 §2, 07).
 */

import type { EntityNode, Point, Ref } from "@chartdown/core";
import { slugify } from "@chartdown/core";
import { LabelPlacer } from "./labels";
import { anchorAttr, entityAnchor, gmTitleFor, pairOf, type Model } from "./model";
import { INK, pathStrokeFor, terrainFill, terrainFillFor, tierFor } from "./theme";
import {
  blob, COMPASS_VECTORS, el, fmt, meander, measureToNumber,
  nearestOnPolyline, pointsAttr, polylineBetween, rng, text, type XY,
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

  const resolveEntity = (e: EntityNode): Resolved => {
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
          out.polyline = meander(pts, 8, random);
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
            if (a && b) out.polyline = meander([a, ...p.via.map(toXY), b], 10, random);
            break;
          }
          case "along": {
            const line = lookup(p.ref)?.polyline;
            if (line) {
              if (out.polyline) {
                const first = out.polyline[0]!;
                const last = out.polyline[out.polyline.length - 1]!;
                out.polyline = polylineBetween(line, first, last);
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
        if (base) out.point = { x: base.x, y: base.y + 10 };
      }
    }
    return out;
  };

  const overridden = (e: EntityNode): boolean =>
    model.labelOverrides.some((o) =>
      o.target.form === "name" ? o.target.value === e.name : e.ids.includes(o.target.value),
    );

  const layers = { areas: [] as string[], lines: [] as string[], points: [] as string[], labels: [] as string[] };
  const placer = new LabelPlacer();

  for (const e of model.entities) {
    const r = resolveEntity(e);
    const key = keyOf(e);
    resolved.set(key, r);
    if (e.name) byName.set(e.name, key);

    const anchor = anchorAttr(model, e);
    const title = gmTitleFor(model, e);
    const titleEl = title ? el("title", {}, title) : "";
    const chain = model.chainOf(e.typeWord);
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
        layers.labels.push(
          text(e.name.toUpperCase(), {
            x: c.x, y: c.y, "font-size": 18, "letter-spacing": 6,
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
        layers.labels.push(
          text(e.name, { x: c.x, y: c.y, "font-size": 11, fill: INK, opacity: 0.8, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
        );
      }
      continue;
    }

    if (r.polyline) {
      const stroke = pathStrokeFor(chain);
      if (r.ridge) {
        layers.lines.push(
          el("g", { id: anchor }, titleEl,
            el("polyline", { points: pointsAttr(r.polyline), fill: "none", stroke: "#a99a85", "stroke-width": 14, opacity: 0.5, "stroke-linejoin": "round", "stroke-linecap": "round" }),
            el("polyline", { points: pointsAttr(r.polyline), fill: "none", stroke: "#8d8171", "stroke-width": 2.5, "stroke-linejoin": "round" }),
          ),
        );
      } else {
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
      placer.block(r.point.x - tier.r, r.point.y - tier.r, tier.r * 2, tier.r * 2);
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
        const y = placer.place(r.point.x + tier.r + 3, r.point.y + 4, label, tier.font, "start");
        layers.labels.push(
          text(label, { x: r.point.x + tier.r + 3, y, "font-size": tier.font, "font-weight": tier.weight, fill: INK, "font-family": "sans-serif" }),
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
