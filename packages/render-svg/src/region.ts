/**
 * Region-map renderer: gridless world-unit coordinates, relational placement
 * resolution (mirroring the parser's order-bounded guarantee), organic seeded
 * geometry, half-plane water, and derived labels (spec 05 §2, 07).
 *
 * Rendering is two-pass: all positions resolve first (so every marker is a
 * known obstacle), then labels place with full knowledge — a label can never
 * sit on a marker declared later in the document.
 */

import type { EntityNode, Placement, Point, Ref } from "@chartdown/core";
import { slugify } from "@chartdown/core";
import { SideLabelPlacer } from "./labels";
import { ASPECT, deformCurve, type Morph, type PlacedFeature } from "./morphology";
import { anchorAttr, entityAnchor, gmTitleFor, labelsOn, labelTextFor, pairOf, type Model } from "./model";
import { hasTierGlyph, INK, tierFor, wordTint } from "./theme";
import {
  catmullRom, COMPASS_VECTORS, el, esc, fmt, hashSeed, hashString, inkStroke, measureToNumber,
  nearestOnPolyline, organicMass, pip, pointsAttr, QUANTUM, rng, subPolylineBetween, svgTitle, text, type XY,
  shade,} from "./util";
import { CHANNEL_FLOOR, narrowChannels } from "./channel";

interface Resolved {
  point?: XY;
  polyline?: XY[];
  polygon?: XY[];
  radius?: number;
  ridge?: boolean;
  /** Massif breadth in px (from `width=`, a measure) — a ridge is a BELT, not a centerline. */
  beltW?: number;
  /**
   * `polygon` is the half-plane CLIPPED TO THE MAP FIELD — where the water is,
   * is where the land is not, and that is geometry rather than ink (#355).
   * Filled by the sweep at the end of pass 1, once every course it could be
   * cut against is final, so it is present on every resolved half-plane.
   */
  halfPlane?: { compass: string; of: XY[]; refKey?: string; polygon?: XY[] };
  /** Vertex-index ranges of the polygon that were spliced from a followed feature (#81). */
  alongSpans?: { ref: string; refKey?: string; start: number; end: number }[];
}



/** An entity's stable key: its anchor, else a line-addressed placeholder. */
const keyOf = (e: EntityNode): string => entityAnchor(e) ?? `@anon-${e.line}`;
/** A map coordinate an author can paste back into the document. */
const round1 = (n: number): string => String(Math.round(n * 10) / 10);
/** Two points the same to within a hair — geometry is compared, not identity. */
const near = (a: XY, b: XY): boolean => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

interface Item {
  e: EntityNode;
  r: Resolved;
  chain: string[];
}

/**
 * What pass 1 produces. `items` is the resolved geometry in document order;
 * the rest are the lookups pass 2 reads it through.
 */
interface RegionResolve {
  items: Item[];
  resolved: Map<string, Resolved>;
  byName: Map<string, string>;
  chainByKey: Map<string, string[]>;
  mapUnit: string;
  toXY: (p: Point) => XY;
  lookup: (ref: Ref) => Resolved | undefined;
  assembleWaterBoundary: (pts: XY[]) => XY[];
}

/**
 * PASS 1 — resolve every entity's geometry, with nothing about ink.
 *
 * Hoisted out of `renderRegion` whole (#355). The two-pass shape was always
 * there in that function's header comment; this makes the first pass a thing
 * with a name, so a caller that wants the geometry without the drawing can
 * have it. It consults no theme, pushes no markup and places no label — that
 * was already true of this code, which is why the move is an extraction and
 * not a disentangling.
 */
