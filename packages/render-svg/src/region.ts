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
  blob, catmullRom, COMPASS_VECTORS, el, fmt, hashSeed, hashString, measureToNumber,
  nearestOnPolyline, pointsAttr, rng, subPolylineBetween, text, type XY,
} from "./util";

interface Resolved {
  point?: XY;
  polyline?: XY[];
  polygon?: XY[];
  radius?: number;
  ridge?: boolean;
  /** Massif breadth in px (from `width=`, a measure) — a ridge is a BELT, not a centerline. */
  beltW?: number;
  halfPlane?: { compass: string; of: XY[] };
  /** Vertex-index ranges of the polygon that were spliced from a followed feature (#81). */
  alongSpans?: { ref: string; start: number; end: number }[];
}

export function renderRegion(model: Model, body: string[], size: { w: number; h: number; scale: number }): void {
  const { w, h, scale } = size;
  const theme = model.theme;
  const ink = theme.surface("ink", "fill", INK);
  // No shared noise stream: every organic shape keys on its OWN geometry
  // (owner review caught the defect — one stream meant adding a forest
  // reshaped every blob and river declared after it).
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

  // Finished coastlines by their DECLARED points: water polygons whose edges
  // run through the same points reuse the coastline's exact curve, so the sea
  // fill and the shore line cannot mismatch (owner round-three note).
  const coastCurves: { raw: XY[]; finished: XY[] }[] = [];
  // Ordinals for identity-keyed blobs: nth anonymous blob of a given
  // word+size keeps its shape when MOVED (shape belongs to the thing, not
  // the place); only inserting an identical sibling before it renumbers.
  const blobOrdinals = new Map<string, number>();

  const near = (a: XY, b: XY): boolean => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
  const runMatches = (pts: XY[], start: number, raw: XY[], reversed: boolean): boolean => {
    if (start + raw.length > pts.length) return false;
    for (let k = 0; k < raw.length; k++) {
      const r = reversed ? raw[raw.length - 1 - k]! : raw[k]!;
      if (!near(pts[start + k]!, r)) return false;
    }
    return true;
  };
  /** Sea boundary: matched coastline runs use the finished curve; the rest stay straight. */
  const assembleWaterBoundary = (pts: XY[]): XY[] => {
    const out: XY[] = [];
    let i = 0;
    while (i < pts.length) {
      let advanced = false;
      for (const c of coastCurves) {
        if (c.raw.length >= 2 && runMatches(pts, i, c.raw, false)) {
          out.push(...c.finished);
          i += c.raw.length;
          advanced = true;
          break;
        }
        if (c.raw.length >= 2 && runMatches(pts, i, c.raw, true)) {
          out.push(...[...c.finished].reverse());
          i += c.raw.length;
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        out.push(pts[i]!);
        i++;
      }
    }
    return out;
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
          // Identity-keyed shape: id (or word) + size + doc seed — MOVING a
          // blob slides the same shape (owner round three); same-size
          // anonymous siblings differ by ordinal. Never keyed by position or
          // by document order at large.
          const idKey = `${entityAnchor(e) ?? e.typeWord ?? "blob"}:${radius}`;
          const n = blobOrdinals.get(idKey) ?? 0;
          blobOrdinals.set(idKey, n + 1);
          out.polygon = catmullRom(blob(center, radius, rng(hashSeed(model.seed, radius, hashString(idKey), n))), 5, true);
          out.point = center;
          out.radius = radius;
        } else if (p.shape === "area") {
          // Boundary segments may FOLLOW features (#81): `along <ref>`
          // between two vertices splices the feature's rendered curve
          // between their projections — one definition, and moving the
          // feature moves the border with it.
          const spliced: XY[] = [];
          const spans: { ref: string; start: number; end: number }[] = [];
          for (let k = 0; k < p.args.length; k++) {
            const arg = p.args[k]!;
            if (arg.kind === "point") {
              spliced.push(toXY(arg));
              continue;
            }
            if (arg.kind !== "relational" || arg.form !== "along") continue;
            const line = lookup(arg.ref)?.polyline;
            const prev = spliced[spliced.length - 1];
            let next: XY | null = null;
            for (let m = k + 1; m < p.args.length; m++) {
              const b = p.args[m]!;
              if (b.kind === "point") {
                next = toXY(b);
                break;
              }
            }
            next ??= spliced[0] ?? null; // trailing `along` follows through the closing edge
            if (line && prev && next) {
              const seg = subPolylineBetween(line, prev, next);
              spans.push({ ref: arg.ref.value, start: spliced.length - 1, end: spliced.length + seg.length });
              spliced.push(...seg);
            }
          }
          if (spans.length) out.alongSpans = spans;
          out.polygon = e.section === "water" ? assembleWaterBoundary(spliced) : spliced;
        } else {
          // The TRUE curve: a spline through the declared points, no noise.
          out.polyline = catmullRom(pts, 8);
          out.ridge = p.shape === "ridge";
          if (out.ridge) {
            const declared = pairOf(e.pairs, "width");
            out.beltW = declared ? measureToNumber(declared) * scale : 28;
          }
          if (chain.includes("coastline")) coastCurves.push({ raw: pts, finished: out.polyline });
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
            // Endpoints snap to the target's FINISHED geometry: a river mouth
            // lands exactly on the drawn coast, and a bare water-body ref
            // stops at the shore, not the center (rivers do not sail lakes).
            const ring = (poly: XY[]): XY[] => [...poly, poly[0]!];
            const resolveEnd = (ep: typeof p.from): { p: XY | null; shore: XY[] | null } => {
              if (ep.at.kind === "point") return { p: toXY(ep.at), shore: null };
              const target = lookup(ep.at);
              if (ep.point) {
                const raw = toXY(ep.point);
                if (target?.polyline) return { p: nearestOnPolyline(target.polyline, raw), shore: null };
                if (target?.polygon) return { p: nearestOnPolyline(ring(target.polygon), raw), shore: null };
                return { p: raw, shore: null };
              }
              return { p: refPoint(ep.at), shore: target?.polygon ? ring(target.polygon) : null };
            };
            const A = resolveEnd(p.from);
            const B = resolveEnd(p.to);
            if (A.p && B.p) {
              const via = p.via.map(toXY);
              const a = A.shore ? nearestOnPolyline(A.shore, via[0] ?? B.p) : A.p;
              const b = B.shore ? nearestOnPolyline(B.shore, via[via.length - 1] ?? A.p) : B.p;
              out.polyline = catmullRom([a, ...via, b], 8);
              // Coastlines declared from/via/to register their curves too —
              // sea boundaries must reuse them however the coast was written.
              if (chain.includes("coastline")) coastCurves.push({ raw: [a, ...via, b], finished: out.polyline });
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
  const placer = new SideLabelPlacer({ w, h });
  // The title owns its corner; the compass its own (owner round five).
  if (model.doc.title) placer.block(0, 0, model.doc.title.length * 10 + 30, 34, 3);
  if (model.header.get("compass") === "on") placer.block(w - 60, 10, 55, 62, 3);
  for (const { e, r, chain } of items) {
    if (r.point) {
      const tier = tierFor(chain);
      placer.block(r.point.x - tier.r - 1, r.point.y - tier.r - 1, tier.r * 2 + 2, tier.r * 2 + 2, 2);
    }
  }

  const overridden = (e: EntityNode): boolean =>
    model.labelOverrides.some((o) =>
      o.target.form === "name" ? o.target.value === e.name : e.ids.includes(o.target.value),
    );

  // Every line is an obstacle: ridges fat, rivers and roads thin — a label
  // above a river must not land ON the road that runs beside it (the
  // Deepflow/Deep Road swap of owner round four).
  for (const { r } of items) {
    if (!r.polyline) continue;
    if (r.ridge) {
      // Low weight: the belt is soft terrain, not a wall — labels prefer
      // to stay off it but a feature ON the range keeps its name (shrunk)
      // rather than dropping it. Blocks are arc-spaced so their weighted
      // overlaps don't SUM past the drop threshold for on-belt labels.
      const half = (r.beltW ?? 28) / 2 + 3;
      let acc = 0;
      let lastAt = -Infinity;
      for (let i = 0; i < r.polyline.length; i++) {
        if (i > 0) {
          const a = r.polyline[i - 1]!;
          const b = r.polyline[i]!;
          acc += Math.hypot(b.x - a.x, b.y - a.y);
        }
        if (acc - lastAt >= half * 1.6) {
          const pt = r.polyline[i]!;
          placer.block(pt.x - half, pt.y - half, half * 2, half * 2, 0.3);
          lastAt = acc;
        }
      }
    } else {
      // Every sample point: gap-free, so parallel-line labels can't slip
      // through holes between obstacle boxes (the Deepflow/Deep Road pair).
      for (const pt of r.polyline) {
        placer.block(pt.x - 3, pt.y - 3, 6, 6);
      }
    }
  }

  const pip = (pt: XY, poly: XY[]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  /** Point at fraction t of a polyline's arc length, with local direction. */
  const alongAt = (pts: XY[], t: number): { p: XY; dir: XY } => {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    let want = total * t;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
      if (want <= d && d > 0) {
        const f = want / d;
        return {
          p: { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * f, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * f },
          dir: { x: (pts[i + 1]!.x - pts[i]!.x) / d, y: (pts[i + 1]!.y - pts[i]!.y) / d },
        };
      }
      want -= d;
    }
    return { p: pts[pts.length - 1]!, dir: { x: 1, y: 0 } };
  };

  // Paint order (#76): water first, then realm tints (they shade land AND
  // territorial waters), then terrain — a nation's tint must never hide its
  // forests, and an island must rise above the sea that surrounds it.
  const layers = { water: [] as string[], realms: [] as string[], areas: [] as string[], lines: [] as string[], points: [] as string[], labels: [] as string[] };
  let pathLabelCount = 0;

  // Point labels move LAST (owner: a point label's proximity IS its meaning);
  // things with room to roam yield. Claims run in priority order — 0 author
  // overrides (fixed), 1 point markers (capitals before minor features),
  // 2 curve labels, 3 area names, 4 water/realm sprawls — while paint order
  // stacks the reverse, so big faint names sit beneath the small precise
  // ones. Under density each label shrinks before it moves far, and is
  // omitted rather than drawn over other text (spec 07 §5).
  const labelBuckets: string[][] = [[], [], [], [], []];
  const labelJobs: { priority: number; run: () => void }[] = [];
  const deferLabel = (priority: number, run: () => void): void => void labelJobs.push({ priority, run });

  // Political boundaries (#81): a border names a relationship, not a place —
  // realms collected here, border declarations there, seams rendered after
  // every realm's geometry is known.
  // `frame` marks half-plane realms: their polygon is mostly viewport edge,
  // so only border-stated stretches stroke (no outline around the map rim).
  const realmInfos: { e: EntityNode; key: string; poly: XY[]; spans: { ref: string; start: number; end: number }[]; fill: string; frame?: boolean }[] = [];
  const borderDecls: EntityNode[] = [];

  for (const { e, r, chain } of items) {
    const anchor = anchorAttr(model, e);
    const title = gmTitleFor(model, e);
    const titleEl = title ? el("title", {}, title) : "";
    const wordFill = theme.terrainFill(chain);

    if (chain.includes("border")) {
      borderDecls.push(e);
      continue;
    }

    if (r.halfPlane) {
      const poly = halfPlanePolygon(r.halfPlane, w, h);
      const isWater = e.section === "water";
      (isWater ? layers.water : e.archetype === "zone" ? layers.realms : layers.areas).push(
        el("g", { id: anchor }, titleEl,
          el("polygon", { points: pointsAttr(poly), fill: isWater ? theme.terrainFill(["sea"]) : wordFill, opacity: isWater ? 1 : 0.2 }),
        ),
      );
      if (!isWater && e.archetype === "zone") realmInfos.push({ e, key: keyOf(e), poly, spans: [], fill: wordFill, frame: true });
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        deferLabel(4, () => {
          const c = centroid(poly);
          const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
          const labelText = keyedLbl ?? e.name!.toUpperCase();
          const y = placer.place(c.x, c.y, labelText, 18, "middle", labelText.length * (18 * 0.58 + 6));
          labelBuckets[4]!.push(
            text(labelText, {
              x: c.x, y, "font-size": 18, "letter-spacing": 6,
              fill: isWater ? "#5a7a96" : INK, opacity: 0.55, "text-anchor": "middle", "font-family": "sans-serif",
            }),
          );
        });
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
        // The boundary already reuses coastline curves (assembleWaterBoundary)
        // — no stroke and no re-spline: the declared coastline owns the shore
        // line and the fill follows it exactly. Lakes sit on land: terrain
        // layer. Seas are the floor: water layer.
        const shore = r.polygon;
        (isLake ? layers.areas : layers.water).push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(shore), fill: waterFill, stroke: isLake ? shade(waterFill) : undefined, "stroke-width": isLake ? 1.2 : undefined, "stroke-linejoin": "round" }),
          ),
        );
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          const priority = isLake ? 3 : 4;
          deferLabel(priority, () => {
            const c = centroid(r.polygon!);
            const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
            const labelText = keyedLbl ?? e.name!.toUpperCase();
            // Text fits its water: the font shrinks until the name fits the
            // polygon's width (no label is too big to exist on the map).
            const bboxW = Math.max(...r.polygon!.map((p) => p.x)) - Math.min(...r.polygon!.map((p) => p.x));
            const { size, spacing } = fitLabel(labelText, bboxW * 0.85, isLake ? 10 : 14, isLake ? 2 : 4);
            const width = labelText.length * (size * 0.58 + spacing);
            const cx = Math.min(Math.max(c.x, width / 2 + 10), w - width / 2 - 10);
            const y = placer.place(cx, c.y, labelText, size, "middle", width);
            labelBuckets[priority]!.push(
              text(labelText, {
                x: cx, y, "font-size": size, "letter-spacing": spacing,
                fill: "#5a7a96", opacity: 0.6, "text-anchor": "middle", "font-family": "sans-serif",
              }),
            );
          });
        }
        continue;
      }
      if (e.archetype === "zone") {
        // Realm tints: beneath terrain, above water — a nation shades its
        // land and its territorial waters without hiding either. The tint
        // is visible at a glance (owner round ten: 0.12 read as nothing).
        // The BOUNDARY renders separately after all realms are known, so
        // border states can restyle stretches of it (#81).
        layers.realms.push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(r.polygon), fill: wordFill, opacity: 0.2 }),
          ),
        );
        realmInfos.push({ e, key: keyOf(e), poly: r.polygon, spans: r.alongSpans ?? [], fill: wordFill });
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          deferLabel(4, () => {
            const c = centroid(r.polygon!);
            const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
            const labelText = keyedLbl ?? e.name!.toUpperCase();
            // A small realm gets a small name — the label fits its territory.
            const bboxW = Math.max(...r.polygon!.map((p) => p.x)) - Math.min(...r.polygon!.map((p) => p.x));
            const { size, spacing } = fitLabel(labelText, bboxW * 0.8, 15, 5);
            const width = labelText.length * (size * 0.58 + spacing);
            // Sidestep within the territory before settling ON something
            // (Ghor Vakh's centroid sits right on the Vakh Teeth) — the
            // ladder reaches a third of the realm each way but never leaves
            // it (a nation's name stays on its own land), and a nation
            // always keeps its name: least-bad rather than omitted.
            const dxs = [0, -bboxW / 5, bboxW / 5, -bboxW / 3, bboxW / 3];
            const spot =
              placer.placeOrDrop(c.x, c.y, labelText, size, "middle", dxs, width, (x, y) => pip({ x, y }, r.polygon!)) ??
              { x: c.x, y: placer.place(c.x, c.y, labelText, size, "middle", width), size };
            labelBuckets[4]!.push(
              text(labelText, {
                x: spot.x, y: spot.y, "font-size": spot.size, "letter-spacing": spacing, fill: "#6b5d4a",
                opacity: 0.6, "text-anchor": "middle", "font-family": "sans-serif",
              }),
            );
          });
        }
        continue;
      }
      // Islands are LAND (owner round three): paper surface and a coastline
      // stroke, exactly like the continents — not a tinted blob.
      if (chain.includes("island")) {
        const coast = theme.pathStroke(["coastline"]);
        layers.areas.push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(r.polygon), fill: theme.surface("paper", "fill", "#f9f5ea"), stroke: coast.stroke, "stroke-width": 1.2, "stroke-linejoin": "round" }),
          ),
        );
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          deferLabel(3, () => {
            const c = r.point ?? centroid(r.polygon!);
            const lbl = labelTextFor(model, e) ?? e.name!;
            const bw = Math.max(...r.polygon!.map((p) => p.x)) - Math.min(...r.polygon!.map((p) => p.x));
            const spot = placer.placeOrDrop(c.x, c.y, lbl, 10, "middle", [0, -bw / 5, bw / 5]);
            if (!spot) return; // omit before overwriting (spec 07 §5)
            labelBuckets[3]!.push(
              text(lbl, { x: spot.x, y: spot.y, "font-size": spot.size, fill: ink, opacity: 0.8, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
            );
          });
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
        deferLabel(3, () => {
          const c = r.point ?? centroid(r.polygon!);
          const lbl = labelTextFor(model, e) ?? e.name!;
          const bw = Math.max(...r.polygon!.map((p) => p.x)) - Math.min(...r.polygon!.map((p) => p.x));
          const spot = placer.placeOrDrop(c.x, c.y, lbl, 11, "middle", [0, -bw / 5, bw / 5]);
          if (!spot) return; // omit before overwriting (spec 07 §5)
          labelBuckets[3]!.push(
            text(lbl, { x: spot.x, y: spot.y, "font-size": spot.size, fill: ink, opacity: 0.8, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
          );
        });
      }
      continue;
    }

    if (r.polyline) {
      if (r.ridge) {
        // A mountain range is TERRAIN with dimensions (owner review): the
        // belt — breadth from width= — is the navigational footprint, with
        // peak marks along the crest. Not a centerline of peaks.
        const beltW = r.beltW ?? 28;
        const lp = r.polyline;
        let total = 0;
        for (let i = 0; i < lp.length - 1; i++) total += Math.hypot(lp[i + 1]!.x - lp[i]!.x, lp[i + 1]!.y - lp[i]!.y);
        const count = Math.max(2, Math.floor(total / Math.max(14, beltW * 0.55)));
        const peaks: string[] = [];
        for (let i = 0; i <= count; i++) {
          const { p, dir } = alongAt(lp, i / count);
          // Deterministic stagger: peaks alternate off-crest so the belt
          // reads as a massif, not beads on a string.
          const side = i % 2 === 0 ? 1 : -1;
          const offAmt = (i % 3 === 0 ? 0 : beltW * 0.16) * side;
          const px = p.x + dir.y * offAmt;
          const py = p.y - dir.x * offAmt;
          const s = beltW * (i % 3 === 1 ? 0.16 : 0.22);
          peaks.push(`M${fmt(px - s)} ${fmt(py + s * 0.7)}L${fmt(px)} ${fmt(py - s)}L${fmt(px + s)} ${fmt(py + s * 0.7)}`);
        }
        layers.lines.push(
          el("g", { id: anchor }, titleEl,
            el("polyline", { points: pointsAttr(lp), fill: "none", stroke: wordFill, "stroke-width": beltW, opacity: 0.55, "stroke-linejoin": "round", "stroke-linecap": "round" }),
            el("path", { d: peaks.join(""), fill: "none", stroke: shade(wordFill), "stroke-width": 1.4, opacity: 0.85, "stroke-linejoin": "round", "stroke-linecap": "round" }),
          ),
        );
      } else {
        const stroke = theme.pathStroke(chain);
        // Coastlines are shorelines, not rivers: hairline by default (the
        // island outline weight the owner preferred), unless width= says so.
        const width = Number(pairOf(e.pairs, "width") ?? (chain.includes("coastline") ? 1.2 : 2));
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
        deferLabel(2, () => {
        const lbl = labelTextFor(model, e) ?? e.name!;
        // The label FOLLOWS the curve it names, but placement is arbitrated:
        // candidate slots along the line, above OR below it (a road that
        // follows a river labels on the opposite side), first free slot wins
        // via the shared placer — same collision discipline as battlemaps.
        let lp = r.polyline!;
        if (lp[0]!.x > lp[lp.length - 1]!.x) lp = [...lp].reverse();
        let pathLen = 0;
        for (let i = 0; i < lp.length - 1; i++) pathLen += Math.hypot(lp[i + 1]!.x - lp[i]!.x, lp[i + 1]!.y - lp[i]!.y);
        // The text CENTERS on its slot (text-anchor middle on the textPath),
        // and slots are clamped so the name always fits within the feature —
        // a late slot must never run the label off the end of a short river.
        // Every candidate is PROBED (never claimed) so a rejected slot leaves
        // no phantom boxes behind; shrink (floor 8px) before accepting any
        // overlap; least-bad below a road beats free-but-far — and a label
        // that would mostly cover other text is dropped, not scrawled.
        type Cand = { offset: number; above: boolean; size: number; boxes: { cx: number; top: number }[]; wpx: number };
        const candidatesAt = (size: number): Cand[] => {
          const wpx = lbl.length * size * 0.58;
          const halfFrac = Math.min(0.45, wpx / 2 / Math.max(pathLen, 1));
          const slots = [0.5, 0.32, 0.68, 0.18, 0.82, 0.08, 0.92]
            .map((s) => Math.min(1 - halfFrac, Math.max(halfFrac, s)))
            .filter((s, i, arr) => arr.indexOf(s) === i);
          const out: Cand[] = [];
          // Text offsets PERPENDICULAR to the path (tspan dy on a textPath),
          // so the boxes follow the path NORMAL — on a diagonal ridge a
          // vertically-lifted box would sit above where the glyphs actually
          // paint. Offsets clear the line's OWN obstacles (±3px thin, ±10px
          // ridge band): a label never self-rejects against the feature it
          // names, but DOES reject any OTHER line in the corridor.
          const off = r.ridge ? (r.beltW ?? 28) / 2 + 13 : 9.5;
          // Fine tiling (~12px per box): coarse boxes on a diagonal leave
          // diagonal gaps another diagonal label can slip through unnoticed
          // (the Broken Spine × Understone Way cross).
          const n = Math.max(3, Math.ceil(wpx / 12));
          for (const offset of slots) {
            for (const above of [true, false]) {
              const boxAt = (t: number): { cx: number; top: number } => {
                const { p, dir } = alongAt(lp, t);
                const s = above ? 1 : -1;
                return { cx: p.x + dir.y * off * s, top: p.y - dir.x * off * s - 4.5 };
              };
              const boxes: { cx: number; top: number }[] = [];
              for (let i = 0; i < n; i++) {
                const t = offset - halfFrac + ((i + 0.5) / n) * 2 * halfFrac;
                boxes.push(boxAt(Math.min(1, Math.max(0, t))));
              }
              out.push({ offset, above, size, wpx, boxes });
            }
          }
          return out;
        };
        const costOf = (c: Cand): number => c.boxes.reduce((sum, b) => sum + placer.boxCost(b.cx, b.top, c.wpx / c.boxes.length, 9), 0);
        let pick: Cand | null = null;
        for (let size = 10; size >= 8 && !pick; size--) {
          pick = candidatesAt(size).find((c) => costOf(c) === 0) ?? null;
        }
        if (!pick) {
          // A big label brushing an obstacle beats a shrunken migrated one:
          // largest size whose least-bad slot only brushes (≤12% of its own
          // area), then floor-size up to half-covered, then omit (spec 07 §5).
          const leastBad = (size: number): { c: Cand; score: number } => {
            const finalists = candidatesAt(size);
            let best = finalists[0]!;
            let bestScore = Infinity;
            finalists.forEach((c, i) => {
              const score = costOf(c) + i * size;
              if (score < bestScore) {
                bestScore = score;
                best = c;
              }
            });
            return { c: best, score: bestScore };
          };
          for (let size = 10; size >= 8 && !pick; size--) {
            const b = leastBad(size);
            if (b.score <= b.c.wpx * 9 * 0.12) pick = b.c;
          }
          if (!pick) {
            const b = leastBad(8);
            if (b.score > b.c.wpx * 9 * 0.5) return; // omit before overwriting
            pick = b.c;
          }
        }
        for (const b of pick!.boxes) placer.claimBox(b.cx, b.top, pick!.wpx / pick!.boxes.length, 9);
        const pid = `cdlp-${model.doc.docId}-${pathLabelCount++}`;
        const d = `M${fmt(lp[0]!.x)} ${fmt(lp[0]!.y)}` + lp.slice(1).map((pt) => `L${fmt(pt.x)} ${fmt(pt.y)}`).join("");
        const safe = lbl.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const weight = model.labelsMode === "keyed" ? ' font-weight="bold"' : "";
        labelBuckets[2]!.push(
          `<path id="${pid}" d="${d}" fill="none"/>` +
            `<text font-size="${pick!.size}" fill="${ink}" opacity="0.75" font-style="italic"${weight} text-anchor="middle" font-family="sans-serif">` +
            `<textPath href="#${pid}" startOffset="${fmt(pick!.offset * 100)}%"><tspan dy="${fmt(pick!.above ? (r.ridge ? -((r.beltW ?? 28) / 2 + 10) : -5) : r.ridge ? (r.beltW ?? 28) / 2 + 16 : 12)}">${safe}</tspan></textPath></text>`,
        );
        });
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
        const pt = r.point;
        // Within the point tier, importance = marker size: capitals claim
        // before towns before minor features, so when a name must shrink or
        // drop under density, it's the less-important one that gives way.
        deferLabel(1 + (24 - tier.font) / 100, () => {
          const spot = placer.placeBesideOrDrop(pt.x + tier.r + 3, pt.x - tier.r - 3, pt.y + 4, label, tier.font);
          if (!spot) return; // omit before overwriting (spec 07 §5)
          labelBuckets[1]!.push(
            // text-anchor is ALWAYS written: SVG's default is start, so an
            // omitted "middle" renders shifted right (the clipped Deepwatch).
            text(label, { x: spot.x, y: spot.y, "font-size": spot.size, "font-weight": tier.weight, fill: ink, "text-anchor": spot.anchor, "font-family": "sans-serif" }),
          );
        });
      }
    }
  }

  // ---------- realm boundaries and border states (#81) ----------
  // Each realm strokes its own boundary; border declarations restyle
  // stretches of it. Facing = outward normal (8 sectors, ties clockwise);
  // a facing word selects OPEN edges only (normal ray escapes without
  // re-entering the realm), `inner` the complement — a C-shape's north is
  // its very top, and the bay shores stay separately addressable.
  if (realmInfos.length) {
    const distToBoundary = (pt: XY, poly: XY[]): number => {
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
        best = Math.min(best, Math.hypot(a.x + t * dx - pt.x, a.y + t * dy - pt.y));
      }
      return best;
    };
    const SECTOR_OF: Record<string, number> = {
      n: 0, north: 0, ne: 1, northeast: 1, e: 2, east: 2, se: 3, southeast: 3,
      s: 4, south: 4, sw: 5, southwest: 5, w: 6, west: 6, nw: 7, northwest: 7,
    };
    interface EdgeInfo { mid: XY; nrm: XY; sector: number; open: boolean; abuts: Set<string> }
    const edgeInfos = new Map<string, EdgeInfo[]>();
    for (const info of realmInfos) {
      const poly = info.poly;
      const edges: EdgeInfo[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let nrm = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
        if (pip({ x: mid.x + nrm.x * 1.5, y: mid.y + nrm.y * 1.5 }, poly)) nrm = { x: -nrm.x, y: -nrm.y };
        // Open vs inner: does the outward ray re-enter the realm? Sampled
        // march (deterministic, tolerant of grazes counting as re-entry).
        let open = true;
        for (let t = 4; t <= 400; t += 4) {
          if (pip({ x: mid.x + nrm.x * t, y: mid.y + nrm.y * t }, poly)) {
            open = false;
            break;
          }
        }
        const deg = ((Math.atan2(nrm.x, -nrm.y) * 180) / Math.PI + 360) % 360;
        const sector = Math.floor(((deg + 22.5) % 360) / 45);
        const abuts = new Set<string>();
        for (const other of realmInfos) {
          if (other.key !== info.key && distToBoundary(mid, other.poly) < 2.5) abuts.add(other.key);
        }
        edges.push({ mid, nrm, sector, open, abuts });
      }
      edgeInfos.set(info.key, edges);
    }
    // Border declarations assign states, general → specific so the most
    // specific selector wins: blanket, two-realm seam, facing, along-feature.
    const stateOf = new Map<string, { state: string; decl: EntityNode }[]>();
    for (const info of realmInfos) stateOf.set(info.key, new Array(info.poly.length).fill(null));
    const realmByWord = new Map(realmInfos.map((info) => [info.key, info]));
    const parsed = borderDecls.map((decl) => {
      const realms = decl.flags.filter((word) => realmByWord.has(word));
      const compass = decl.flags.filter((word) => SECTOR_OF[word] !== undefined);
      const inner = decl.flags.includes("inner");
      const alongRefs = decl.placements
        .filter((p): p is Extract<typeof p, { kind: "relational"; form: "along" }> => p.kind === "relational" && p.form === "along")
        .map((p) => p.ref.value);
      const state = decl.flags.find((word) => !realmByWord.has(word) && SECTOR_OF[word] === undefined && word !== "inner") ?? "border";
      const specificity = alongRefs.length ? 3 : compass.length ? 2 : realms.length >= 2 ? 1 : 0;
      return { decl, realms, compass, inner, alongRefs, state, specificity };
    });
    parsed.sort((a, b) => a.specificity - b.specificity);
    for (const d of parsed) {
      const apply = (realmKey: string, pick: (edge: EdgeInfo, idx: number) => boolean): void => {
        const edges = edgeInfos.get(realmKey);
        const states = stateOf.get(realmKey);
        if (!edges || !states) return;
        edges.forEach((edge, idx) => {
          if (pick(edge, idx)) states[idx] = { state: d.state, decl: d.decl };
        });
      };
      if (d.realms.length >= 2) {
        const [a, b] = [d.realms[0]!, d.realms[1]!];
        apply(a, (edge) => edge.abuts.has(b));
        apply(b, (edge) => edge.abuts.has(a));
      } else if (d.realms.length === 1) {
        const key = d.realms[0]!;
        if (d.alongRefs.length) {
          const spans = realmByWord.get(key)?.spans ?? [];
          apply(key, (_edge, idx) =>
            spans.some((s) => d.alongRefs.includes(s.ref) && idx >= s.start && idx < s.end));
        } else if (d.compass.length) {
          const sectors = new Set(d.compass.map((word) => SECTOR_OF[word]!));
          apply(key, (edge) => sectors.has(edge.sector) && (d.inner ? !edge.open : edge.open));
        } else {
          apply(key, (edge) => edge.abuts.size === 0); // blanket: frontier only
        }
      }
    }
    // Stroke each realm's boundary in runs of constant state.
    for (const info of realmInfos) {
      const states = stateOf.get(info.key)!;
      const poly = info.poly;
      const n = poly.length;
      let i = 0;
      while (i < n) {
        const current = states[i];
        let j = i;
        while (j + 1 < n && states[j + 1]?.state === current?.state && states[j + 1]?.decl === current?.decl) j++;
        const pts = poly.slice(i, j + 2 > n ? n : j + 2);
        if (j + 2 > n) pts.push(poly[0]!);
        if (current) {
          // Not a road: a soft tinted band with an atlas dash-dot on top —
          // the classic political-boundary treatment, unmistakable at a
          // glance (owner: a thin solid stroke read as a river or road).
          const stateFill = theme.terrainFill([current.state]);
          const stroke = shade(stateFill);
          const title = gmTitleFor(model, current.decl);
          layers.lines.push(
            el("g", {}, title ? el("title", {}, title) : "",
              el("polyline", { points: pointsAttr(pts), fill: "none", stroke: stateFill, "stroke-width": 7, opacity: 0.25, "stroke-linejoin": "round", "stroke-linecap": "round" }),
              el("polyline", { points: pointsAttr(pts), fill: "none", stroke, "stroke-width": 1.6, "stroke-dasharray": "9 4 2 4", opacity: 0.9, "stroke-linejoin": "round", "stroke-linecap": "round" }),
            ),
          );
        } else if (!info.frame) {
          // Same visual language as stated seams (owner: ONE grammar for
          // borders) — the atlas dash-dot, just lighter and bandless.
          layers.realms.push(
            el("polyline", { points: pointsAttr(pts), fill: "none", stroke: shade(info.fill), "stroke-width": 1.2, "stroke-dasharray": "9 4 2 4", "stroke-opacity": 0.55, "stroke-linejoin": "round" }),
          );
        }
        i = j + 1;
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
      // The author DECLARED this box — the text fits it, whatever it takes:
      // an oversized sprawl must never overflow the map or its neighbors.
      const spanLen = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 40);
      const upper = name.toUpperCase();
      const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
      deferLabel(0, () => {
        const sprawlText = (tx: number, ty: number, size: number, spacing: number): string =>
          text(upper, {
            x: tx, y: ty, "font-size": size, "letter-spacing": spacing, fill: "#5a7a96", opacity: 0.85,
            "text-anchor": "middle", "font-family": "sans-serif",
            transform: vertical ? `rotate(90 ${fmt(tx)} ${fmt(ty)})` : undefined,
          });
        // Repeat rather than cross (spec 07 §5): measure the stretch of the
        // span actually built over — terrain areas and point features whose
        // geometry crosses the strip (the water body itself and see-through
        // realm tints don't count) — and center one copy in EACH real clear
        // stretch, sized to fill it. Fixed fractions crowded the archipelago
        // even when both sides had room to spare.
        const s0 = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
        const s1 = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
        const cross = vertical ? cx : cy;
        let occ0 = Infinity;
        let occ1 = -Infinity;
        for (const it of items) {
          if (it.e.section === "water" || it.e.archetype === "zone") continue;
          const consider = (lo: number, hi: number, cLo: number, cHi: number): void => {
            if (cHi < cross - 16 || cLo > cross + 16) return;
            occ0 = Math.min(occ0, lo);
            occ1 = Math.max(occ1, hi);
          };
          if (it.r.polygon) {
            const xs = it.r.polygon.map((p) => p.x);
            const ys = it.r.polygon.map((p) => p.y);
            if (vertical) consider(Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs));
            else consider(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys));
          } else if (it.r.point) {
            const p = it.r.point;
            if (vertical) consider(p.y - 6, p.y + 6, p.x - 6, p.x + 6);
            else consider(p.x - 6, p.x + 6, p.y - 6, p.y + 6);
          }
        }
        occ0 = Math.max(s0, occ0 - 10);
        occ1 = Math.min(s1, occ1 + 10);
        // The room is the WATER, not just the declared range: the named
        // body's own geometry extends the clear stretches toward the map
        // edges, so a split name grows away from the center instead of
        // huddling small inside the author's hint box.
        const targetPoly = resolved.get(key)?.polygon;
        let e0 = s0;
        let e1 = s1;
        if (targetPoly) {
          const vals = targetPoly.map((p) => (vertical ? p.y : p.x));
          e0 = Math.min(e0, Math.max(12, Math.min(...vals)));
          e1 = Math.max(e1, Math.min((vertical ? h : w) - 12, Math.max(...vals)));
        }
        const stretches: { lo: number; hi: number }[] = [];
        if (occ0 <= occ1 && spanLen >= 200) {
          for (const st of [{ lo: e0, hi: occ0 }, { lo: occ1, hi: e1 }]) {
            if (st.hi - st.lo >= 60) stretches.push(st);
          }
        }
        if (stretches.length) {
          // Each copy sits AT the center of its clear stretch, sized to
          // ~60% of the tighter stretch (both copies match — same body,
          // same name, same size), with clear water kept on both sides.
          const fitLen = Math.min(...stretches.map((st) => st.hi - st.lo)) * 0.6;
          const { size, spacing } = fitLabel(upper, fitLen, 16, 8);
          // The block covers the DRAWN column, not the stretch fraction —
          // a spilled glyph outside its block is invisible to everyone
          // else's collision checks (the "A" on the Sundering Stone).
          const halfL = (upper.length * (size * 0.58 + spacing)) / 2 + 3;
          for (const st of stretches) {
            const m = (st.lo + st.hi) / 2;
            const tx = vertical ? cx : m;
            const ty = vertical ? m : cy;
            if (vertical) placer.block(tx - size, ty - halfL, size * 2, halfL * 2, 3);
            else placer.block(tx - halfL, ty - size, halfL * 2, size * 2, 3);
            labelBuckets[0]!.push(sprawlText(tx, ty, size, spacing));
          }
          return;
        }
        // Author-placed: fixed, but REGISTERED so movable labels avoid it.
        const { size, spacing } = fitLabel(upper, spanLen, 16, 8);
        if (vertical) placer.block(cx - size, cy - spanLen / 2, size * 2, spanLen, 3);
        else placer.block(cx - spanLen / 2, cy - size, spanLen, size * 2, 3);
        labelBuckets[0]!.push(sprawlText(cx, cy, size, spacing));
      });
    } else if (o.hint.kind === "at" && o.hint.target.kind === "point") {
      const p = toXY(o.hint.target);
      deferLabel(0, () => {
        placer.block(p.x - name.length * 3.2, p.y - 10, name.length * 6.4, 14, 3);
        labelBuckets[0]!.push(text(name, { x: p.x, y: p.y, "font-size": 11, fill: ink, "text-anchor": "middle", "font-family": "sans-serif" }));
      });
    } else if (o.hint.kind === "side") {
      const base = resolved.get(key)?.point;
      if (base) {
        const vec = COMPASS_VECTORS[o.hint.compass]!;
        const lx = base.x + vec.x * 16;
        const ly = base.y + vec.y * 16;
        deferLabel(0, () => {
          placer.block(lx - name.length * 3.2, ly - 10, name.length * 6.4, 14, 3);
          labelBuckets[0]!.push(text(name, { x: lx, y: ly, "font-size": 11, fill: ink, "text-anchor": "middle", "font-family": "sans-serif" }));
        });
      }
    }
  }

  // Claim in priority order (stable within a tier); paint big faint names
  // beneath small precise ones, author overrides on top.
  labelJobs.sort((a, b) => a.priority - b.priority);
  for (const job of labelJobs) job.run();
  layers.labels.push(...labelBuckets[4]!, ...labelBuckets[3]!, ...labelBuckets[2]!, ...labelBuckets[1]!, ...labelBuckets[0]!);

  body.push(...layers.water, ...layers.realms, ...layers.areas, ...layers.lines, ...layers.points, ...layers.labels);
}

/**
 * Shrink a letter-spaced label until it fits `maxPx` (floor 8px, spacing
 * scaled proportionally) — no label is too big to exist on the map.
 */
function fitLabel(textStr: string, maxPx: number, baseSize: number, baseSpacing: number): { size: number; spacing: number } {
  // Prefer a BIGGER font with tighter tracking over a smaller font with
  // airy tracking: at each size, natural spacing if it fits, else the
  // spacing the box allows (down to 0.5) before dropping a size. The
  // promise is the text FITS — and grows when the space does.
  const perChar = maxPx / textStr.length;
  for (let size = baseSize; size > 8; size--) {
    const natural = (baseSpacing * size) / baseSize;
    if (textStr.length * (size * 0.58 + natural) <= maxPx) return { size, spacing: natural };
    const needed = perChar - size * 0.58;
    if (needed >= 0.5) return { size, spacing: needed };
  }
  return { size: 8, spacing: Math.max(0.5, perChar - 8 * 0.58) };
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
