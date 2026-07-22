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
import { anchorAttr, entityAnchor, gmTitleFor, labelsOn, labelTextFor, pairOf, type Model } from "./model";
import { hasTierGlyph, INK, tierFor } from "./theme";
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
  const theme = model.theme;
  const ink = theme.surface("ink", "fill", INK);
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

  // Paint order (#76): water first, then realm tints (they shade land AND
  // territorial waters), then terrain — a nation's tint must never hide its
  // forests, and an island must rise above the sea that surrounds it.
  const layers = { water: [] as string[], realms: [] as string[], areas: [] as string[], lines: [] as string[], points: [] as string[], labels: [] as string[] };

  for (const { e, r, chain } of items) {
    const anchor = anchorAttr(model, e);
    const title = gmTitleFor(model, e);
    const titleEl = title ? el("title", {}, title) : "";
    const wordFill = theme.terrainFill(chain);

    if (r.halfPlane) {
      const poly = halfPlanePolygon(r.halfPlane, w, h);
      const isWater = e.section === "water";
      (isWater ? layers.water : e.archetype === "zone" ? layers.realms : layers.areas).push(
        el("g", { id: anchor }, titleEl,
          el("polygon", { points: pointsAttr(poly), fill: isWater ? theme.terrainFill(["sea"]) : wordFill, opacity: isWater ? 1 : 0.14 }),
        ),
      );
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        const c = centroid(poly);
        const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
        const labelText = keyedLbl ?? e.name.toUpperCase();
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
      // Polygon water (#76): a [water] entity with an area/blob placement is
      // a bounded sea or lake — full water fill and a shore line, not the
      // faint zone tint. This is what lets a world have TWO continents.
      if (e.section === "water" || chain.some((word) => word === "sea" || word === "lake" || word === "water")) {
        const isLake = chain.includes("lake");
        const waterFill = theme.terrainFill(isLake ? ["lake"] : ["sea"]);
        // Lakes sit ON land: terrain layer. Seas are the floor: water layer.
        (isLake ? layers.areas : layers.water).push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(r.polygon), fill: waterFill, stroke: shade(waterFill), "stroke-width": 1.5, "stroke-linejoin": "round" }),
          ),
        );
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          const c = centroid(r.polygon);
          const size = isLake ? 10 : 14;
          const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
          const labelText = keyedLbl ?? e.name.toUpperCase();
          const width = labelText.length * (size * 0.58 + (isLake ? 2 : 4));
          // Clamp into the viewport — an edge-hugging ocean's centroid can sit
          // half off-map.
          const cx = Math.min(Math.max(c.x, width / 2 + 10), w - width / 2 - 10);
          const y = placer.place(cx, c.y, labelText, size, "middle", width);
          layers.labels.push(
            text(labelText, {
              x: cx, y, "font-size": size, "letter-spacing": isLake ? 2 : 4,
              fill: "#5a7a96", opacity: 0.6, "text-anchor": "middle", "font-family": "sans-serif",
            }),
          );
        }
        continue;
      }
      if (e.archetype === "zone") {
        // Realm tints: beneath terrain, above water — a nation shades its
        // land and its territorial waters without hiding either.
        layers.realms.push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(r.polygon), fill: wordFill, opacity: 0.12, stroke: shade(wordFill), "stroke-width": 1, "stroke-dasharray": "10 6", "stroke-opacity": 0.35 }),
          ),
        );
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          const c = centroid(r.polygon);
          const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
          const labelText = keyedLbl ?? e.name.toUpperCase();
          const y = placer.place(c.x, c.y, labelText, 15, "middle", labelText.length * (15 * 0.58 + 5));
          layers.labels.push(
            text(labelText, {
              x: c.x, y, "font-size": 15, "letter-spacing": 5, fill: "#6b5d4a",
              opacity: 0.6, "text-anchor": "middle", "font-family": "sans-serif",
            }),
          );
        }
        continue;
      }
      const areaParts: string[] = [titleEl];
      const edgeFill = theme.prop(chain, "fill", { zone: "edge" });
      if (edgeFill) {
        // Edge zone (spec 08 §2): boundary band in the edge style, interior in core.
        const edgeW = theme.edgeWidth(chain) ?? 4;
        areaParts.push(el("polygon", { points: pointsAttr(r.polygon), fill: edgeFill, stroke: shade(edgeFill), "stroke-width": 1 }));
        areaParts.push(el("polygon", { points: pointsAttr(shrinkPolygon(r.polygon, edgeW * 2)), fill: wordFill }));
      } else {
        areaParts.push(el("polygon", { points: pointsAttr(r.polygon), fill: wordFill, stroke: shade(wordFill), "stroke-width": 1 }));
      }
      const glyphName = theme.prop(chain, "glyph");
      if (glyphName) {
        areaParts.push(...scatterGlyphs(r.polygon, glyphName, theme, ink));
      }
      layers.areas.push(el("g", { id: anchor }, ...areaParts));
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        const c = r.point ?? centroid(r.polygon);
        const lbl = labelTextFor(model, e) ?? e.name;
        const y = placer.place(c.x, c.y, lbl, 11, "middle");
        layers.labels.push(
          text(lbl, { x: c.x, y, "font-size": 11, fill: ink, opacity: 0.8, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
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
        const stroke = theme.pathStroke(chain);
        const width = Number(pairOf(e.pairs, "width") ?? 2);
        const lineParts: string[] = [titleEl];
        const edgeW = theme.edgeWidth(chain);
        if (edgeW) {
          const edgeStroke = theme.prop(chain, "stroke", { zone: "edge" }) ?? theme.prop(chain, "fill", { zone: "edge" }) ?? stroke.stroke;
          lineParts.push(
            el("polyline", {
              points: pointsAttr(r.polyline), fill: "none", stroke: edgeStroke,
              "stroke-width": width + 2 * edgeW, "stroke-linejoin": "round", "stroke-linecap": "round",
            }),
          );
        }
        lineParts.push(
          el("polyline", {
            points: pointsAttr(r.polyline), fill: "none", stroke: stroke.stroke,
            "stroke-width": width, "stroke-dasharray": stroke.dash, "stroke-linejoin": "round", "stroke-linecap": "round",
          }),
        );
        layers.lines.push(el("g", { id: anchor }, ...lineParts));
      }
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        const mid = r.polyline[Math.floor(r.polyline.length / 2)]!;
        const lbl = labelTextFor(model, e) ?? e.name;
        const y = placer.place(mid.x + 4, mid.y - 4, lbl, 10, "start");
        layers.labels.push(
          text(lbl, { x: mid.x + 4, y, "font-size": 10, fill: ink, opacity: 0.75, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "font-style": "italic", "font-family": "sans-serif" }),
        );
      }
      continue;
    }

    if (r.point) {
      const tier = tierFor(chain);
      const glyphPath = theme.glyphFor(chain, r.point.x, r.point.y);
      layers.points.push(
        el("g", { id: anchor }, titleEl,
          glyphPath
            ? glyphEl(glyphPath, r.point.x, r.point.y, 0.7, ink)
            : chain.includes("capital")
              ? el("rect", {
                  x: r.point.x - tier.r, y: r.point.y - tier.r, width: tier.r * 2, height: tier.r * 2,
                  fill: ink, transform: `rotate(45 ${fmt(r.point.x)} ${fmt(r.point.y)})`,
                })
              : el("circle", { cx: r.point.x, cy: r.point.y, r: tier.r, fill: ink, stroke: "#fff", "stroke-width": 1 }),
        ),
      );
      // Fallback-chain terminal (spec 04 §4): a marker with no meaningful
      // glyph anywhere along its chain carries its word as the label.
      const label =
        (e.name !== null ? (labelTextFor(model, e) ?? e.name) : null) ??
        (e.typeWord === "note" ? e.texts[0] ?? null : null) ??
        (hasTierGlyph(chain) ? null : e.typeWord);
      if (label && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model, e)) {
        const spot = placer.placeBeside(r.point.x + tier.r + 3, r.point.x - tier.r - 3, r.point.y + 4, label, tier.font);
        layers.labels.push(
          text(label, { x: spot.x, y: spot.y, "font-size": tier.font, "font-weight": tier.weight, fill: ink, "text-anchor": spot.anchor === "middle" ? undefined : spot.anchor, "font-family": "sans-serif" }),
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
      layers.labels.push(text(name, { x: p.x, y: p.y, "font-size": 11, fill: ink, "text-anchor": "middle", "font-family": "sans-serif" }));
    } else if (o.hint.kind === "side") {
      const base = resolved.get(key)?.point;
      if (base) {
        const vec = COMPASS_VECTORS[o.hint.compass]!;
        layers.labels.push(text(name, { x: base.x + vec.x * 16, y: base.y + vec.y * 16, "font-size": 11, fill: ink, "text-anchor": "middle", "font-family": "sans-serif" }));
      }
    }
  }

  body.push(...layers.water, ...layers.realms, ...layers.areas, ...layers.lines, ...layers.points, ...layers.labels);
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
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const dim = (v: number): number => Math.max(0, Math.round(v * 0.8));
  return `#${(((dim((n >> 16) & 255)) << 16) | ((dim((n >> 8) & 255)) << 8) | dim(n & 255)).toString(16).padStart(6, "0")}`;
}