function resolveRegionGeometry(
  model: Model,
  size: { w: number; h: number; scale: number },
  diagnostics: { severity: "error" | "warning"; line: number; message: string }[],
): RegionResolve {
  const { w, h, scale } = size;
  // No shared noise stream: every organic shape keys on its OWN geometry
  // (owner review caught the defect — one stream meant adding a forest
  // reshaped every blob and river declared after it).
  const resolved = new Map<string, Resolved>();
  const byName = new Map<string, string>();
  /** Direction toward declared water (from e.g. `sea : west of coast`), for landward nudges. */
  let waterVector: XY | null = null;

  const lookup = (ref: Ref): Resolved | undefined =>
    resolved.get(ref.form === "id" ? ref.value : (byName.get(ref.value) ?? slugify(ref.value)));
  const toXY = (p: Point): XY => ({ x: p.x * scale, y: p.y * scale });
  /** The unit `extent:` was written in, so a reported distance carries it. */
  const mapUnit = /^(\d+)x(\d+)([a-z]*)$/.exec(model.header.get("extent") ?? "")?.[3] ?? "";

  // ---------- placed morphology (#93, spec 05 §4, ADR 0023) ----------
  //
  // Indexed from the PLACEMENTS before anything resolves, because a feature's
  // geometry needs only its own data — kind, anchor, size — and the host's
  // curve. Deforming inside the host's own resolution is what makes the rest
  // of the pipeline follow for free: an `along`-following border splices the
  // host's polyline during the same pass, so a realm bounded by a coast picks
  // up that coast's capes without knowing they exist.
  const refText = (ref: Ref): string => ref.value;
  /** Which way the sea lies from a given line, from the water's own half-plane. */
  const seawardByHost = new Map<string, XY>();
  /**
   * Rough centres of any BOUNDED water body, for coasts no half-plane names.
   *
   * An enclosed sea has no side to be on (#157): Puget Sound, the Baltic, the
   * Mediterranean and most interesting water on a continent lie BETWEEN two
   * shores, and a half-plane can only describe an open ocean. The idiom that
   * draws them — `sea : area (…) along westshore (…) along eastshore` — states
   * no direction at all, so every feature on either coast warned and the map
   * could not be made.
   *
   * The literal points of that declaration are enough. Their centroid is
   * inside the water by construction, and only the SIGN of the dot product
   * with the coast's normal is needed — so an approximate direction settles it
   * exactly. Taken from the declaration rather than the resolved polygon
   * because the polygon FOLLOWS the coast, and the coast is what is being
   * resolved: reading it there would be circular.
   */
  /**
   * Declared control points per line id/name, for orienting a detached feature
   * along its host (#159). From the DECLARATION rather than the resolved
   * curve, for the same reason as `waterCentres`: an island may be written
   * before its coast, and only a direction is needed.
   */
  const hostControls = new Map<string, XY[]>();
  for (const e of model.entities) {
    const pts: XY[] = [];
    for (const p of e.placements) {
      if (p.kind === "shape") pts.push(...p.args.filter((a): a is Point => a.kind === "point").map(toXY));
      else if (p.kind === "relational" && p.form === "from-to") {
        for (const ep of [p.from, ...p.via, p.to]) {
          const at = "at" in ep ? ep.at : ep;
          if (at && (at as { kind?: string }).kind === "point") pts.push(toXY(at as unknown as Point));
        }
      }
    }
    if (pts.length >= 2) for (const k of [...e.ids, ...(e.name ? [e.name] : [])]) hostControls.set(k, pts);
  }

  /**
   * PROVISIONAL WATER, for answering "which side" LOCALLY (#178).
   *
   * The side is a property of a place on a shore, and it was being answered by
   * one vector for a whole body — a compass direction, or a bearing to the
   * nearest water's centroid — reduced to a sign by a dot product against the
   * local normal. That is inverted wherever a shore wraps a peninsula, right on
   * one limb and backwards on the next, and where the coast turns square to the
   * vector the dot product is near zero and the answer is arithmetic noise. A
   * generated run has nothing to contradict a wrong answer, so it does not fold
   * and is not reported: it simply draws the bay on the wrong side of the land.
   *
   * Asked properly it is a point-in-polygon test, which needs the water's
   * outline — and that is built long after features are sited, because an
   * `along`-spliced sea follows the DEFORMED course. The cycle breaks on an
   * observation: which side of a shore the sea lies on does not depend on the
   * bays cut into it. So this builds the body from the host's UNDEFORMED
   * course, which needs only what the author declared, and the answer is exact
   * for the question being asked.
   */
  const undeformed = (key: string): XY[] | null => {
    const controls = hostControls.get(key);
    return controls && controls.length >= 2 ? catmullRom(controls, 8) : null;
  };

  /** Water bodies that touch this host, as polygons, from declarations alone. */
  const provisionalWater = (hostKey: string): XY[][] => {
    const course = undeformed(hostKey);
    if (!course) return [];
    const out: XY[][] = [];
    for (const e of model.entities) {
      if (e.section !== "water") continue;
      for (const p of e.placements) {
        // `sea : east of shore` — the half-plane FOLLOWS the coast and closes
        // on the compass side, so it is the true region rather than a bearing.
        if (p.kind === "relational" && p.form === "side-of" && refText(p.ref) === hostKey) {
          out.push(halfPlanePolygon({ compass: p.compass, of: course }, w, h));
          continue;
        }
        // `sea : area (…) along shore (…)` — the enclosed form (#157). Its
        // boundary already contains this host's course; splicing the whole
        // course in where the `along` sits is enough to say which side it
        // encloses, which is all this is asked for.
        if (p.kind !== "shape" || p.shape !== "area") continue;
        const follows = p.args.some((a) => a.kind === "relational" && a.form === "along" && refText(a.ref) === hostKey);
        if (!follows) continue;
        const ring: XY[] = [];
        for (const arg of p.args) {
          if (arg.kind === "point") ring.push(toXY(arg));
          else if (arg.kind === "relational" && arg.form === "along" && refText(arg.ref) === hostKey) {
            const head = ring[ring.length - 1];
            const forward = !head
              || Math.hypot(course[0]!.x - head.x, course[0]!.y - head.y)
                <= Math.hypot(course[course.length - 1]!.x - head.x, course[course.length - 1]!.y - head.y);
            ring.push(...(forward ? course : [...course].reverse()));
          }
        }
        if (ring.length >= 3) out.push(ring);
      }
    }
    return out;
  };

  /**
   * The seaward unit normal at a point on a host, or null where the map does
   * not say. Null is not a licence to guess — spec 05 §4 requires it reported.
   */
  const localSeaward = (hostKey: string, at: XY): XY | "ambiguous" | null => {
    const course = undeformed(hostKey);
    const bodies = provisionalWater(hostKey);
    // NO BODY FOUND is not the same as CANNOT TELL. The first means this
    // routine had nothing to look at — water spelled some way it does not
    // reconstruct — and the older global answer is still the best available.
    // The second means the declaration genuinely does not decide this spot,
    // and spec 05 §4 requires that reported rather than guessed.
    if (!course || bodies.length === 0) return null;
    // The normal where the anchor actually sits, not an average of the coast —
    // and taken at the nearest point ON the course rather than at its nearest
    // VERTEX (#178). A `from … to` course with no via points has two vertices,
    // so the nearest one to any anchor is an END of the coast: the probe then
    // sampled the water at a corner of the map instead of beside the feature,
    // and read "the map does not say" where it says perfectly well. Measured on
    // #154's own fixture, a cape and a bay on one straight shore with one
    // half-plane sea disagreed — the cape resolved and the bay did not.
    let on = course[0]!;
    let seg = { x: 1, y: 0 };
    let bestD = Infinity;
    for (let i = 1; i < course.length; i++) {
      const a = course[i - 1]!;
      const b = course[i]!;
      const p = nearestOnSegment(a, b, at);
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < bestD && len > 0) {
        bestD = d;
        on = p;
        seg = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      }
    }
    if (!Number.isFinite(bestD)) return null;
    const n = { x: -seg.y, y: seg.x };
    // PROBED FROM THE SHORE, not from the anchor. An author places an anchor
    // by eye and it lands near the coast rather than on it; probing from there
    // can put both samples on the same side of the water's edge, which reads
    // as "the map does not say" when the map says perfectly well.
    // Far enough off the line to clear its own sampling, near enough to stay
    // local on a shore that turns.
    const step = Math.max(w, h) / 400;
    const wet = (s: number): boolean =>
      bodies.some((body) => pip({ x: on.x + n.x * s, y: on.y + n.y * s }, body));
    const plus = wet(step);
    const minus = wet(-step);
    if (plus === minus) return "ambiguous";
    return plus ? n : { x: -n.x, y: -n.y };
  };

  const waterCentres: XY[] = [];
  for (const e of model.entities) {
    if (e.section !== "water") continue;
    for (const p of e.placements) {
      if (p.kind === "relational" && p.form === "side-of") {
        const vec = COMPASS_VECTORS[p.compass];
        if (vec) seawardByHost.set(refText(p.ref), vec);
        continue;
      }
      if (p.kind !== "shape" || (p.shape !== "area" && p.shape !== "blob")) continue;
      const pts = p.args.filter((a): a is Point => a.kind === "point").map(toXY);
      if (pts.length >= 3) {
        waterCentres.push({
          x: pts.reduce((t, q) => t + q.x, 0) / pts.length,
          y: pts.reduce((t, q) => t + q.y, 0) / pts.length,
        });
      }
    }
  }
  interface PlacedRef {
    f: PlacedFeature;
    /** How the author names it — a name, else an id, else the bare word. */
    label: string;
    word: string;
    /** Exactly as written, unit and all. */
    sizeText: string;
    morph: Morph;
    line: number;
    /** Every name this feature answers to, so an ARM can be hosted on it (#170). */
    keys: string[];
    /** The host it was declared on, for resolving an arm's water side (#170). */
    host: string;
  }
  const featuresByHost = new Map<string, PlacedRef[]>();
  for (const e of model.entities) {
    const morph = model.facetOf(e.typeWord, "morph") as Morph | undefined;
    if (!morph || morph === "detached") continue;
    for (const p of e.placements) {
      if (p.kind !== "relational" || p.form !== "on" || !p.point) continue;
      const host = refText(p.ref);
      const sizeText = pairOf(e.pairs, "size");
      if (sizeText === undefined) {
        diagnostics.push({ severity: "warning", line: e.line, message: `'${e.typeWord}' on '${host}' has no size= — a placed feature needs an extent along its host to be drawn (spec 05 §4)` });
        continue;
      }
      // The water's own half-plane if it has one; otherwise the nearest
      // bounded water body, which is how an enclosed sea says it (#157).
      const anchorXY = toXY(p.point);
      // LOCAL FIRST (#178). Where the water's own outline settles the side at
      // this anchor, that answer is exact and no global vector can improve on
      // it — including for a half-plane, whose compass direction is undecidable
      // wherever the coast happens to run parallel to it.
      const local = localSeaward(host, anchorXY);
      // AND WHERE IT CANNOT TELL, THE FEATURE IS REFUSED (#178). Warning and
      // then drawing on the global vector anyway is the worst of both: the
      // message says the map does not decide this spot, and the shape is
      // placed as though it did. Measured on a shoreline wrapping a peninsula
      // with `sea : east of shore`, that drew a bay eight miles INTO THE SEA on
      // the western limb — a render that looks finished and is wrong, which is
      // the silent plausibility spec 05 §4 requires be reported instead.
      //
      // Only where the feature needs the answer. A declared centerline states
      // its own direction (#175), so an ambiguous coast is no obstacle to a
      // feature that says where it runs — and saying so is one of the two fixes
      // worth naming.
      const statesCourse = (p.via?.length ?? 0) > 0;
      if (local === "ambiguous" && !statesCourse) {
        const named = e.name === undefined ? `'${e.typeWord}'` : `'${e.name}' (${e.typeWord})`;
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `${named} cannot be drawn on '${host}' — the water's declaration does not say which side of '${host}' it lies on here: both sides read the same, so which way this faces would be a guess. Declare the sea as an area following its shores, or state the feature's own course with via (spec 05 §4)`,
        });
        continue;
      }
      let seaward = (local && local !== "ambiguous" ? local : undefined) ?? seawardByHost.get(host);
      if (!seaward && waterCentres.length > 0) {
        let best = waterCentres[0]!;
        for (const c of waterCentres) {
          if (Math.hypot(c.x - anchorXY.x, c.y - anchorXY.y) < Math.hypot(best.x - anchorXY.x, best.y - anchorXY.y)) best = c;
        }
        const dx = best.x - anchorXY.x;
        const dy = best.y - anchorXY.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-9) seaward = { x: dx / len, y: dy / len };
      }
      // An ARM hosted on another feature takes its side from that feature, not
      // from the map (#170) — resolved in the pass below, once every feature is
      // known, so declaration order does not decide whether it works. Warning
      // here would send an author to write `sea : west of hood`, which is not a
      // sentence about Hood Canal: the canal IS water.
      const hostedOnFeature = model.entities.some(
        (other) => other !== e && [...other.ids, ...(other.name ? [other.name] : [])].includes(host)
          && model.facetOf(other.typeWord, "morph") !== undefined,
      );
      if (!seaward && !hostedOnFeature) {
        diagnostics.push({ severity: "warning", line: e.line, message: `nothing on this map says which side of '${host}' the water is on, so '${e.typeWord}' cannot know which way to face — declare an open coast's sea with 'sea : west of ${host}', or an enclosed one as an area following its shores (spec 05 §4)` });
      }
      // How far across the host it reaches, as a multiple of size= — the thing
      // that makes a fjord long and narrow where a cove is a shallow scoop.
      // From the vocabulary, so derivation carries it (ADR 0016).
      const numericFacet = (key: string): number | undefined => {
        const text = pairOf(e.pairs, key) ?? model.facetOf(e.typeWord, key);
        if (text === undefined) return undefined;
        const value = Number(text);
        if (!Number.isFinite(value)) {
          diagnostics.push({ severity: "warning", line: e.line, message: `'${key}=${text}' is not a number — the vocabulary default applies (spec 05 §4)` });
          return undefined;
        }
        return value;
      };
      const reach = numericFacet("reach");
      const taper = numericFacet("taper");
      // A DECLARED CENTERLINE REPLACES THE GENERATED ONE (#169). `reach=`
      // generates a straight run of `size × reach`; `via` states the line the
      // feature actually follows, and its own length is then the depth. The
      // two are alternatives, so declaring both is an error for the same
      // reason an outline and the dials are on a detached feature (ADR 0026):
      // honouring either means discarding the other.
      // A control may state the channel's width there (#190). Carried in
      // rendered units alongside the point, so the ribbon can follow a profile
      // instead of narrowing monotonically from the mouth.
      const via = p.via?.map((c) => ({
        ...toXY(c),
        ...(c.width === undefined ? {} : { width: measureToNumber(c.width) * scale }),
      }));
      if (via && pairOf(e.pairs, "reach") !== undefined) {
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `'${e.name ?? e.typeWord}' declares a centerline with 'via' AND reach= — 'via' says where the feature runs and reach= generates a straight run instead, so one would have to be discarded. Drop reach=, or drop the via points (spec 05 §4)`,
        });
        continue;
      }
      const entry: PlacedRef = {
        f: { morph, anchor: anchorXY, size: measureToNumber(sizeText) * scale, ...(seaward ? { seaward } : {}), ...(reach !== undefined ? { reach } : {}), ...(taper !== undefined ? { taper } : {}), ...(via && via.length > 0 ? { via } : {}) },
        // The ENTITY as the author would recognise it: three `sound`s on one
        // coast all reported as "'sound'" gave nothing to tell them apart
        // (#156). And `sizeText` is carried verbatim rather than recomputed
        // from pixels, because rounding it turned `size=1.5mi` into `size=2`
        // and read as though the edit had not been saved.
        label: e.name ?? e.ids[0] ?? e.typeWord ?? "feature",
        word: e.typeWord ?? "feature",
        sizeText,
        morph,
        line: e.line,
        keys: [...e.ids, ...(e.name ? [e.name] : [])],
        host,
      };
      const list = featuresByHost.get(host) ?? [];
      list.push(entry);
      featuresByHost.set(host, list);
    }
  }
  /**
   * The axis of the CHANNEL this point sits in, if it sits in one (#167).
   *
   * An island in an inlet lies ALONG the inlet — Hartstene, Squaxin, McNeil and
   * Anderson each parallel the channels either side of them, because the same
   * ice cut the island and the water. Taking the long axis from the HOST LINE
   * instead (#159) reads the coastline's direction, which runs across the inlet
   * rather than along it, so an island placed in one came out as a bar damming
   * the channel instead of an island splitting it.
   *
   * Read from the INLET'S OWN DECLARATION rather than from the rendered water.
   * Measuring the drawn sea would give the same answer here — its principal
   * axis inside this inlet comes out along the channel, and open water is
   * detectably round rather than elongated — but it would make an island's
   * shape depend on rendered geometry, so an unrelated edit to the coastline
   * could silently re-point an island a campaign had already named. ADR 0023
   * requires a feature's geometry to be a pure function of the placed data, and
   * two declarations are exactly that.
   */
  const channelAxisAt = (pt: XY): number | undefined => {
    let best: { axis: XY; area: number; anchor: XY; line: number } | undefined;
    for (const entry of [...featuresByHost.values()].flat()) {
      // Only water divides: a jut is land, and an island cannot sit inside one.
      if (entry.morph !== "bite") continue;
      const seaward = entry.f.seaward;
      if (!seaward) continue;
      // A bite runs LANDWARD — away from the water that named its direction.
      const axis = { x: -seaward.x, y: -seaward.y };
      const depth = entry.f.size * (entry.f.reach ?? ASPECT);
      const dx = pt.x - entry.f.anchor.x;
      const dy = pt.y - entry.f.anchor.y;
      const along = dx * axis.x + dy * axis.y;
      const across = dx * -axis.y + dy * axis.x;
      if (along < 0 || along > depth || Math.abs(across) > entry.f.size / 2) continue;
      const area = entry.f.size * depth;
      // The SMALLEST containing channel wins — an inlet inside a sound is the
      // more specific statement about where this island actually is. Ties are
      // broken on declared position and then line, so the answer never depends
      // on map iteration order.
      const better = !best || area < best.area ||
        (area === best.area && (entry.f.anchor.x - best.anchor.x || entry.f.anchor.y - best.anchor.y || entry.line - best.line) < 0);
      if (better) best = { axis, area, anchor: entry.f.anchor, line: entry.line };
    }
    return best ? Math.atan2(best.axis.y, best.axis.x) : undefined;
  };

  /**
   * AN ARM TAKES ITS WATER SIDE FROM THE ARM IT HANGS OFF (#170).
   *
   * Every secondary arm of Puget Sound hangs off a primary one — Dabob and
   * Quilcene off Hood Canal, Dyes off Sinclair, Oakland off Hammersley — and
   * none of them could say which way to face, because the map declares a side
   * for the COAST and `sea : west of hood` is not a sentence about a canal.
   * The canal is water, and the arm's water is the canal, so the side is the
   * direction from the arm's mouth toward its host's own centerline. This is
   * ADR 0024's "ask the containing feature" asked by a bite instead of an
   * island.
   *
   * Resolved AFTER the whole pre-scan, so it does not matter whether the canal
   * was declared before or after the bay hanging off it.
   */
  const refused = new Set<PlacedRef>();
  for (const list of featuresByHost.values()) {
    for (const arm of list) {
      const host = [...featuresByHost.values()].flat().find((h) => h.keys.includes(arm.host));
      // AND THE HOST'S ANSWER WINS, where there is a host. This used to run
      // only for an arm that had no side yet, which meant the map's global
      // guess — the direction to the nearest water body's centre — got there
      // first and the host was never asked. §4 requires the opposite: an arm's
      // water side comes from its host, because the canal IS the arm's water
      // and no vector aimed at a distant sea is a sentence about it.
      // A DECLARED CENTERLINE IS ENOUGH ON ITS OWN (#175). Only the GENERATED
      // run needs the host's water side, to know which way to leave the shore;
      // where the host states its course, that course already is the answer.
      // Requiring a side either way meant an arm on a canal that says exactly
      // where it runs was dropped because the map could not work out something
      // the arm never needed — which is how Dabob Bay came to depend on how the
      // sea two features away happened to be spelled.
      const stated = host?.f.via && host.f.via.length > 0;
      if (!host || (!stated && !host.f.seaward)) continue;
      // The host's centerline: its mouth, then either its declared controls or
      // a straight run landward — away from the water that gave it ITS side.
      const back = { x: -(host.f.seaward?.x ?? 0), y: -(host.f.seaward?.y ?? 0) };
      const depth = host.f.size * (host.f.reach ?? ASPECT);
      const line = stated
        ? [host.f.anchor, ...host.f.via!]
        : [host.f.anchor, { x: host.f.anchor.x + back.x * depth, y: host.f.anchor.y + back.y * depth }];
      let best: XY | null = null;
      let bestD = Infinity;
      let along: XY | null = null;
      for (let i = 1; i < line.length; i++) {
        const p = nearestOnSegment(line[i - 1]!, line[i]!, arm.f.anchor);
        const d = Math.hypot(p.x - arm.f.anchor.x, p.y - arm.f.anchor.y);
        if (d < bestD) {
          bestD = d;
          best = p;
          const dx = line[i]!.x - line[i - 1]!.x;
          const dy = line[i]!.y - line[i - 1]!.y;
          const len = Math.hypot(dx, dy);
          along = len > 0 ? { x: dx / len, y: dy / len } : null;
        }
      }
      if (!best) continue;
      // AN ANCHOR ON THE HOST'S OWN CENTERLINE DOES NOT SAY WHICH BANK
      // (#191, ADR 0031). The side is the direction from the anchor toward that
      // centerline, so on the line itself there is no direction — and the arm
      // was left with no side at all, its bank decided by which of the host's
      // two rails a vertex rounding happened to pick. Measured on a canal, the
      // two rails sat 0.752mi from the anchor apiece and answered differently:
      // one bank drew, the other drove the bite into the canal and was refused
      // as a fold. The anchor an author reaches for is one of the host's own
      // `via` controls, because that is the point on the canal they mean.
      //
      // The threshold is float noise and nothing more. Swept perpendicular to
      // a 2mi canal, an anchor off the centerline by 0.001mi — five feet on a
      // hundred-mile map — already answers stably and the same way at every
      // distance out to the bank. The coordinate states a side as soon as it
      // is not on the line, so refusing any wider would refuse documents that
      // do say which bank they mean.
      if (bestD <= Math.max(host.f.size, 1) * 1e-9) {
        const named = arm.label === arm.word ? `'${arm.word}'` : `'${arm.label}' (${arm.word})`;
        // Both banks, because naming one would be the silent pick this refuses
        // — offered as positions the author chooses between, not as a
        // suggestion the renderer has validated.
        const half = host.f.size / 2;
        const banks = along
          ? [1, -1].map((s) =>
              `(${round1((best!.x - along!.y * half * s) / scale)},${round1((best!.y + along!.x * half * s) / scale)})`,
            ).join(" or ")
          : "either side of it";
        diagnostics.push({
          severity: "error",
          line: arm.line,
          message: `${named} cannot be drawn on '${arm.host}' — its anchor lies on the centerline of '${arm.host}', which does not say which bank it leaves from. Move it to one: about ${banks} (spec 05 §4)`,
        });
        refused.add(arm);
        continue;
      }
      arm.f.seaward = { x: (best.x - arm.f.anchor.x) / bestD, y: (best.y - arm.f.anchor.y) / bestD };
    }
  }
  // Dropped rather than drawn without a side: a bank the document did not
  // choose is not better for being drawn without complaint (ADR 0031).
  for (const [key, list] of featuresByHost) {
    if (list.some((x) => refused.has(x))) featuresByHost.set(key, list.filter((x) => !refused.has(x)));
  }

  /**
   * The midpoint of a placed feature's own body (#171).
   *
   * Reconstructed from the DECLARED data — anchor, size, reach, via, and the
   * water's side — rather than from the drawn shape, because the label is
   * resolved before any course is finished. That also keeps it a pure function
   * of the declaration, as ADR 0023 requires of everything else about a
   * feature. Returns null for a word that is not a jut or a bite, whose anchor
   * already is its position.
   */
  const featureLabelPoint = (e: EntityNode, anchor: XY, via: XY[] | undefined, hostKey: string): XY | null => {
    const morph = model.facetOf(e.typeWord, "morph");
    if (morph !== "jut" && morph !== "bite") return null;
    if (via && via.length > 0) {
      // Halfway along the declared centerline by arc length — spec 07 §5's
      // rule for a line feature, applied to the line this feature runs along.
      const line = [anchor, ...via];
      const lengths = line.map((p, i) => (i === 0 ? 0 : Math.hypot(p.x - line[i - 1]!.x, p.y - line[i - 1]!.y)));
      const total = lengths.reduce((s, d) => s + d, 0);
      let walked = 0;
      for (let i = 1; i < line.length; i++) {
        if (walked + lengths[i]! >= total / 2) {
          const k = lengths[i]! > 0 ? (total / 2 - walked) / lengths[i]! : 0;
          return { x: line[i - 1]!.x + (line[i]!.x - line[i - 1]!.x) * k, y: line[i - 1]!.y + (line[i]!.y - line[i - 1]!.y) * k };
        }
        walked += lengths[i]!;
      }
      return line[line.length - 1]!;
    }
    const sizeText = pairOf(e.pairs, "size");
    // The HOST's water side, not the feature's own names — a bite runs away
    // from the water its host faces. Absent, the feature is already warned
    // about elsewhere and the anchor stands as a least-bad position.
    const seaward = seawardByHost.get(hostKey);
    if (sizeText === undefined || !seaward) return null;
    const reachText = pairOf(e.pairs, "reach") ?? model.facetOf(e.typeWord, "reach");
    const reach = reachText === undefined ? ASPECT : Number(reachText);
    if (!Number.isFinite(reach)) return null;
    // Half the depth along the way the feature runs: a bite goes landward,
    // away from the water that named its direction, and a jut goes seaward.
    const step = (morph === "bite" ? -1 : 1) * (measureToNumber(sizeText) * scale * reach) / 2;
    return { x: anchor.x + seaward.x * step, y: anchor.y + seaward.y * step };
  };

  /** Every name this entity answers to, since a feature may reference either. */
  const hostKeys = (e: EntityNode): string[] => [...e.ids, ...(e.name ? [e.name] : [])];

  /**
   * The finished course of a line: spec 02 §9's noise-free spline, then the
   * features DECLARED on it (spec 05 §4).
   *
   * Both spellings of a course go through here. A coastline may be written
   * `coastline : path (…) (…)` or `coastline : from (…) via (…) to (…)`, and
   * those are handled in different branches — wiring the deformation into only
   * one of them made every feature on a `from`/`to` coast silently do nothing,
   * which is exactly what happened to Vessany's Gull Bay.
   */
  const finishCourse = (e: EntityNode, controls: XY[]): XY[] => {
    const placed = hostKeys(e).flatMap((k) => featuresByHost.get(k) ?? []);
    if (placed.length === 0) return catmullRom(controls, 8);
    // Density is `deformCurve`'s business now, not the caller's: it resamples
    // to a uniform spacing so a feature behaves the same however many `via`
    // points the host happens to carry (#154, #155).
    const curve = catmullRom(controls, 8);
    // Drawn as declared or reported — never quietly resized. A clamp would
    // make `size=` a lie, since the same 90mi cape would come out different
    // lengths on different stretches of coast, and a renderer that silently
    // gives an author something other than what they asked for is the failure
    // ADR 0023 exists to prevent.
    // ARMS HANG OFF ARMS, IN A SECOND PASS (#170). Dabob Bay is declared `on
    // hood`, and Hood Canal is a feature rather than a course — so nothing
    // ever asked for Dabob and it was dropped without a word, which is why it
    // rendered as nothing at all rather than as something facing wrongly.
    //
    // Two passes rather than one list, because a window is measured on its
    // HOST AS ITS HOST STANDS: the canal's own window belongs to the
    // undeformed coast, and the bay's belongs to the coast with the canal
    // already spliced into it. Putting both in one pass would measure the
    // bay's mouth against a stretch of shoreline that is no longer there —
    // the same drift #163 fixed by measuring siblings on the undeformed host.
    const arms = placed.flatMap((x) => x.keys.flatMap((k) => featuresByHost.get(k) ?? []));
    const byFeature = new Map([...placed, ...arms].map((x) => [x.f, x] as const));
    const passes = arms.length > 0 ? [placed, arms] : [placed];
    // Only the FIRST pass is handed a declared course; the second is handed
    // this function's own output, whose feature outlines must survive intact
    // (#179).
    return passes.reduce((into, pass, index) => deformCurve(into, pass.map((x) => x.f), (f, why) => {
      const x = byFeature.get(f);
      if (!x) return;
      const named = (y: typeof x): string => (y.label === y.word ? `'${y.word}'` : `'${y.label}' (${y.word})`);
      // Each refusal names its OWN cause and its own fix. An overlap reported
      // as a fold would send an author to shrink a feature that fits.
      const because =
        why.kind === "off-end"
          ? `half of its mouth would lie off the end of '${keyOf(e)}'. Move it further along the course, or use a smaller size=`
          : why.kind === "overlap"
            ? `it claims the same stretch of '${keyOf(e)}' as ${named(byFeature.get(why.other) ?? x)}. Move one of them, or use a smaller size= on either`
            : why.kind === "off-normal"
              // ONE CAUSE, TWO REMEDIES (#194). Where squaring the first control
              // draws, that point is offered and it is known to work. Where it
              // does not, the skew is still the cause — a corner between this
              // renderer's own mouth lead and the author's first control — and
              // saying so with both bearings beats naming a bend they did not
              // write and cannot move.
              ? why.suggest
                ? `its centerline leaves the host at ${Math.round(why.degrees)}° from the normal, and a centerline must leave perpendicular. Try a first via point at (${round1(why.suggest.x / scale)},${round1(why.suggest.y / scale)})`
                : `its centerline leaves the host at ${Math.round(why.degrees)}° from the normal, and squaring the first via point is not enough to draw it — so this feature is on the wrong stretch of coast, or this coast is not the one it was drawn against. It leaves heading (${round1(why.leaves.x)},${round1(why.leaves.y)}) while the shore here faces (${round1(why.normal.x)},${round1(why.normal.y)})`
              : why.kind === "pinch"
                // The place, the two numbers, and the rule connecting them. A
                // fold is local, so an author needs to be told WHERE: on a
                // canal stated in eight controls there is no reading the one
                // bend that is too tight off a list of coordinates.
                ? `its centerline turns with a radius of ${round1(why.radius / scale)} near (${round1(why.at.x / scale)},${round1(why.at.y / scale)}), and a channel cannot follow a turn tighter than its own half-width — ${round1(why.half / scale)} there. Spread the via points through that bend, or narrow the channel there`
                : `${x.morph === "jut" ? "a jut that long" : "a bite that deep"} would fold this stretch of the course back through itself. Use a smaller size= or reach=, or move it to a straighter stretch`;
      // The size is named where the size is worth changing. On a skewed
      // departure it is not, and quoting it invites exactly the wrong edit —
      // which is what six rounds of shrinking a perfectly good inlet came from.
      // Nor on a pinch: the width that folds is the one at the bend, which on
      // a declared profile is not `size=` at all.
      const at = why.kind === "off-normal" || why.kind === "pinch" ? "" : ` at size=${x.sizeText}`;
      diagnostics.push({
        severity: "error",
        line: x.line,
        message: `${named(x)} cannot be drawn${at} on '${x.host}' — ${because} (spec 05 §4)`,
      });
    }, index === 0), curve);
  };

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
  /**
   * The finishing for a mass of this word at this extent (#173, ADR 0025).
   *
   * The WORD and the SIZE, and deliberately nothing else — not the document
   * seed, not the entity's id or name, not its position, not its ordinal among
   * siblings. Each of those was in the key it replaces, and each had an edit
   * that silently redrew a landform a campaign may already have named.
   *
   * The cost is that two same-word masses of exactly the same size are twins.
   * ADR 0023 already took that trade for detached features on the same
   * reasoning: it is the honest consequence of two identical declarations, and
   * it is cheap to escape by differing the size.
   */
  const massRng = (word: string | undefined, size: number): (() => number) =>
    rng(hashSeed(hashString(word ?? "mass"), Math.round(size * 1000)));

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

  /**
   * The two arcs of a polygon ring between the projections of a and b; the
   * face word picks which (ADR 0013): `along south edge of X` takes the arc
   * lying furthest toward that compass — deterministic, author-stated.
   */
  const ringPathBetween = (ring: XY[], a: XY, b: XY, face: string): XY[] => {
    const closed = [...ring, ring[0]!];
    const param = (target: XY): { i: number; p: XY } => {
      let best = { d: Infinity, i: 0, p: closed[0]! };
      for (let i = 0; i < closed.length - 1; i++) {
        const p1 = closed[i]!;
        const p2 = closed[i + 1]!;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((target.x - p1.x) * dx + (target.y - p1.y) * dy) / lenSq));
        const p = { x: p1.x + t * dx, y: p1.y + t * dy };
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < best.d) best = { d, i, p };
      }
      return best;
    };
    const pa = param(a);
    const pb = param(b);
    const n = ring.length;
    const walk = (forward: boolean): XY[] => {
      const out: XY[] = [pa.p];
      let i = pa.i;
      while (i !== pb.i) {
        i = forward ? (i + 1) % n : (i - 1 + n) % n;
        out.push(ring[forward ? i : (i + 1) % n]!);
        if (out.length > n + 2) break;
      }
      out.push(pb.p);
      return out;
    };
    const arcs = [walk(true), walk(false)];
    const vec = COMPASS_VECTORS[face] ?? { x: 0, y: -1 };
    const score = (arc: XY[]): number => arc.reduce((s, p) => s + p.x * vec.x + p.y * vec.y, 0) / arc.length;
    return score(arcs[0]!) >= score(arcs[1]!) ? arcs[0]! : arcs[1]!;
  };

  /**
   * Aspect adaptation (ADR 0013): a reference names the THING; line-needing
   * forms take its polyline (the crest, which survives area refinement), a
   * face-qualified ring arc otherwise — and never silently guess between an
   * area's faces.
   */
  const lineAspect = (ref: Ref, face: string | undefined, a: XY | null, b: XY | null, line: number): XY[] | null => {
    const target = lookup(ref);
    if (face && target?.polygon && a && b) return ringPathBetween(target.polygon, a, b, face);
    if (target?.polyline) return a && b ? subPolylineBetween(target.polyline, a, b) : target.polyline;
    if (target?.polygon) {
      diagnostics.push({ severity: "warning", line, message: `along ${ref.value} is ambiguous: it is an area with no crest line — name a face: along <compass> edge of ${ref.value} (ADR 0013)` });
    }
    return null;
  };

  const resolveEntity = (e: EntityNode): Resolved => {
    const chain = model.chainOf(e.typeWord);
    const out: Resolved = {};
    let onRef: Ref | null = null;
    // A DETACHED feature is a shape beside its host rather than a deformation
    // of it (spec 05 §4): an island, an islet, an oxbow. It needs no host
    // curve, only its own anchor and size — which is why it is resolved here
    // rather than in `finishCourse`.
    //
    // Its outline is keyed on WHAT IT IS — the word and its size — and on
    // nothing else. Not on identity, so naming it cannot reshape it; not on
    // position, so moving it slides the same island rather than drawing a
    // different one; not on the document seed or on declaration order.
    //
    // The cost is that two same-word islands of exactly the same size are
    // twins. That is the honest consequence of two identical declarations, and
    // it is cheap to escape — differing sizes differ the shape — whereas every
    // other key has an edit that silently redraws a thing a campaign may have
    // named. (An earlier draft keyed on position and got the naming case right
    // while getting the moving case wrong; both must hold.)
    if (model.facetOf(e.typeWord, "morph") === "detached") {
      const anchor = e.placements.find((p): p is Point => p.kind === "point")
        ?? e.placements.flatMap((p) => (p.kind === "relational" && p.form === "at" && p.target.kind === "point" ? [p.target] : []))[0];
      const sizeText = pairOf(e.pairs, "size");

      // A DETACHED FEATURE MAY CARRY ITS OWN OUTLINE (#172, ADR 0026).
      //
      // Three numbers produce a lozenge. That is right for the anonymous
      // mid-river islet ADR 0023 is written around, and wrong for Whidbey
      // Island, which doglegs at Coupeville — and a landform a reader
      // recognises is exactly what a campaign attaches itself to, which is the
      // ADR's own test for what must be declared data. Shape was the one thing
      // about a feature that could not be declared.
      //
      // The points are FRAMED — offsets from the anchor in map units, the same
      // referent-frame rule ADR 0009 sets for `on … at` — so moving the island
      // is still one coordinate, not a transform of the whole set, and the
      // feature stays attached to its host the way a placed feature must.
      const outline = e.placements.find(
        (p): p is Extract<Placement, { kind: "shape" }> => p.kind === "shape" && p.shape === "area",
      );
      if (anchor && outline) {
        // An outline and the dials together are an ERROR, not a warning:
        // honouring either one means discarding the other, and a renderer that
        // silently picks is the failure this phase exists to remove. Only what
        // is written ON THE ENTITY LINE counts — a `reach=` inherited from the
        // vocabulary would otherwise make every outline on a derived word an
        // error (`skerry : island reach=0.2`).
        const dials = ["size", "reach", "taper"].filter((k) => pairOf(e.pairs, k) !== undefined);
        if (dials.length > 0) {
          diagnostics.push({
            severity: "error",
            line: e.line,
            message: `'${e.name ?? e.typeWord}' declares an outline AND ${dials.map((d) => `${d}=`).join(", ")} — an outline says what the feature looks like and the dials generate a shape instead, so one would have to be discarded. Drop ${dials.map((d) => `${d}=`).join("/")}, or drop the outline (spec 05 §4)`,
          });
          return out;
        }
        const centre = toXY(anchor);
        const framed = outline.args
          .filter((arg): arg is Point => arg.kind === "point")
          .map((arg) => ({ x: centre.x + arg.x * scale, y: centre.y + arg.y * scale }));
        if (framed.length >= 3) {
          // Organically finished, like any declared silhouette (spec 02 §9,
          // ADR 0025): the author gives the shape, the renderer gives it a
          // drawn edge. Left raw it reads as a surveyed polygon — strangely
          // angular against every other coastline on the map.
          out.polygon = organicOutline(framed, hashSeed(hashString(e.typeWord ?? "island"), framed.length));
          out.point = centre;
          return out;
        }
        diagnostics.push({
          severity: "warning",
          line: e.line,
          message: `'${e.name ?? e.typeWord}' has an outline of ${framed.length} point${framed.length === 1 ? "" : "s"} — an outline needs at least three (spec 05 §4)`,
        });
        return out;
      }

      if (anchor && sizeText !== undefined) {
        const center = toXY(anchor);
        const radius = (measureToNumber(sizeText) / 2) * scale;
        // `size=` is the LONG axis and `reach=` the short one as a multiple of
        // it — the same "the other dimension" `reach=` already means for juts
        // and bites (#159). At 1 this is the circle it has always drawn, so no
        // existing render moves. Real islands are rarely round and the ones
        // that matter least of all: Whidbey is 40mi by 2–9mi.
        const reachText = pairOf(e.pairs, "reach") ?? model.facetOf(e.typeWord, "reach");
        const reachNum = reachText === undefined ? 1 : Number(reachText);
        if (reachText !== undefined && !Number.isFinite(reachNum)) {
          diagnostics.push({ severity: "warning", line: e.line, message: `'reach=${reachText}' is not a number — the vocabulary default applies (spec 05 §4)` });
        }
        const shortRatio = Number.isFinite(reachNum) && reachNum > 0 ? reachNum : 1;
        // The long axis is inferred rather than declared: every long island in
        // a sound parallels the water it sits in, because the same glacier cut
        // both. THE CHANNEL WINS WHERE THERE IS ONE (#167) — an island inside
        // an inlet lies along the inlet, not along the coastline that inlet
        // was cut into, which runs across it. Elsewhere the host's own course
        // still answers, so no island in open water moves.
        const hostRef = e.placements.find((p): p is Extract<Placement, { kind: "relational"; form: "near" }> =>
          p.kind === "relational" && p.form === "near" && p.target.kind === "ref");
        const controls = hostRef && hostRef.target.kind === "ref" ? hostControls.get(hostRef.target.value) : undefined;
        const angle = channelAxisAt(center) ?? (controls ? tangentAngle(controls, center) : 0);
        // Same generator, same contract as a `blob` (#173, ADR 0025): the long
        // axis measures exactly `size=`. Spec 05 §4 promises a placed feature
        // is "drawn at its DECLARED size or reported — never quietly resized",
        // and the outline it was given overshot that by a few percent in a
        // direction nothing measured.
        out.polygon = organicMass(center, radius * 2, shortRatio, angle, massRng(e.typeWord ?? undefined, radius * 2));
        out.point = center;
        out.radius = radius;
        return out;
      }
      if (anchor && sizeText === undefined) {
        diagnostics.push({ severity: "warning", line: e.line, message: `'${e.typeWord}' has no size= — a placed feature needs an extent to be drawn (spec 05 §4)` });
      }
    }
    for (const p of e.placements) {
      if (p.kind === "point") out.point = toXY(p);
      else if (p.kind === "point-range") {
        const a = toXY(p.from);
        const b = toXY(p.to);
        out.polygon = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      } else if (p.kind === "shape") {
        // A framed shape's points are offsets from the referent (#142), so the
        // WHOLE shape travels with it. Anchoring only the first point was
        // measured and rejected: it drags one end and leaves the rest, turning
        // a 60-unit spur into a 183-unit smear — worse than today's clean
        // detachment, because the shape deforms instead of merely sitting in
        // the wrong place.
        let origin: XY | null = null;
        if (p.frame) {
          origin = refPoint(p.frame);
          if (!origin) {
            diagnostics.push({ severity: "warning", line: e.line, message: `'${p.frame.value}' has no position to frame this ${p.shape} against — its offsets are read as absolute (spec 02 §9)` });
          }
        }
        const framed = (pt: XY): XY => (origin ? { x: origin.x + pt.x, y: origin.y + pt.y } : pt);
        const pts = p.args
          .filter((arg): arg is Point => arg.kind === "point")
          .map((arg) => (origin ? framed({ x: arg.x * scale, y: arg.y * scale }) : toXY(arg)));
        if (p.shape === "blob") {
          const center = pts[0] ?? out.point ?? { x: w / 2, y: h / 2 };
          const diameter = measureToNumber(pairOf(e.pairs, "size") ?? "40") * scale;
          // A BLOB DECLARES AN EXTENT (#173, ADR 0025): a round mass measuring
          // exactly `size=` across, keyed on the WORD AND THE SIZE and nothing
          // else. The key it replaces carried the document seed, the entity's
          // identity and its ordinal among same-size siblings, so naming a
          // blob reshaped it, adding a `seed:` reshaped every blob on the map,
          // and swapping two lines in the file swapped two islands' outlines.
          out.polygon = organicMass(center, diameter, 1, 0, massRng(e.typeWord ?? undefined, diameter));
          out.point = center;
          out.radius = diameter / 2;
        } else if (p.shape === "area") {
          // Boundary segments may FOLLOW features (#81): `along <ref>`
          // between two vertices splices the feature's rendered curve
          // between their projections — one definition, and moving the
          // feature moves the border with it.
          const spliced: XY[] = [];
          const spans: { ref: string; refKey?: string; start: number; end: number }[] = [];
          for (let k = 0; k < p.args.length; k++) {
            const arg = p.args[k]!;
            if (arg.kind === "point") {
              spliced.push(toXY(arg));
              continue;
            }
            if (arg.kind !== "relational" || arg.form !== "along") continue;
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
            if (prev && next) {
              const seg = lineAspect(arg.ref, arg.face, prev, next, e.line);
              if (seg) {
                const refKey = arg.ref.form === "id" ? arg.ref.value : (byName.get(arg.ref.value) ?? slugify(arg.ref.value));
                spans.push({ ref: arg.ref.value, refKey, start: spliced.length - 1, end: spliced.length + seg.length });
                spliced.push(...seg);
              }
            }
          }
          if (spans.length) out.alongSpans = spans;
          // Spec 02 §9 promises the renderer finishes a sketch organically.
          // Coastlines, blobs and ridge belts got that; `area` did not, so a
          // shaped forest came out a straight-edged polygon and the only way
          // to fake curves was thirty hand-placed points (#96).
          //
          // Three things stay literal, each for its own reason:
          //  - `raw`, the author's explicit opt-out (surveyed parcels, enclaves);
          //  - water, whose coastlines carry their OWN finishing — smoothing
          //    the assembled boundary would fight it;
          //  - any outline with `along` spans, because those segments ARE a
          //    feature's finished curve (ADR 0012) and re-splining them would
          //    pull the border off the thing it is defined to follow.
          const literal = e.flags.includes("raw") || e.section === "water" || spans.length > 0;
          out.polygon =
            e.section === "water" ? assembleWaterBoundary(spliced)
            : literal || e.archetype !== "terrain" || spliced.length < 3 ? spliced
            : organicOutline(spliced, hashSeed(model.seed, hashString(entityAnchor(e) ?? e.typeWord ?? "area"), spliced.length));
        } else {
          // The TRUE curve: a spline through the declared points, no noise
          // (spec 02 §9, affirmed by ADR 0023) — then the features DECLARED
          // on it, which is a discrete layer rather than roughness.
          out.polyline = finishCourse(e, pts);
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
            if (r?.polyline) out.halfPlane = { compass: p.compass, of: r.polyline, refKey: p.ref.form === "id" ? p.ref.value : (byName.get(p.ref.value) ?? slugify(p.ref.value)) };
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
            // A PLACED FEATURE IS NAMED ON ITS BODY, NOT AT ITS MOUTH (#171).
            // The anchor is a point on the HOST shoreline, so labelling there
            // put a 40mi canal's name on the coast with forty miles of canal
            // unnamed below it, and piled four South Sound inlets' names into
            // a six-mile square while the water they name lay thirty miles
            // apart and unlabelled. Spec 07 §5 already says an area-shaped
            // feature is named in its body and a line feature at its
            // arc-length midpoint; a bite is drawn as an area, so the anchor
            // was simply the only position the label code had been handed.
            if (p.point) out.point = featureLabelPoint(e, toXY(p.point), p.via?.map(toXY), refText(p.ref)) ?? toXY(p.point);
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
              // `join <ref>` (#94): end on the trunk's finished curve. This is
              // the same projection a river mouth already does against a
              // coastline — the confluence is a clean Y instead of two lines
              // ending near each other and hoping. Live, like any anchor:
              // moving the trunk moves the join.
              if (ep.join) {
                if (!target?.polyline) {
                  diagnostics.push({ severity: "warning", line: e.line, message: `'join ${ep.at.value}' needs a watercourse with a course to meet and that one has none — the endpoint falls back to its position (spec 02 §7)` });
                  return { p: refPoint(ep.at), shore: null };
                }
                return { p: refPoint(ep.at), shore: target.polyline };
              }
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
              // A region map has no grid, so a `via <cell>` (#258) names
              // nothing here — refused in the parser now, along with every
              // other spelling of an address on a gridless map (#325, ADR
              // 0049). The refusal used to live HERE and covered this one slot
              // only, which is what made the other six silent.
              const via = p.via.filter((c): c is Point => c.kind === "point").map(toXY);
              const a = A.shore ? nearestOnPolyline(A.shore, via[0] ?? B.p) : A.p;
              const b = B.shore ? nearestOnPolyline(B.shore, via[via.length - 1] ?? A.p) : B.p;
              out.polyline = finishCourse(e, [a, ...via, b]);
              // Coastlines declared from/via/to register their curves too —
              // sea boundaries must reuse them however the coast was written.
              if (chain.includes("coastline")) coastCurves.push({ raw: [a, ...via, b], finished: out.polyline });
            }
            break;
          }
          case "along": {
            // `along <ref>` as the ONLY placement (free text, spec 07 §2 #107):
            // the entity has no course of its own, so it takes the referent's
            // whole line. With endpoints it splices instead, below.
            if (!out.polyline) {
              const whole = lineAspect(p.ref, p.face, null, null, e.line);
              if (whole) out.polyline = whole;
              break;
            }
            if (out.polyline) {
              // `A to B along X`: anchor at both endpoint markers and follow
              // X's shape between their projections — nudged landward so a
              // coast road runs beside the shoreline, not on it.
              const first = out.polyline[0]!;
              const last = out.polyline[out.polyline.length - 1]!;
              let guide = lineAspect(p.ref, p.face, first, last, e.line);
              if (guide) {
                if (waterVector) {
                  const vec = waterVector;
                  guide = guide.map((pt) => ({ x: pt.x - vec.x * 4, y: pt.y - vec.y * 4 }));
                }
                out.polyline = [first, ...guide, last];
              }
            } else {
              const line = lineAspect(p.ref, p.face, null, null, e.line);
              if (line) out.polyline = line.map((pt) => ({ ...pt }));
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
    // AN ENTITY THAT RESOLVES TO NO GEOMETRY CONTRIBUTES NO ELEMENT (#325,
    // ADR 0049). `area C4..D5` on a gridless map filtered its args down to the
    // points among them, found none, and still assigned the empty list — so
    // `<polygon points=""/>` reached the output, an element nothing can draw.
    // `render` deliberately proceeds past errors, so the refusal in the parser
    // does not remove this on its own. An outline of ONE or TWO points is left
    // exactly as it was: that is a live defect reachable with points alone and
    // it is filed separately, not folded in here.
    if (out.polygon && out.polygon.length === 0) delete out.polygon;
    return out;
  };

  // ---------- pass 1: resolve everything ----------
  const items: Item[] = [];
  const chainByKey = new Map<string, string[]>();
  for (const e of model.entities) {
    const r = resolveEntity(e);
    const key = keyOf(e);
    resolved.set(key, r);
    if (e.name) byName.set(e.name, key);
    if (r.halfPlane && e.section === "water") waterVector = COMPASS_VECTORS[r.halfPlane.compass] ?? null;
    const chain = model.chainOf(e.typeWord);
    chainByKey.set(key, chain);
    items.push({ e, r, chain });
  }

  // A HALF-PLANE IS CLIPPED HERE, NOT AT EMIT (#355).
  //
  // `halfPlanePolygon` used to run in the emit pass, at two call sites, which
  // made the water's actual outline the one piece of region geometry a
  // non-SVG consumer could not be handed. It is geometry by ADR 0037's test —
  // it decides where the land is — so it resolves.
  //
  // The sweep runs AFTER the loop rather than at the assignment in
  // `resolveEntity`, because `of` holds a live reference to the referenced
  // course's polyline. Clipping at assignment time would freeze the shape
  // against whatever that course looked like when the half-plane was read,
  // and a coast declared later, or finished later, would cut against a stale
  // outline. After the loop, every course is final.
  for (const { r } of items) {
    if (r.halfPlane) r.halfPlane.polygon = halfPlanePolygon(r.halfPlane, w, h);
  }

  return { items, resolved, byName, chainByKey, mapUnit, toXY, lookup, assembleWaterBoundary };
}

export function renderRegion(model: Model, body: string[], size: { w: number; h: number; scale: number }, diagnostics: { severity: "error" | "warning"; line: number; message: string }[] = []): void {
  const { w, h, scale } = size;
  const theme = model.theme;
  const ink = theme.surface("ink", "fill", INK);
  // Named ground (ADR 0013): the author states what unmarked land IS —
  // the parchment stops being an assumption.
  const groundWord = model.header.get("ground")?.trim();
  const groundFill = groundWord ? theme.terrainFill(groundWord.split(/\s+/)) : null;
  if (groundFill) body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: groundFill }));
  const { items, resolved, byName, chainByKey, mapUnit, toXY, lookup, assembleWaterBoundary } =
    resolveRegionGeometry(model, size, diagnostics);

  // Two watercourses that cross without meeting are nonsense on the ground:
  // water does not flow over water. Nothing governed this before — the
  // Baranduin and the Gwathló were routed to adjacent mouths and drew a visible
  // X near Tharbad in silence, because no rule covered two linear features
  // sharing space (#94). The battlemap has a crossing rule (spec 06 §6) but it
  // is cell-based and does not reach region maps.
  //
  // A `join` is exactly the declaration that makes a meeting intentional, so
  // the check is: courses that touch must be related. Shared endpoints count
  // too — `from <river>` is a distributary leaving its trunk, equally declared.
  const watercourses = items.filter((it) => it.chain.includes("river") && it.r.polyline);
  const joinRefs = new Map<string, Set<string>>();
  for (const it of watercourses) {
    const named = new Set<string>();
    for (const p of it.e.placements) {
      if (p.kind !== "relational") continue;
      if (p.form === "from-to") {
        for (const ep of [p.from, p.to]) if (ep.at.kind === "ref") named.add(ep.at.value);
      }
    }
    joinRefs.set(keyOf(it.e), named);
  }
  const relatedByName = (a: Item, b: Item): boolean => {
    const names = (it: Item): string[] => [...it.e.ids, ...(it.e.name ? [it.e.name] : [])];
    const aRefs = joinRefs.get(keyOf(a.e)) ?? new Set<string>();
    const bRefs = joinRefs.get(keyOf(b.e)) ?? new Set<string>();
    return names(b).some((n) => aRefs.has(n)) || names(a).some((n) => bRefs.has(n));
  };
  for (let i = 0; i < watercourses.length; i++) {
    for (let j = i + 1; j < watercourses.length; j++) {
      const a = watercourses[i]!;
      const b = watercourses[j]!;
      if (relatedByName(a, b)) continue;
      const hit = firstCrossing(a.r.polyline!, b.r.polyline!);
      if (!hit) continue;
      const label = (it: Item): string => it.e.name ?? it.e.ids[0] ?? it.e.typeWord ?? "a watercourse";
      diagnostics.push({
        severity: "warning",
        line: b.e.line,
        message: `'${label(a)}' and '${label(b)}' cross at (${Math.round(hit.x)},${Math.round(hit.y)}) without meeting — water does not flow over water; 'join' one to the other, or route them apart (spec 02 §7)`,
      });
    }
  }

  // Paths serving as ZONAL FRONTIERS (a tundra's frostline) render in the
  // frontier register — a fine dotted line in the zone's tint — because any
  // solid line at river weight reads as a river (owner note).
  const frontierFills = new Map<string, { fill: string; zonePoly: XY[] }>();
  for (const it of items) {
    if (it.r.halfPlane?.refKey && it.e.section !== "water" && it.e.archetype !== "zone") {
      // The polygon is resolved (see the sweep in `resolveRegionGeometry`);
      // only the fill is decided here, because only the fill is ink.
      frontierFills.set(it.r.halfPlane.refKey, { fill: theme.terrainFill(it.chain), zonePoly: it.r.halfPlane.polygon ?? [] });
    }
    // Area-declared zones (a tundra following the coasts): any non-coastline
    // path their boundary follows is likewise a zonal frontier.
    if (it.r.alongSpans && it.r.polygon && it.e.archetype !== "zone") {
      for (const s of it.r.alongSpans) {
        if (!s.refKey) continue;
        const ch = chainByKey.get(s.refKey);
        if (ch && !ch.includes("coastline")) frontierFills.set(s.refKey, { fill: theme.terrainFill(it.chain), zonePoly: it.r.polygon });
      }
    }
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
  const beltObstacles = new Map<string, { spec: [number, number, number, number]; handle: object }[]>();
  for (const { e, r } of items) {
    if (!r.polyline) continue;
    if (r.ridge) {
      // Low weight: the belt is soft terrain, not a wall — labels prefer
      // to stay off it but a feature ON the range keeps its name (shrunk)
      // rather than dropping it. Blocks are arc-spaced so their weighted
      // overlaps don't SUM past the drop threshold for on-belt labels,
      // and kept as handles so a ridge's OWN label can place on its own
      // belt without self-rejection (region-style mountain names).
      const half = (r.beltW ?? 28) / 2 + 3;
      const own: { spec: [number, number, number, number]; handle: object }[] = [];
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
          const spec: [number, number, number, number] = [pt.x - half, pt.y - half, half * 2, half * 2];
          own.push({ spec, handle: placer.tempBlock(spec[0], spec[1], spec[2], spec[3], 0.3) });
          lastAt = acc;
        }
      }
      beltObstacles.set(keyOf(e), own);
    } else {
      // The corridor is the line's RENDERED stroke plus a hair of clearance,
      // not a constant (#134). A flat ±3 reserved ~6 units either side of a
      // 2-unit river — three times the ink — and did it absolutely, before
      // the label ladder ran, so a settlement near a river could not place
      // its name at ANY size. Minas Tirith sits ~9 units from the Anduin and
      // was dropped entirely; Edoras was shrunk 13 → 10 by the same reserve.
      //
      // Soft, like the ridge belts above. `tryClaim` rejects on ANY overlap
      // whatever the weight, so the preferred path still keeps names off the
      // line; weight only prices the least-bad fallback — and there, a name
      // brushing the river it stands on beats no name at all. That ordering
      // is the cartography: on the reference map these names touch their
      // rivers, because the adjacency is the point.
      //
      // Still one box per sample point, NOT resampled along the segments.
      // The claim this comment used to make — "gap-free" — was never true:
      // resolved spacing runs from 0.6 to 122 units on a real map, so coarse
      // stretches always had holes. Filling them was tried and costs far more
      // than it buys, because overlapping obstacle boxes double-count in the
      // cost sum and shut out labels the narrower corridor had just admitted.
      // The Deepflow/Deep Road pair this guards is covered by its own test.
      const strokeW = Number(pairOf(e.pairs, "width") ?? (model.chainOf(e.typeWord).includes("coastline") ? 1.2 : 2));
      const half = strokeW / 2 + 1;
      for (const pt of r.polyline) {
        placer.block(pt.x - half, pt.y - half, half * 2, half * 2, 0.35);
      }
    }
  }

  // Name homes (owner: the ROAD's label dodges the forest's name, never
  // the reverse): each named area reserves its natural centroid label spot
  // BEFORE curve labels claim, and the reservation is released before area
  // names actually place — so a road crossing a forest flips its label to
  // the far side, and the forest keeps its name at home.
  const nameHomes: object[] = [];
  for (const { e, r, chain } of items) {
    if (!r.polygon || !e.name || e.flags.includes("nolabel") || overridden(e) || !labelsOn(model)) continue;
    if (e.archetype === "zone") continue;
    const watery = e.section === "water" || chain.some((word) => word === "sea" || word === "water");
    if (watery && !chain.includes("lake")) continue;
    const c = r.point ?? centroid(r.polygon);
    const wpx = e.name.length * 11 * 0.58 + 8;
    // The home covers the label's nudge band too — a reserved spot the
    // label can't actually use (a road crossing the centroid) would push
    // the name into ground a curve label already took (the Lake Vael
    // collision of owner review).
    nameHomes.push(placer.tempBlock(c.x - wpx / 2, c.y - 26, wpx, 42, 0.6));
  }

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

  // Claims run in priority order — 0 author overrides (fixed), 2 curve
  // labels, 2.2 point markers (capitals before minor features), 3 area names,
  // 4 water/realm sprawls. Line labels go first because they are the only
  // kind with no recovery: a point name can leave its marker and stay legible
  // on a leader, a river's name cannot leave its river (ADR 0019). — while paint order
  // stacks the reverse, so big faint names sit beneath the small precise
  // ones. Under density each label shrinks before it moves far, and is
  // omitted rather than drawn over other text (spec 07 §5).
  const labelBuckets: string[][] = [[], [], [], [], []];
  const labelJobs: { priority: number; run: () => void }[] = [];
  const deferLabel = (priority: number, run: () => void): void => void labelJobs.push({ priority, run });
  // Homes release between curve labels (2) and area names (3).
  if (nameHomes.length) deferLabel(2.5, () => nameHomes.forEach((b) => placer.release(b)));

  // Massif belts collected across the loop and emitted as ONE group per
  // terrain fill with group-level opacity: overlapping ranges (the Vakh
  // Teeth joining the Spine of Aum) composite as a single mountain system,
  // never a darker double-exposure.
  const massifs: { anchor: string | undefined; titleEl: string; poly: XY[]; peaks: string; fill: string }[] = [];

  // Political boundaries (#81): a border names a relationship, not a place —
  // realms collected here, border declarations there, seams rendered after
  // every realm's geometry is known.
  // `frame` marks half-plane realms: their polygon is mostly viewport edge,
  // so only border-stated stretches stroke (no outline around the map rim).
  const realmInfos: { e: EntityNode; key: string; poly: XY[]; spans: { ref: string; start: number; end: number }[]; fill: string; frame?: boolean }[] = [];
  /** Every island's drawn footprint, checked against the water once all of it is known (#164). */
  const islandInfos: { e: EntityNode; poly: XY[] }[] = [];
  const borderDecls: EntityNode[] = [];

  /**
   * Water wins every overlap (#98). Spec 05 §2 says so for zonal terrain
   * ("painted beneath water, so seas win where they overlap"), but it is a
   * property of the map model, not of one terrain kind: on any hand-drawn map
   * the water edge cuts the mountains cleanly. Terrain draws through a mask
   * that subtracts every water body, so a range can reach the shore without
   * bleeding onto it and a gulf can cut one named range in two.
   */
  const waterPolys: { poly: XY[]; name?: string | undefined; fill: string }[] = [];
  const hasWater = items.some(
    ({ e, chain }) => e.section === "water" || chain.some((word) => word === "sea" || word === "lake" || word === "water"),
  );
  const landMaskId = `cd-land-${model.doc.docId}`;
  const landMask = hasWater ? `url(#${landMaskId})` : undefined;
  /** One per island: shows its shore only where it meets water, not other land (#165). */
  const shoreMaskId = (i: number): string => `cd-shore-${model.doc.docId}-${i}`;
  /** One per island: its own footprint, for clipping its shore to one side (#185). */
  const insideMaskId = (i: number): string => `cd-inside-${model.doc.docId}-${i}`;
  /** Hides the mainland's coastline wherever an island has merged with it (#165). */
  const coastMaskId = `cd-coast-union-${model.doc.docId}`;
  /**
   * Shows only WATER — every declared body, with all land punched back out
   * (#185, ADR 0034).
   *
   * A border clipped to this lies wholly on the water side of its own line,
   * which is what stops two approaching shores filling the channel between
   * them with each other's ink.
   */
  const waterMaskId = `cd-water-${model.doc.docId}`;
  // Known BEFORE the draw loop, because a coastline may be drawn long before
  // the islands that merge with it are reached — and a mask reference to a
  // definition that never gets emitted is an error, not a no-op.
  const hasIslands = model.entities.some((e) => model.chainOf(e.typeWord ?? "").includes("island"));

  for (const { e, r, chain } of items) {
    const anchor = anchorAttr(model, e);
    const title = gmTitleFor(model, e);
    const titleEl = title ? svgTitle(title) : "";
    /**
     * A FIELD'S REGIONAL OVERRIDE DRAWS ITS STATE (#305, spec 04 §5).
     *
     * Spec 04 §5 promises each affordance takes its fill "from the theme's
     * `<field>` / `<field>.<state>` entry", and the state half was never
     * asked for: every region entity resolved through `terrainFill(chain)`
     * with no context, so `light "X" : blob … dark` and the same line saying
     * `daylight` emitted the identical polygon — the base `light` fill, fully
     * opaque, with the theme's declared weights (0.86 and 0.20) reaching
     * nothing. A lightless patch and a sunlit one were one mark.
     *
     * Scoped to FIELDS. The same lookup serves every region entity, and
     * widening it would change how any state on any word draws — a bigger
     * question than this, and one #206 is the place for. Fields are where the
     * promise is written and where #287 now sends authors: with an ambient
     * baseline documented as a battlemap concern, the regional override is the
     * only way to say a part of a region is lit differently.
     */
    const fieldState = model.archetypeOf(e.typeWord) === "field"
      ? e.flags.find((f) => model.statesOf(e.typeWord).has(f))
      : undefined;
    const stateCtx = fieldState ? { state: fieldState } : {};
    const wordFill = theme.terrainFill(chain, stateCtx);
    /** The weight the theme declared for this state, if it declared one. */
    const stateOpacity = fieldState ? theme.prop(chain, "opacity", stateCtx) : undefined;

    if (chain.includes("border")) {
      borderDecls.push(e);
      continue;
    }

    // Free text is text alone — no marker, at any placement (spec 07 §2,
    // #104). A caption names no entity and marks no position; it belongs to
    // the sheet, not the fiction.
    if (chain.includes("note")) {
      const label = e.texts[0] ?? e.name;
      // `along <ref>` sets the text on the referenced course itself (#107).
      if (label && r.polyline && r.polyline.length > 1) {
        const pid = `cdnote-${model.doc.docId}-${pathLabelCount++}`;
        const lp = r.polyline;
        const d = `M${fmt(lp[0]!.x)} ${fmt(lp[0]!.y)}` + lp.slice(1).map((pt) => `L${fmt(pt.x)} ${fmt(pt.y)}`).join("");
        labelBuckets[0]!.push(
          `<defs><path id="${pid}" d="${d}"/></defs>` +
            `<text font-size="11" fill="${theme.prop(chain, "fill") ?? theme.surface("ink", "fill", INK)}" opacity="0.85" text-anchor="middle" font-family="sans-serif">` +
            `<textPath href="#${pid}" startOffset="50%"><tspan dy="-4">${esc(label)}</tspan></textPath></text>`,
        );
        continue;
      }
      const at = r.point ?? (r.polygon ? centroid(r.polygon) : null);
      if (label && at) {
        const span = r.polygon ? Math.max(...r.polygon.map((p) => p.x)) - Math.min(...r.polygon.map((p) => p.x)) : 0;
        const size = 11;
        const spacing =
          e.flags.includes("sprawl") && span > 0
            ? Math.max(0, (span - label.length * size * 0.58) / Math.max(1, label.length - 1))
            : undefined;
        labelBuckets[0]!.push(
          text(label, {
            x: at.x, y: at.y, "font-size": size, "letter-spacing": spacing,
            fill: INK, opacity: 0.85, "text-anchor": "middle", "font-family": "sans-serif",
          }),
        );
      } else if (label) {
        diagnostics.push({
          severity: "warning",
          line: e.line,
          message: `free text "${label}" has no point or area placement — this renderer draws nothing for it (spec 07 §2)`,
        });
      }
      continue;
    }

    if (r.halfPlane) {
      const poly = r.halfPlane.polygon ?? [];
      const isWater = e.section === "water";
      const isZone = !isWater && e.archetype === "zone";
      if (isWater) {
        const seaFill = theme.terrainFill(["sea"]);
        waterPolys.push({ poly, name: e.name ?? undefined, fill: seaFill });
        layers.water.push(el("g", { id: anchor }, titleEl, el("polygon", { points: pointsAttr(poly), fill: seaFill })));
      } else if (isZone) {
        // Nations are individuals, not a type: the tint keys on the realm's
        // NAME (theme fill= for the word still wins), so each nation reads
        // as itself — the #71 principle applied at entity grain.
        const realmFill = theme.prop(chain, "fill") ?? wordTint(keyOf(e));
        layers.realms.push(el("g", { id: anchor }, titleEl, el("polygon", { points: pointsAttr(poly), fill: realmFill, opacity: 0.2 })));
        realmInfos.push({ e, key: keyOf(e), poly, spans: [], fill: realmFill, frame: true });
      } else {
        // Zonal terrain (ADR 0013): tundra, desert, icecap — defined by a
        // FRONTIER, not an outline. Honest terrain fill, painted before
        // the seas so water always wins where they overlap: beyond the
        // frontier the land IS this, all the way to the edge.
        layers.water.unshift(el("g", { id: anchor }, titleEl, el("polygon", { points: pointsAttr(poly), fill: wordFill })));
      }
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        deferLabel(4, () => {
          const c = centroid(poly);
          const keyedLbl = model.labelsMode === "keyed" ? labelTextFor(model, e) : null;
          const labelText = keyedLbl ?? e.name!.toUpperCase();
          const width = labelText.length * (18 * 0.58 + 6);
          // The name stays INSIDE its zone (a tundra named south of its own
          // frostline is nonsense) — same containment rule as realm names.
          const bw = Math.max(...poly.map((pt) => pt.x)) - Math.min(...poly.map((pt) => pt.x));
          const spot =
            placer.placeOrDrop(c.x, c.y, labelText, 18, "middle", [0, -bw / 6, bw / 6, -bw / 4, bw / 4], width, (x, y) => pip({ x, y }, poly)) ??
            { x: c.x, y: placer.place(c.x, c.y, labelText, 18, "middle", width), size: 18 };
          labelBuckets[4]!.push(
            text(labelText, {
              x: spot.x, y: spot.y, "font-size": spot.size, "letter-spacing": 6,
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
      // AN ISLAND IS LAND, even declared among the water it sits in. Spec 05
      // §2 already says so — "islands are the converse and stay land: an
      // island rises above the sea that surrounds it" — but this branch
      // painted anything in `[water]` with the sea's own fill, by section
      // rather than by word. Unreachable until #93 made `island` a placeable
      // stdlib word; on a coastline map every island came out invisible
      // against the sound. `oxbow` stays water, which is why the test is the
      // word and not the `detached` facet.
      // A NAMED STRETCH OF WATER is a name, not a mass (#160). A zone declared
      // among the water — "Central Basin", "Admiralty Inlet" — is part of the
      // sea it sits in, so it takes a label and at most a faint boundary in
      // the water's own tint, never a fill. The same restraint the frontier
      // register already uses for zonal terrain (spec 05 §2).
      //
      // Neither existing register was right: in `[terrain]` a zone drew a land
      // tint sitting ON the water, and in `[water]` it drew an opaque
      // sea-coloured polygon that occluded whatever lay beneath it.
      if (e.archetype === "zone" && e.section === "water") {
        const tint = theme.terrainFill(["sea"]);
        layers.water.push(
          el("g", { id: anchor }, titleEl,
            el("polygon", {
              points: pointsAttr(r.polygon), fill: "none", stroke: shade(tint),
              "stroke-width": 1, "stroke-dasharray": "1 5", opacity: 0.55, "stroke-linejoin": "round",
            }),
          ),
        );
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          deferLabel(4, () => {
            const c = centroid(r.polygon!);
            const label = (model.labelsMode === "keyed" ? labelTextFor(model, e) : null) ?? e.name!;
            const bboxW = Math.max(...r.polygon!.map((q) => q.x)) - Math.min(...r.polygon!.map((q) => q.y === q.y ? q.x : q.x));
            const { size, spacing } = fitLabel(label, Math.max(bboxW * 0.8, 40), 10, 1);
            const width = label.length * (size * 0.58 + spacing);
            const cx = Math.min(Math.max(c.x, width / 2 + 10), w - width / 2 - 10);
            labelBuckets[4]!.push(
              text(label, {
                x: cx, y: placer.place(cx, c.y, label, size, "middle", width),
                "font-size": size, "letter-spacing": spacing, fill: "#5a7a96",
                opacity: 0.75, "font-style": "italic", "text-anchor": "middle", "font-family": "sans-serif",
              }),
            );
          });
        }
        continue;
      }
      const landInWater = chain.includes("island");
      if (!landInWater && (e.section === "water" || chain.some((word) => word === "sea" || word === "lake" || word === "water"))) {
        const isLake = chain.includes("lake");
        const waterFill = theme.terrainFill(isLake ? ["lake"] : ["sea"]);
        // The boundary already reuses coastline curves (assembleWaterBoundary)
        // — no stroke and no re-spline: the declared coastline owns the shore
        // line and the fill follows it exactly. Lakes sit on land: terrain
        // layer. Seas are the floor: water layer.
        const shore = r.polygon;
        waterPolys.push({ poly: shore, name: e.name ?? undefined, fill: waterFill });
        (isLake ? layers.areas : layers.water).push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(shore), fill: waterFill, stroke: isLake ? shade(waterFill) : undefined, ...(isLake ? inkStroke(1.2) : {}), "stroke-linejoin": "round" }),
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
        // is visible at a glance (owner round ten: 0.12 read as nothing)
        // and keys on the realm's NAME, not the word: nations are
        // individuals, so each gets its own deterministic color (theme
        // fill= for the word still wins). The BOUNDARY renders separately
        // after all realms are known, so border states can restyle
        // stretches of it (#81).
        const realmFill = theme.prop(chain, "fill") ?? wordTint(keyOf(e));
        layers.realms.push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(r.polygon), fill: realmFill, opacity: 0.2 }),
          ),
        );
        realmInfos.push({ e, key: keyOf(e), poly: r.polygon, spans: r.alongSpans ?? [], fill: realmFill });
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
      // Massif areas (ADR 0013): specific mountainous terrain — the massif
      // visual language (fill + peaks scattered inside the footprint), not
      // the generic patch look. With `ridge (…) area (…)` on one entity the
      // area REFINES the extent while the crest survives for references.
      if (chain.includes("mountains")) {
        const poly = r.polygon;
        const xs = poly.map((pt) => pt.x);
        const ys = poly.map((pt) => pt.y);
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        const x1 = Math.max(...xs);
        const y1 = Math.max(...ys);
        const step = 24;
        const peaks: string[] = [];
        for (let gy = 0; y0 + gy * step * 0.85 <= y1; gy++) {
          for (let gx = 0; x0 + gx * step <= x1; gx++) {
            const px = x0 + (gx + (gy % 2) * 0.5) * step;
            const py = y0 + gy * step * 0.85;
            if (!pip({ x: px, y: py }, poly)) continue;
            const s = (gx + gy) % 3 === 0 ? 6.5 : 5;
            peaks.push(`M${fmt(px - s)} ${fmt(py + s * 0.7)}L${fmt(px)} ${fmt(py - s)}L${fmt(px + s)} ${fmt(py + s * 0.7)}`);
          }
        }
        massifs.push({ anchor, titleEl, poly, peaks: peaks.join(""), fill: wordFill });
        if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
          deferLabel(3, () => {
            const c = r.point ?? centroid(poly);
            const lbl = labelTextFor(model, e) ?? e.name!;
            const bw = x1 - x0;
            const spot = placer.placeOrDrop(c.x, c.y, lbl, 11, "middle", [0, -bw / 5, bw / 5]);
            if (!spot) return;
            labelBuckets[3]!.push(
              text(lbl, { x: spot.x, y: spot.y, "font-size": spot.size, fill: ink, opacity: 0.8, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
            );
          });
        }
        continue;
      }

      // Islands are LAND (owner round three): paper surface and a coastline
      // stroke, exactly like the continents — not a tinted blob.
      if (chain.includes("island")) {
        // Checked AFTER the loop, not here: `waterPolys` is filled as the
        // items are walked, so an island declared before its sea would be
        // measured against water that does not exist yet (#164).
        const islandIndex = islandInfos.length;
        islandInfos.push({ e, poly: r.polygon });
        const coast = theme.pathStroke(["coastline"]);
        // An island's shore is a coastline and lies on one side of itself too
        // (#185, ADR 0034). Nesting its own footprint inside #165's mask
        // INTERSECTS the two: what survives is the half of the stroke that is
        // inside this island AND has water outside it, which is the land-side
        // stroke and the #165 rule at once.
        const islandBank = theme.bank(["coastline"]);
        // FILL AND STROKE ARE SEPARATE SHAPES so only the stroke is masked
        // (#165). The fill is land wherever it lands — paper over paper where
        // it meets the mainland, which is invisible and correct — while the
        // shore is drawn only where there is water to have a shore against.
        layers.areas.push(
          el("g", { id: anchor }, titleEl,
            el("polygon", { points: pointsAttr(r.polygon), fill: groundFill ?? theme.surface("paper", "fill", "#f9f5ea") }),
            el("g", { mask: `url(#${shoreMaskId(islandIndex)})` },
              el("g", islandBank === "both" ? {} : { mask: `url(#${insideMaskId(islandIndex)})` },
                el("polygon", {
                  points: pointsAttr(r.polygon), fill: "none", stroke: coast.stroke,
                  ...inkStroke(islandBank === "both" ? 1.2 : 2.4), "stroke-linejoin": "round",
                }))),
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
      const zones = r.alongSpans?.length ? null : theme.zones(chain, wordFill);
      if (zones) {
        // Zones (spec 08 §2): boundary band in the edge style, interior in
        // core. The interior used the word's plain fill, so `forest.core` was
        // the one half of the sentence nothing read (#150).
        areaParts.push(el("polygon", { points: pointsAttr(r.polygon), fill: zones.edge, stroke: shade(zones.edge), "stroke-width": 1 }));
        areaParts.push(el("polygon", { points: pointsAttr(shrinkPolygon(r.polygon, zones.width * 2)), fill: zones.core }));
      } else if (r.alongSpans?.length) {
        // An area whose boundary FOLLOWS features doesn't stroke itself —
        // the followed features own their lines (the coast draws the coast,
        // the frostline draws its dotted frontier). A solid outline here
        // painted over the dotted line it was supposed to reveal.
        areaParts.push(el("polygon", { points: pointsAttr(r.polygon), fill: wordFill, opacity: stateOpacity }));
      } else {
        areaParts.push(el("polygon", { points: pointsAttr(r.polygon), fill: wordFill, stroke: shade(wordFill), "stroke-width": 1, opacity: stateOpacity }));
      }
      const glyphName = theme.prop(chain, "glyph");
      if (glyphName) {
        areaParts.push(...scatterGlyphs(r.polygon, glyphName, theme, ink));
      }
      // Terrain is clipped to the land side (#98); anything else keeps its
      // own extent (a lake is water, an island is land in the water).
      layers.areas.push(el("g", { id: anchor, mask: e.archetype === "terrain" ? landMask : undefined }, ...areaParts));
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        deferLabel(3, () => {
          const c = r.point ?? centroid(r.polygon!);
          const lbl = labelTextFor(model, e) ?? e.name!;
          const bw = Math.max(...r.polygon!.map((p) => p.x)) - Math.min(...r.polygon!.map((p) => p.x));
          // The ladder reaches a third of the area each way — a forest name
          // swaps fully to the far side of a road crossing it rather than
          // brushing the road's label (the Kingswood vs the Kingsway).
          // Zone-scale areas (a coast-following tundra) get proportionally
          // larger type: a continent-cap's name shouldn't whisper.
          const size = Math.min(18, Math.max(11, Math.round(bw / 16)));
          const spot = placer.placeOrDrop(c.x, c.y, lbl, size, "middle", [0, -bw / 5, bw / 5, -bw / 3, bw / 3]);
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
        // peak marks along the crest. Not a centerline of peaks, and not a
        // constant-width ribbon either: the belt is a variable-width
        // polygon that tapers to tips at the ends (no bulging into the
        // sea) and swells and wavers along its length, phase-keyed to the
        // ridge's identity so each range has its own profile.
        const beltW = r.beltW ?? 28;
        const lp = r.polyline;
        const cum: number[] = [0];
        for (let i = 1; i < lp.length; i++) cum.push(cum[i - 1]! + Math.hypot(lp[i]!.x - lp[i - 1]!.x, lp[i]!.y - lp[i - 1]!.y));
        const total = cum[cum.length - 1]! || 1;
        const phase = (hashString(entityAnchor(e) ?? e.name ?? "ridge") % 628) / 100;
        const wAt = (t: number): number => {
          const taper = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.6);
          const wobble = 1 + 0.18 * Math.sin(4.3 * Math.PI * t + phase);
          return beltW * (0.18 + 0.82 * taper) * wobble;
        };
        const leftSide: XY[] = [];
        const rightSide: XY[] = [];
        for (let i = 0; i < lp.length; i++) {
          const prev = lp[Math.max(0, i - 1)]!;
          const next = lp[Math.min(lp.length - 1, i + 1)]!;
          const dx = next.x - prev.x;
          const dy = next.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          const hw = wAt(cum[i]! / total) / 2;
          leftSide.push({ x: lp[i]!.x + (dy / len) * hw, y: lp[i]!.y - (dx / len) * hw });
          rightSide.push({ x: lp[i]!.x - (dy / len) * hw, y: lp[i]!.y + (dx / len) * hw });
        }
        const beltPoly = [lp[0]!, ...leftSide, lp[lp.length - 1]!, ...[...rightSide].reverse()];
        const count = Math.max(2, Math.floor(total / Math.max(14, beltW * 0.55)));
        const peaks: string[] = [];
        for (let i = 0; i <= count; i++) {
          const t = i / count;
          const wLoc = wAt(t);
          // Peaks scale with the LOCAL width — smaller toward the tapered
          // ends — and stagger off-crest so the belt reads as a massif.
          const s = wLoc * (i % 3 === 1 ? 0.2 : 0.26);
          if (s < 2.5) continue;
          const { p, dir } = alongAt(lp, t);
          const side = i % 2 === 0 ? 1 : -1;
          const offAmt = (i % 3 === 0 ? 0 : wLoc * 0.18) * side;
          const px = p.x + dir.y * offAmt;
          const py = p.y - dir.x * offAmt;
          peaks.push(`M${fmt(px - s)} ${fmt(py + s * 0.7)}L${fmt(px)} ${fmt(py - s)}L${fmt(px + s)} ${fmt(py + s * 0.7)}`);
        }
        massifs.push({ anchor, titleEl, poly: beltPoly, peaks: peaks.join(""), fill: wordFill });
      } else {
        const frontier = frontierFills.get(keyOf(e));
        if (frontier) {
          // Zonal frontier: a dotted line ON the boundary it defines. The
          // "solid line" of earlier rounds was never these dots misbehaving
          // — it was separate solid strokes (the generic area outline, then
          // the theme's edge-zone rim) drawn underneath along the same
          // geometry; with those gone, the dots keep their cadence.
          layers.lines.push(
            el("g", { id: anchor }, titleEl,
              el("polyline", { points: pointsAttr(r.polyline), fill: "none", stroke: shade(frontier.fill), "stroke-width": 1.7, "stroke-dasharray": "0.2 6", opacity: 0.9, "stroke-linejoin": "round", "stroke-linecap": "round" }),
            ),
          );
        } else {
        const stroke = theme.pathStroke(chain);
        // Coastlines are shorelines, not rivers: hairline by default (the
        // island outline weight the owner preferred), unless width= says so.
        const width = Number(pairOf(e.pairs, "width") ?? (chain.includes("coastline") ? 1.2 : 2));
        const lineParts: string[] = [titleEl];
        // Double where the stroke will be clipped to one side, so the half that
        // survives is the width that was asked for.
        const oneSided = chain.includes("coastline") && theme.bank(chain) !== "both" && hasWater;
        const inkW = oneSided ? width * 2 : width;
        const edgeW = theme.edgeWidth(chain);
        if (edgeW) {
          const edgeStroke = theme.prop(chain, "stroke", { zone: "edge" }) ?? theme.prop(chain, "fill", { zone: "edge" }) ?? stroke.stroke;
          lineParts.push(
            el("polyline", {
              points: pointsAttr(r.polyline), fill: "none", stroke: edgeStroke,
              ...inkStroke(inkW + 2 * edgeW), "stroke-linejoin": "round", "stroke-linecap": "round",
            }),
          );
        }
        // A path band's CORE is its centre strip (spec 08 §2, #150). Only the
        // edge margins were read here, so half the sentence was inert.
        const coreStroke = theme.prop(chain, "fill", { zone: "core" }) ?? theme.prop(chain, "stroke", { zone: "core" }) ?? stroke.stroke;
        lineParts.push(
          el("polyline", {
            points: pointsAttr(r.polyline), fill: "none", stroke: coreStroke,
            ...inkStroke(inkW), "stroke-dasharray": stroke.dash, "stroke-linejoin": "round", "stroke-linecap": "round",
          }),
        );
        // A coastline stops where an island has merged with it (#165). The
        // island's fill already makes that stretch land; leaving the shore
        // line drawn over it is what made an island touching the shore read
        // as a ring lying across the peninsula.
        //
        // AND IT LIES ON ONE SIDE OF ITSELF (#185, ADR 0034). A stroke centred
        // on a boundary puts half its ink on each side, so where two shores
        // approach, the two water-side halves meet and fill the channel
        // between them — the passage is not thin, it is painted over. Clipped
        // to the water, a border can only ever darken water, so a bold theme
        // may make a channel ugly and cannot make it disappear.
        //
        // Done by clipping a DOUBLE-WIDTH centred stroke rather than by
        // offsetting the line, which would need the outward normal at every
        // vertex and an answer at every join. The mask keeps the half that
        // belongs to the region, and this file already knew the trick: #165's
        // note that clipping an island's shore to water "comes out
        // half-width" is the same observation, seen as a problem.
        const isCoast = chain.includes("coastline");
        const bank = isCoast ? theme.bank(chain) : "both";
        const banked = bank !== "both" && hasWater
          ? [el("g", { mask: `url(#${bank === "water" ? waterMaskId : landMaskId})` }, ...lineParts)]
          : lineParts;
        layers.lines.push(el("g", {
          id: anchor,
          ...(hasIslands && isCoast ? { mask: `url(#${coastMaskId})` } : {}),
        }, ...banked));
        }
      }
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        deferLabel(2, () => {
        const lbl = labelTextFor(model, e) ?? e.name!;
        // The label FOLLOWS the curve it names, but placement is arbitrated:
        // candidate slots along the line, above OR below it (a road that
        // follows a river labels on the opposite side), first free slot wins
        // via the shared placer — same collision discipline as battlemaps.
        // RIDGES label region-style instead (owner): the name sits ON the
        // massif, along the crest, in ink that reads against the belt — a
        // range is a biome, not a road. Its own belt blocks are lifted for
        // the duration so it never self-rejects.
        const isRidge = !!r.ridge;
        const ownBelt = isRidge ? (beltObstacles.get(keyOf(e)) ?? []) : [];
        for (const o of ownBelt) placer.release(o.handle);
        try {
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
        type Cand = { offset: number; above: boolean; size: number; boxes: { cx: number; top: number }[]; wpx: number; penalty: number };
        // Curvature penalty: textPath glyphs mush together on the INSIDE of
        // a bend (the Vakh Teeth's "The" became a sigil) — candidates prefer
        // straight stretches, and the outside of whatever bend remains.
        const bendOf = (offset: number, halfFrac: number, above: boolean): number => {
          const ts = [-1, -0.5, 0, 0.5, 1].map((f) => Math.min(1, Math.max(0, offset + f * halfFrac)));
          const angs = ts.map((t) => {
            const d = alongAt(lp, t).dir;
            return Math.atan2(d.y, d.x);
          });
          let sum = 0;
          let signed = 0;
          for (let i = 1; i < angs.length; i++) {
            let dA = angs[i]! - angs[i - 1]!;
            while (dA > Math.PI) dA -= 2 * Math.PI;
            while (dA < -Math.PI) dA += 2 * Math.PI;
            sum += Math.abs(dA);
            signed += dA;
          }
          // On-crest (ridge) text has no inside/outside — only total bend.
          const inside = !isRidge && ((above && signed < 0) || (!above && signed > 0));
          // Curvature is only a problem past the point where glyph spacing
          // suffers. Charging for it LINEARLY did not merely avoid harmful
          // bends, it maximised straightness — so on a winding river the
          // label landed on the one flat stretch every time, which is the
          // least characteristic part of the feature. Measured on the
          // Middle-earth map: the Bruinen's name sat where its river bends
          // 1.2px while the river itself bends 29px, and the Isen's on 0.7px
          // of 54.4px. Mathematically on the river; visually laid across it.
          return sum * 80 + (inside ? Math.abs(signed) * 120 : 0);
        };
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
          const off = isRidge ? 0 : 9.5;
          // Fine tiling (~12px per box): coarse boxes on a diagonal leave
          // diagonal gaps another diagonal label can slip through unnoticed
          // (the Broken Spine × Understone Way cross).
          const n = Math.max(3, Math.ceil(wpx / 12));
          for (const offset of slots) {
            for (const above of isRidge ? [true] : [true, false]) {
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
              out.push({ offset, above, size, wpx, boxes, penalty: bendOf(offset, halfFrac, above) });
            }
          }
          return out;
        };
        const costOf = (c: Cand): number => c.boxes.reduce((sum, b) => sum + placer.boxCost(b.cx, b.top, c.wpx / c.boxes.length, 9), 0);
        let pick: Cand | null = null;
        for (let size = 10; size >= 8 && !pick; size--) {
          // Among FREE candidates, the least-bent wins (stable on ties).
          let best: Cand | null = null;
          for (const c of candidatesAt(size)) {
            if (costOf(c) !== 0) continue;
            if (!best || c.penalty < best.penalty) best = c;
          }
          pick = best;
        }
        if (!pick) {
          // A big label brushing an obstacle beats a shrunken migrated one:
          // largest size whose least-bad slot only brushes (≤12% of its own
          // area), then floor-size up to half-covered, then omit (spec 07 §5).
          // Bend penalty and slot order RANK the candidates; only the ink
          // that would actually be covered decides whether to accept, shrink
          // or give up. Mixing them meant a stricter curvature rule pushed
          // labels off their courses onto the horizontal fallback entirely —
          // 19 course-following labels became 12 the moment BEND_COST rose.
          // Same defect as #132 in labels.ts: a preference weighed against a
          // threshold it has no business meeting.
          const leastBad = (size: number): { c: Cand; overlap: number } => {
            const finalists = candidatesAt(size);
            let best = finalists[0]!;
            let bestScore = Infinity;
            finalists.forEach((c, i) => {
              const score = costOf(c) + c.penalty + i * size;
              if (score < bestScore) {
                bestScore = score;
                best = c;
              }
            });
            return { c: best, overlap: costOf(best) };
          };
          for (let size = 10; size >= 8 && !pick; size--) {
            const b = leastBad(size);
            if (b.overlap <= b.c.wpx * 9 * 0.12) pick = b.c;
          }
          if (!pick) {
            const b = leastBad(8);
            if (b.overlap > b.c.wpx * 9 * 0.5) {
              // Nothing on the course will take this name. Before dropping it,
              // offer it open space with a leader back to the course, the same
              // rung point markers get (spec 07 §5 rule 3, #133 extended).
              // This is the wall #137 ended at: a river whose whole course is
              // built over — the Entwash under Fangorn, three roads under the
              // settlements they connect — cannot be scored onto a free slot
              // that does not exist, and relocation is the only move left.
              // A leader may meet the course anywhere along it, so the anchor
              // is swept like any other candidate — mid-course first, then
              // outward. Anchoring only at the midpoint left names on rivers
              // whose middle is the most built-over part of them.
              let anchor: XY | null = null;
              let led: ReturnType<typeof placer.placeWithLeader> = null;
              for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
                const a = alongAt(lp, f).p;
                const attempt = placer.placeWithLeader(a.x, a.y, lbl, 10);
                if (attempt) {
                  anchor = a;
                  led = attempt;
                  break;
                }
              }
              if (!led || !anchor) return; // omit before overwriting (spec 07 §5 rule 4)
              const lead = theme.surface("leader", "stroke", ink);
              labelBuckets[2]!.push(
                el("line", {
                  x1: led.from.x, y1: led.from.y, x2: anchor.x, y2: anchor.y,
                  stroke: lead, "stroke-width": 0.6, opacity: 0.55,
                }),
                text(lbl, { x: led.x, y: led.y, "font-size": led.size, fill: ink, opacity: 0.75, "text-anchor": led.anchor, "font-style": "italic", "font-family": "sans-serif" }),
              );
              return;
            }
            pick = b.c;
          }
        }
        // A label too bent to read is not a label (the Vakh Teeth's "The"
        // became a sigil — the name spanned 60% of a sharply-bent spur, so
        // NO slot could straighten it). Past a bend threshold, abandon the
        // textPath and set the name straight beside the feature instead.
        if (pick!.penalty >= 60) {
          // Too bent for a textPath. A ridge name stays ON its massif
          // (region-style); other features label straight beside the line.
          const midp = alongAt(lp, 0.5).p;
          const spot = isRidge
            ? placer.placeOrDrop(midp.x, midp.y + 3, lbl, 10, "middle", [0, -24, 24], undefined, (x, y) => {
                const q = nearestOnPolyline(lp, { x, y });
                return Math.hypot(q.x - x, q.y - y) <= (r.beltW ?? 28) / 2;
              })
            : placer.placeOrDrop(midp.x, midp.y - 14, lbl, 10, "middle");
          if (spot) {
            labelBuckets[2]!.push(
              text(lbl, { x: spot.x, y: spot.y, "font-size": spot.size, fill: ink, opacity: isRidge ? 0.9 : 0.75, "font-weight": model.labelsMode === "keyed" ? "bold" : undefined, "text-anchor": "middle", "font-style": "italic", "font-family": "sans-serif" }),
            );
            return;
          }
        }
        for (const b of pick!.boxes) placer.claimBox(b.cx, b.top, pick!.wpx / pick!.boxes.length, 9);
        const pid = `cdlp-${model.doc.docId}-${pathLabelCount++}`;
        const d = `M${fmt(lp[0]!.x)} ${fmt(lp[0]!.y)}` + lp.slice(1).map((pt) => `L${fmt(pt.x)} ${fmt(pt.y)}`).join("");
        const safe = esc(lbl);
        const weight = model.labelsMode === "keyed" ? ' font-weight="bold"' : "";
        labelBuckets[2]!.push(
          `<path id="${pid}" d="${d}" fill="none"/>` +
            `<text font-size="${pick!.size}" fill="${ink}" opacity="${isRidge ? 0.9 : 0.75}" font-style="italic"${weight} text-anchor="middle" font-family="sans-serif">` +
            `<textPath href="#${pid}" startOffset="${fmt(pick!.offset * 100)}%"><tspan dy="${fmt(isRidge ? 3.5 : pick!.above ? -5 : 12)}">${safe}</tspan></textPath></text>`,
        );
        } finally {
          for (const o of ownBelt) o.handle = placer.tempBlock(o.spec[0], o.spec[1], o.spec[2], o.spec[3], 0.3);
        }
        });
      }
      continue;
    }

    // A solitary peak (#95): the massif language at a single point. Erebor's
    // whole meaning is that it stands alone, and `mountains … blob size=` drew
    // a small round region — the silhouette that says "one mountain" existed
    // only inside ridge belts, with no point-scale entry. A theme may swap the
    // motif (`volcano` for a crater and plume) exactly as `licorice-forest`
    // swaps a forest's; absent one, the derived word still reads as high
    // ground because it inherits the peak silhouette.
    if (r.point && chain.includes("peak")) {
      const themed = theme.glyphFor(chain, r.point.x, r.point.y);
      const s = 11;
      const { x, y } = r.point;
      const fill = theme.terrainFill(chain);
      layers.areas.push(
        el("g", { id: anchor }, titleEl,
          themed
            ? glyphEl(themed, x, y, 1, ink)
            : el("path", {
                // A volcano is a truncated cone with a crater notch, so the
                // derivation reads on the map and not only in the name — the
                // complaint that motivated this was that "nothing volcanic
                // survives". A theme may still swap the whole motif.
                d: chain.includes("volcano")
                  ? `M${fmt(x - s)} ${fmt(y + s * 0.7)}L${fmt(x - s * 0.42)} ${fmt(y - s * 0.55)}L${fmt(x - s * 0.16)} ${fmt(y - s * 0.28)}L${fmt(x + s * 0.16)} ${fmt(y - s * 0.28)}L${fmt(x + s * 0.42)} ${fmt(y - s * 0.55)}L${fmt(x + s)} ${fmt(y + s * 0.7)}Z`
                  : `M${fmt(x - s)} ${fmt(y + s * 0.7)}L${fmt(x)} ${fmt(y - s)}L${fmt(x + s)} ${fmt(y + s * 0.7)}Z`,
                fill, stroke: shade(fill), ...inkStroke(1.2), "stroke-linejoin": "round",
              }),
        ),
      );
      // ERUPTING IS DRAWN (#206). `volcano` declares two states and both
      // rendered as the same cone, so a map could say a mountain was in
      // eruption and show a mountain at rest. The crater silhouette above
      // already existed to hang this on.
      //
      // `dormant` deliberately has NO mark, and that is the written reason
      // rather than an omission: a dormant volcano IS the resting cone, so the
      // state states explicitly what the silhouette already says. Drawing a
      // second symbol for it would invent a distinction the world does not
      // have. What must not happen — and did — is `erupting` reading as rest.
      if (chain.includes("volcano") && e.flags.includes("erupting")) {
        const plume = shade(theme.terrainFill(chain));
        layers.areas.push(el("g", {},
          // A column of smoke leaving the crater, widening as it rises: three
          // lobes rather than a cloud, so it reads at map scale where a
          // detailed puff would silt up into a blob.
          el("path", {
            d: `M${fmt(x - s * 0.16)} ${fmt(y - s * 0.28)}`
              + `C${fmt(x - s * 0.5)} ${fmt(y - s * 0.9)} ${fmt(x + s * 0.35)} ${fmt(y - s * 1.15)} ${fmt(x - s * 0.1)} ${fmt(y - s * 1.75)}`
              + `C${fmt(x - s * 0.6)} ${fmt(y - s * 2.3)} ${fmt(x + s * 0.7)} ${fmt(y - s * 2.35)} ${fmt(x + s * 0.25)} ${fmt(y - s * 2.9)}`,
            fill: "none", stroke: plume, "stroke-width": 1.6, "stroke-linecap": "round", opacity: 0.75,
          }),
          el("circle", { cx: x + s * 0.25, cy: y - s * 3.1, r: s * 0.26, fill: plume, opacity: 0.5 }),
        ));
        // The plume is part of the mark, so a label must not sit in it.
        placer.block(x - s, y - s * 3.4, s * 2, s * 2.4, 2);
      }
      placer.block(x - s, y - s, s * 2, s * 2, 2);
      if (e.name && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model)) {
        deferLabel(1.2, () => {
          const lbl = labelTextFor(model, e) ?? e.name!;
          const spot = placer.placeBesideOrDrop(x + s + 3, x - s - 3, y + 4, lbl, 11);
          if (!spot) return;
          labelBuckets[1]!.push(
            text(lbl, { x: spot.x, y: spot.y, "font-size": spot.size, fill: ink, "text-anchor": spot.anchor, "font-family": "sans-serif" }),
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
      //
      // No `note` arm here (#227): free text returns above and `continue`s, so
      // nothing with `note` in its chain reaches this branch. A mutation test
      // proved the arm dead against the whole suite and every example.
      const label =
        (e.name !== null ? (labelTextFor(model, e) ?? e.name) : null) ??
        (hasTierGlyph(chain) ? null : e.typeWord);
      if (label && !e.flags.includes("nolabel") && !overridden(e) && labelsOn(model, e)) {
        const pt = r.point;
        // Claims AFTER line labels (2), not before (ADR 0019). A point name
        // displaced from its marker recovers via a leader; a river's name set
        // aside from its river does not — it becomes a caption pointing at
        // water. So the kind that cannot move claims first. Within the point
        // tier, importance = marker size: capitals before towns before minor
        // features, so the less-important name gives way first.
        deferLabel(2.2 + (24 - tier.font) / 100, () => {
          const spot = placer.placeBesideOrDrop(pt.x + tier.r + 3, pt.x - tier.r - 3, pt.y + 4, label, tier.font);
          if (!spot) {
            // Every adjacent slot failed at every size. Before giving the name
            // up, try open space with a leader line to carry the association
            // (spec 07 §5, #133) — this competes with omission, not with good
            // placement, so a connected name beats no name.
            const led = placer.placeWithLeader(pt.x, pt.y, label, tier.font);
            if (!led) return; // omit before overwriting (spec 07 §5)
            const lead = theme.surface("leader", "stroke", ink);
            labelBuckets[1]!.push(
              el("line", {
                x1: led.from.x, y1: led.from.y, x2: pt.x, y2: pt.y,
                stroke: lead, "stroke-width": 0.6, opacity: 0.55,
              }),
              text(label, { x: led.x, y: led.y, "font-size": led.size, "font-weight": tier.weight, fill: ink, "text-anchor": led.anchor, "font-family": "sans-serif" }),
            );
            return;
          }
          labelBuckets[1]!.push(
            // text-anchor is ALWAYS written: SVG's default is start, so an
            // omitted "middle" renders shifted right (the clipped Deepwatch).
            text(label, { x: spot.x, y: spot.y, "font-size": spot.size, "font-weight": tier.weight, fill: ink, "text-anchor": spot.anchor, "font-family": "sans-serif" }),
          );
        });
      }
    }
  }

  // AN ISLAND WITH NO WATER AROUND IT (#164). Spec 05 §2: "an island rises
  // above the sea that surrounds it" — so an island whose footprint lies
  // wholly on land is a sentence the document can write and the renderer will
  // draw, as a stroked contour on open grass with a place-name beside it.
  //
  // Nobody notices while authoring, because at full-map zoom it reads as a
  // faint mark and nothing says otherwise: on the Puget Sound exercise map
  // NINE of fifteen islands were misplaced, in the map's headline feature.
  // This is the region-map form of #123's door onto solid rock, and strictly
  // easier — a geometric fact rather than an inference about intent.
  //
  // A warning, like every other coherence check, and only for the WHOLLY dry
  // case: an island half a mile offshore legitimately overlaps its shore at
  // map scale, which is #165's business rather than a mistake.
  const waters = waterPolys.map((body) => body.poly);
  if (waters.length) {
    for (const { e, poly } of islandInfos) {
      const named = e.name ? `'${e.name}'` : `the ${e.typeWord ?? "island"} on line ${e.line}`;
      if (!coversWater(poly, waters)) {
        diagnostics.push({
          severity: "warning",
          line: e.line,
          message: `${named} is an island with no water around it — its footprint lies entirely on land. An island rises above the sea that surrounds it (spec 05 §2)`,
        });
        continue;
      }
      // AND THE WEAKER FAILURE THAT MATTERS MORE (#180): still mostly in water,
      // but touching the shore, so the union joins it to the mainland and the
      // document's island is not one on the map. Warned rather than repaired —
      // opening a channel would be the renderer inventing water nobody
      // declared, against "drawn as declared or reported". The author's fixes
      // are real: widen the channel, move it, or stop calling it an island.
      const { wet, at, depth } = surroundedByWater(poly, waters);
      if (wet >= 0.98) continue;
      // Stated as the CONTACT, not as the clearance. "98% of its shore has
      // water beyond it" is true and reads like a clean island, which is the
      // opposite of what it means — at any contact the union welds and the
      // island is gone. The touching share, where it touches, and how far to
      // move it are the three things an author needs to fix it in one edit.
      const share = Math.max(1, Math.round((1 - wet) * 100));
      const where = at ? ` near (${round1(at.x / scale)},${round1(at.y / scale)})` : "";
      const far = depth > 0 ? `, reaching about ${round1(depth / scale)}${mapUnit} inland` : "";
      diagnostics.push({
        severity: "warning",
        line: e.line,
        message: `${named} touches the mainland along ${share}% of its shore${where}${far}, so the two are drawn as one landmass and it is no longer an island. Widen the channel, move it clear, or declare it as land rather than an island (spec 05 §2)`,
      });
    }
  }

  // A CHANNEL TOO NARROW TO SEE IS DRAWN AS A SYMBOL (#185 part 2, ADR 0035).
  //
  // The other half of the passage problem, and a different mechanism: part 1
  // stops a stroke painting a channel shut, and does nothing at all for a
  // channel that is simply smaller than a pixel. The floor is in VIEWPORT
  // units, so magnifying the map by narrowing the viewBox leaves the symbol
  // where it is and lets the true water grow past it — the two converge, and
  // no polygon is touched on the way.
  //
  // NOT REPORTED, unlike the welded island above. This is the drawing
  // convention applied uniformly and undone by zoom, the same standing a
  // river's symbolic 2-unit width already has; a welded island is reported
  // because the map contradicts a claim the document made, which is a
  // different kind of fact.
  for (const [i, ch] of narrowChannels(
    islandInfos.map(({ poly }) => poly),
    waterPolys.map(({ poly }) => poly),
    { width: w, height: h },
  ).entries()) {
    // A hair-fine gap must not report as "0mi across", which reads as the
    // contact #180 warns about rather than as the passage this is drawing.
    const across = ch.narrowest / scale;
    const trueWidth = across >= 0.1 ? `${round1(across)}${mapUnit}`
      : across >= 0.01 ? `${across.toFixed(2)}${mapUnit}`
      : `under 0.01${mapUnit}`;
    layers.lines.push(
      el("g", { id: `cd-channel-${model.doc.docId}-${i}` },
        svgTitle(`this passage is ${trueWidth} across — drawn wider so it can be seen, and narrowing to its true width as you zoom in`),
        el("polyline", {
          points: pointsAttr(ch.spine),
          fill: "none",
          stroke: waterPolys[ch.water]?.fill ?? theme.terrainFill(["sea"]),
          "stroke-width": CHANNEL_FLOOR,
          "vector-effect": "non-scaling-stroke",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })),
    );
  }

  // A RIVER ENDING IN OPEN WATER (#166). Spec 05 §2's "water wins every
  // overlap" is stated for terrain of every kind, on the grounds that it is a
  // property of the map model rather than of one terrain kind — a path band is
  // neither, so it was exempt by omission rather than by decision, and the
  // result is the one thing the rule exists to prevent: something drawn over
  // the sea that should have stopped at it.
  //
  // Reported rather than clipped, because a river crossing water is nearly
  // always a typo rather than a claim, and because the FIX IS A REAL SPELLING
  // that already works — so the diagnostic can name it. Clipping would also
  // have to carve out bridges, fords, canals and `join`, each of which touches
  // water on purpose.
  //
  // `to <coastline> at (…)` and `join <ref>` are those correct spellings, so a
  // course declared either way is never questioned however its curve lands.
  if (waters.length) {
    for (const { e, r, chain } of items) {
      if (!chain.includes("river") || !r.polyline || r.polyline.length < 2) continue;
      const course = e.placements.find(
        (p): p is Extract<Placement, { kind: "relational"; form: "from-to" }> =>
          p.kind === "relational" && p.form === "from-to",
      );
      // EITHER END, not just the last one. Rivers are commonly authored
      // MOUTH-FIRST — `from` the sea and inland — which is how nine of the
      // Puget Sound map's rivers came to start a mile or two offshore.
      // Checking only `to` missed every one of them.
      const ends = [
        { pt: r.polyline[0]!, spelled: course ? course.from.at.kind !== "point" || course.from.join === true : false },
        { pt: r.polyline[r.polyline.length - 1]!, spelled: course ? course.to.at.kind !== "point" || course.to.join === true : false },
      ];
      const body = ends
        .filter((end) => !end.spelled)
        .flatMap((end) => waterPolys.filter((water) => pip(end.pt, water.poly)))[0];
      if (!body) continue;
      const named = e.name ? `'${e.name}'` : `the ${e.typeWord ?? "river"} on line ${e.line}`;
      const into = body.name ? `'${body.name}'` : "open water";
      diagnostics.push({
        severity: "warning",
        line: e.line,
        // No coordinates in the suggestion: the endpoint is known here in
        // RENDERED units, and quoting those back at an author writing map
        // units would be worse than saying nothing.
        message: `${named} ends inside ${into} — it is drawn across the water and out the far side. Declare that end at the shore, with 'to <coastline> at (…)' or 'from <coastline> at (…)' (spec 05 §2, 02 §7)`,
      });
    }
  }

  // Massifs emit FIRST among lines (beneath rivers and roads that cross
  // them), one group per fill with group-level opacity so overlaps merge.
  if (massifs.length) {
    const groups: string[] = [];
    for (const fill of [...new Set(massifs.map((m) => m.fill))]) {
      const mine = massifs.filter((m) => m.fill === fill);
      groups.push(
        el("g", { opacity: 0.55, mask: landMask },
          ...mine.map((m) => el("g", { id: m.anchor }, m.titleEl, el("polygon", { points: pointsAttr(m.poly), fill }))),
        ),
      );
      groups.push(
        el("path", { d: mine.map((m) => m.peaks).join(""), fill: "none", stroke: shade(fill), "stroke-width": 1.4, opacity: 0.8, "stroke-linejoin": "round", "stroke-linecap": "round", mask: landMask }),
      );
    }
    layers.lines.unshift(...groups);
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
            el("g", {}, title ? svgTitle(title) : "",
              el("polyline", { points: pointsAttr(pts), fill: "none", stroke: stateFill, "stroke-width": 7, opacity: 0.25, "stroke-linejoin": "round", "stroke-linecap": "round" }),
              el("polyline", { points: pointsAttr(pts), fill: "none", stroke, "stroke-width": 1.6, "stroke-dasharray": "9 4 2 4", opacity: 0.9, "stroke-linejoin": "round", "stroke-linecap": "round" }),
            ),
          );
        } else if (!info.frame) {
          // Same visual language as stated seams (owner: ONE grammar for
          // borders) — the atlas dash-dot, just lighter and bandless.
          layers.realms.push(
            el("polyline", { points: pointsAttr(pts), fill: "none", stroke: shade(info.fill), ...inkStroke(1.2), "stroke-dasharray": "9 4 2 4", "stroke-opacity": 0.55, "stroke-linejoin": "round" }),
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

  // The land mask (#98): white everywhere, black over every water body, so
  // terrain drawn through it stops at the shore — AND white again over every
  // island, because an island is land (#165). Without that last step a wood
  // declared on an island is masked away by the sea the island sits in.
  const frame = { x: 0, y: 0, width: w, height: h };
  const maskBox = `maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(w)}" height="${fmt(h)}"`;
  const defs: string[] = [];
  if (hasWater) {
    defs.push(
      `<mask id="${landMaskId}" ${maskBox}>` +
        el("rect", { ...frame, fill: "#fff" }) +
        waterPolys.map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#000" })).join("") +
        islandInfos.map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#fff" })).join("") +
        `</mask>`,
    );
  }

  // LAND IS ONE REGION, so a coastline is drawn only where land meets WATER
  // (#165). Every land shape used to stroke its own whole outline regardless
  // of what was already land beneath it, so an island touching the shore drew
  // a ring lying across the peninsula and two overlapping islands drew a lens
  // with a seam through it. At map scale that is the common case rather than
  // an edge case: Bainbridge really is separated from the Kitsap Peninsula by
  // about half a mile of water, which on a 100mi-wide map is thinner than the
  // stroke, so the correct rendering is one merged landmass.
  //
  // Taken as a MASK rather than as a polygon union, which would need a
  // boolean-geometry engine the renderer does not carry (ADR 0007). The result
  // is the same boundary: each island's stroke shows only over water and not
  // over another island, and the mainland's coastline is hidden under every
  // island — so what survives is exactly the outline of the union.
  if (hasWater) {
    defs.push(
      `<mask id="${waterMaskId}" ${maskBox}>` +
        el("rect", { ...frame, fill: "#000" }) +
        waterPolys.map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#fff" })).join("") +
        // Islands are LAND inside the water they sit in, so their own interiors
        // come back out: an island's border must lie on its water side too,
        // and the mask that grants that is the same one.
        islandInfos.map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#000" })).join("") +
        `</mask>`,
    );
  }
  if (hasIslands) {
    islandInfos.forEach(({ poly }, i) => {
      defs.push(
        `<mask id="${insideMaskId(i)}" ${maskBox}>` +
          el("rect", { ...frame, fill: "#000" }) +
          el("polygon", { points: pointsAttr(poly), fill: "#fff" }) +
          `</mask>`,
      );
      defs.push(
        `<mask id="${shoreMaskId(i)}" ${maskBox}>` +
          // No water declared anywhere: nothing to merge against, so show the
          // island whole rather than erasing it.
          (waterPolys.length
            ? el("rect", { ...frame, fill: "#000" }) +
              waterPolys.map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#fff" })).join("") +
              // Every OTHER island, not this one: an island's own interior must
              // not eat its own stroke, or every shore comes out half-width.
              islandInfos.filter((__, j) => j !== i).map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#000" })).join("")
            : el("rect", { ...frame, fill: "#fff" })) +
          `</mask>`,
      );
    });
    defs.push(
      `<mask id="${coastMaskId}" ${maskBox}>` +
        el("rect", { ...frame, fill: "#fff" }) +
        islandInfos.map(({ poly }) => el("polygon", { points: pointsAttr(poly), fill: "#000" })).join("") +
        `</mask>`,
    );
  }
  if (defs.length) body.push(`<defs>${defs.join("")}</defs>`);
  body.push(...layers.water, ...layers.realms, ...layers.areas, ...layers.lines, ...layers.points, ...layers.labels);
}

/**
 * Shrink a letter-spaced label until it fits `maxPx` (floor 8px, spacing
 * scaled proportionally) — no label is too big to exist on the map.
 */
/**
 * Where two polylines first cross, or null. Endpoints touching within a hair
 * do NOT count: a tributary that ends on its trunk meets it, and reporting
 * that as a crossing would fire on every correct confluence (#94).
 */
/**
 * Organic finishing for an `area` outline (#96). Spec 02 §9 has always said a
 * renderer "finishes organically"; coastlines, blobs and ridge belts got it and
 * `area` did not, so a forest drawn as a shaped silhouette came out a
 * straight-edged polygon — a surveyor's boundary, not a wood. The only way to
 * fake curves was thirty hand-placed points per patch.
 *
 * Control points are subdivided and nudged perpendicular to the local edge, at
 * an amplitude proportional to that edge's own length, so a large patch ripples
 * at the scale of a large patch and a small one does not dissolve. Then the
 * whole ring is splined. Seeded by identity, so the same document renders the
 * same wood every time (spec 02 §8.2).
 *
 * EVERY NUMBER HERE IS RELATIVE TO THE SHAPE, and that is the fix for #203
 * rather than a tidying. The two constants this used to carry — skip an edge
 * under 8 units, cap the nudge at 16 — were in RENDERED units, which are a
 * fraction of the canvas rather than a distance, so the same declaration drew a
 * different shape at a different `extent:`. Measured on the Puget Sound map, an
 * island's drawn centroid moved 0.16mi between a 100mi and a 350mi extent and
 * its bounding box grew 1.3%, which was enough to close a 0.1mi channel and
 * make `check` report a welded island on a document that passed at the other
 * extent. Spec 05 §4 and ADR 0023 both forbid that; neither anticipated
 * `extent:` as an input to a shape.
 *
 * They are not re-expressed in MILES either, which was the first proposal. The
 * committed examples run from a 12mi survey to a 1600mi continent, where the
 * old gate works out at 0.12mi and 15.61mi — a 133x spread that no single
 * distance can serve. A fraction of the shape's own extent works at every
 * scale, and it is the model `organicMass` already uses for the same job
 * (ADR 0025: texture is "a pure function of the arguments").
 *
 * The one absolute floor left is `QUANTUM`, and it is legitimate because below
 * the output's own precision the geometry cannot be expressed at all (#176).
 */
function organicOutline(pts: XY[], seed: number): XY[] {
  const random = rng(seed);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  // The shape's own diagonal — what "large" and "small" mean for this outline.
  const extent = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // Texture may not become silhouette: past this the author's own outline stops
  // governing the shape. It almost never binds — an edge has to run beyond two
  // thirds of the whole shape's diagonal to reach it — which is the point, and
  // is why the old 16-unit cap could sit there for so long looking harmless.
  const cap = extent * 0.15;
  const out: XY[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // Degenerate only. Any edge the output can express gets its texture, and an
    // edge too short for the texture to be SEEN still gets it — sub-pixel
    // wiggle costs two vertices and nothing else, where skipping it moves the
    // land.
    if (len < QUANTUM) continue;
    const nx = -dy / len;
    const ny = dx / len;
    // Two intermediate points per edge: enough to read as ragged, few enough
    // that the author's silhouette still governs the shape.
    for (const t of [0.34, 0.68]) {
      const amp = (random() - 0.5) * Math.min(len * 0.22, cap);
      out.push({ x: a.x + dx * t + nx * amp, y: a.y + dy * t + ny * amp });
    }
  }
  return catmullRom(out, 5, true);
}

function firstCrossing(a: XY[], b: XY[]): XY | null {
  const NEAR = 1.5;
  const ends = [a[0]!, a[a.length - 1]!, b[0]!, b[b.length - 1]!];
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const hit = segmentIntersection(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!);
      if (!hit) continue;
      if (ends.some((e) => Math.hypot(e.x - hit.x, e.y - hit.y) <= NEAR)) continue;
      return hit;
    }
  }
  return null;
}

function segmentIntersection(p1: XY, p2: XY, p3: XY, p4: XY): XY | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null; // parallel: a shared bank, not a crossing
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

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


/**
 * Does any part of this footprint lie in water? (#164)
 *
 * SAMPLED rather than solved. An exact polygon intersection would be a
 * boolean-geometry engine, which the renderer deliberately does not carry
 * (ADR 0007 keeps it free of runtime dependencies), and the question is
 * coarse by design: "is there ANY water under this", not "how much of it".
 *
 * The grid can miss a very thin island — a `reach=0.15` skerry is a few pixels
 * across — so a footprint no sample lands inside falls back to its own
 * vertices and centre. Reporting a real island because the sampler was too
 * coarse would be worse than the defect this exists to catch.
 */
function coversWater(poly: XY[], waters: XY[][]): boolean {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const STEPS = 12;
  const inside: XY[] = [];
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / STEPS, y: y0 + ((y1 - y0) * j) / STEPS };
      if (pip(p, poly)) inside.push(p);
    }
  }
  const probes = inside.length ? inside : [...poly, centroid(poly)];
  return probes.some((p) => waters.some((water) => pip(p, water)));
}