/** A glyph path in its 24×24 unit box, placed and scaled (spec 08 §4). */
function glyphEl(pathData: string, x: number, y: number, scale: number, ink: string): string {
  return `<path d="${pathData}" transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})" fill="none" stroke="${ink}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
}

function shrinkPolygon(pts: XY[], by: number): XY[] {
  const c = centroid(pts);
  return pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0.1, (d - by) / d);
    return { x: c.x + dx * k, y: c.y + dy * k };
  });
}

function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Deterministic glyph scatter across an area (position-hash jitter, no RNG sequence). */
function scatterGlyphs(poly: XY[], glyphValue: string, theme: import("./theme").Theme, ink: string): string[] {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const out: string[] = [];
  const spacing = 30;
  for (let gy = Math.ceil(Math.min(...ys) / spacing) * spacing; gy < Math.max(...ys); gy += spacing) {
    for (let gx = Math.ceil(Math.min(...xs) / spacing) * spacing; gx < Math.max(...xs); gx += spacing) {
      let h = 2166136261;
      for (const n of [gx, gy]) {
        h ^= n;
        h = Math.imul(h, 16777619);
      }
      const jx = gx + ((h >>> 3) % 13) - 6;
      const jy = gy + ((h >>> 7) % 13) - 6;
      const p = { x: jx, y: jy };
      if (!pointInPolygon(p, poly)) continue;
      const chosen = theme.pickVariant(glyphValue, jx, jy);
      const path = theme.glyphs[chosen];
      if (path) out.push(glyphEl(path, jx, jy, 0.55, ink));
    }
  }
  return out;
}