/**
 * What fraction of the ring JUST OUTSIDE this outline lies in water (#180).
 *
 * The navigational question, asked geometrically: could a reader sail round
 * it? An island a boat can circle has water beyond every part of its shore.
 * Where its outline crosses the coast, #165's union welds the two and the
 * document's island quietly becomes a lobe of the mainland — which #164 does
 * not catch, because that fires only when a footprint is WHOLLY dry, and the
 * cases that matter are mostly wet. Measured on the exercise map, Harstine was
 * 68% in water and joined at its southern end, and nothing said so; the map
 * then denied a passage that boats actually use.
 *
 * Probed just outside rather than at the outline itself, because a vertex on
 * the shared boundary belongs to both and answers neither. The offset is small
 * on purpose: a channel only has to be wider than this to count, so a narrow
 * but genuine passage stays an island. Outward is found per edge by testing
 * the normal against the outline, so a concave shape — Harstine is a wishbone
 * — is probed correctly along its notch rather than from a centroid that lies
 * outside it.
 */
interface Contact {
  /** Fraction of the ring outside the outline that lies in water. */
  wet: number;
  /** The worst point of contact, or null where there is none. */
  at: XY | null;
  /** How far that point is from open water — how far the island must move. */
  depth: number;
}

function surroundedByWater(poly: XY[], waters: XY[][]): Contact {
  if (poly.length < 3) return { wet: 1, at: null, depth: 0 };
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // A FRACTION OF THE ISLAND, floored only at what the output can express
  // (#203). This used to floor at 0.5 RENDERED units, which is 0.061mi on a
  // 100mi map and 0.214mi on a 350mi one — so the probe stepped three and a
  // half times further off the shore at the wider extent, and this check gave
  // a different answer about the same island on the same document. A rule
  // about whether two landmasses touch cannot depend on how big the picture
  // is printed.
  const step = Math.max(QUANTUM, diag * 0.01);
  const dry: XY[] = [];
  let wet = 0;
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let n = { x: -dy / len, y: dx / len };
    if (pip({ x: mid.x + n.x * step, y: mid.y + n.y * step }, poly)) n = { x: -n.x, y: -n.y };
    const probe = { x: mid.x + n.x * step, y: mid.y + n.y * step };
    total++;
    if (waters.some((water) => pip(probe, water))) wet++;
    else dry.push(probe);
  }
  if (total === 0) return { wet: 1, at: null, depth: 0 };
  // WHERE IT TOUCHES, AND HOW FAR IN. A bare percentage is not actionable, and
  // at 98% it actively misleads — that reads like a clean island when it means
  // the union has welded the two. The author still has to find which end is
  // touching and guess how far to move it, which on a long island is several
  // edits. The deepest dry probe is the worst point of contact, and its
  // distance to open water is how far the island has to move to clear it.
  let at: XY | null = null;
  let depth = 0;
  for (const p of dry) {
    let best = Infinity;
    for (const water of waters) {
      for (let i = 0; i < water.length; i++) {
        const a = water[i]!;
        const b = water[(i + 1) % water.length]!;
        const q = nearestOnSegment(a, b, p);
        best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
      }
    }
    if (Number.isFinite(best) && best >= depth) {
      depth = best;
      at = p;
    }
  }
  return { wet: wet / total, at, depth };
}

/** The point on segment a..b nearest to p. */
function nearestOnSegment(a: XY, b: XY, p: XY): XY {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return a;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function halfPlanePolygon(hp: { compass: string; of: XY[] }, w: number, h: number): XY[] {
  // The boundary line's ends extend laterally to the viewport edges before
  // the polygon closes on the compass side — a half-plane spans the FULL
  // map beyond the frontier, not just the stretch the line happens to
  // cover (a frostline trimmed to the coasts still freezes the corners).
  const line = hp.of;
  const first = line[0]!;
  const last = line[line.length - 1]!;
  const c = hp.compass;
  if ((c.includes("n") || c.includes("s")) && !c.includes("e") && !c.includes("w")) {
    const edgeY = c.includes("n") ? 0 : h;
    const ltr = first.x <= last.x;
    const x0 = ltr ? 0 : w;
    const x1 = ltr ? w : 0;
    return [{ x: x0, y: first.y }, ...line, { x: x1, y: last.y }, { x: x1, y: edgeY }, { x: x0, y: edgeY }];
  }
  const edgeX = c.includes("w") ? 0 : w;
  const ttb = first.y <= last.y;
  const y0 = ttb ? 0 : h;
  const y1 = ttb ? h : 0;
  return [{ x: first.x, y: y0 }, ...line, { x: last.x, y: y1 }, { x: edgeX, y: y1 }, { x: edgeX, y: y0 }];
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

/** Direction of the declared course nearest a point, as an angle in radians. */
function tangentAngle(controls: XY[], at: XY): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < controls.length; i++) {
    const a = controls[i]!;
    const b = controls[i + 1]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.hypot(mid.x - at.x, mid.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return best;
}
