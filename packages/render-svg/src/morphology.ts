/**
 * Placed morphology (spec 05 §4, #93, ADR 0023): discrete features that
 * deform a line locally, each one declared data rather than generated noise.
 *
 * The geometry is deliberately small and pure. A feature's shape is a function
 * of (kind, anchor, size, host curve) and nothing else — no seed, no ordinal,
 * no dependence on other entities — because ADR 0023's whole point is that a
 * feature must not move under an unrelated edit.
 *
 * A FEATURE IS AN OUTLINE SPLICED INTO ITS HOST, not a displacement of the
 * host's own vertices (#163). The first model displaced each vertex in the
 * window by a raised cosine — that is, it made depth a FUNCTION OF POSITION
 * ALONG THE COAST, a graph. A graph cannot have parallel sides: to reach the
 * depth of a fjord within the width of its mouth it must climb almost
 * vertically, and where an almost-vertical climb turns back to horizontal the
 * radius of curvature collapses. Measured on a 20-unit inlet three times as
 * deep, that radius was 0.013 units — two hundred times finer than any sampling
 * a renderer can afford, so every inlet on the map was drawn as a polygon with
 * 60-90 degree corners.
 *
 * Inverting the dependence fixes it at the root: HALF-WIDTH AS A FUNCTION OF
 * DEPTH. A trench is then a nearly-constant function over a long interval,
 * which is the flat direction rather than the steep one, and every radius in
 * the shape — mouth fillet, flank, head — is a fraction of the feature's own
 * size instead of a vanishing quantity. Each piece is then sampled at ITS OWN
 * radius, so the vertex count follows the shape's detail rather than the map's
 * extent.
 */

import type { XY } from "./util";

/** What a feature's geometry does to its host (the `morph=` facet). */
export type Morph = "jut" | "bite" | "detached";

export interface PlacedFeature {
  morph: Morph;
  /** Where on the host it sits, in rendered coordinates. */
  anchor: XY;
  /** Extent along the host, in rendered units — the width of the mouth. */
  size: number;
  /**
   * Which way is SEAWARD, as a unit vector — resolved from the map, not
   * declared on the feature (spec 05 §4). A cape juts toward this; a bay bites
   * away from it. Absent, the caller could not tell a headland from a harbour,
   * so the renderer says so rather than guessing.
   */
  seaward?: XY;
  /**
   * How far the feature reaches ACROSS the host, as a multiple of `size`.
   *
   * Without it a word is decorative: `cove`, `sound` and `fjord` at the same
   * size drew the identical shape and differed only in colour, which is no use
   * on a coast whose whole character is that Hood Canal is long and narrow
   * while a cove is a shallow scoop. It comes from the vocabulary (`reach=`),
   * so derivation carries it and an author can override it per entity.
   */
  reach?: number;
  /**
   * What fraction of the feature's DEPTH is spent converging, 0..1 (#158).
   *
   * 1 narrows the whole way from mouth to head — a wedge, which is right for a
   * cove and wrong for everything glacial. Hood Canal, Dabob Bay, Case Inlet
   * and Carr Inlet are near parallel-sided, because a drowned valley is a
   * trench rather than a notch. Below 1 the sides run parallel for the first
   * part of the depth and converge only near the head.
   */
  taper?: number;
}

/**
 * Which side of a line the water lies on, from the water's OWN declaration.
 *
 * `sea "The Argen Sea" : west of coast` already says it, so an author never
 * restates it on each cape — and because it is a compass direction rather than
 * a winding rule, it holds however the coastline happens to be drawn. Reversing
 * a coastline's `from`/`to` must not turn its headlands into bays.
 */
export function seawardSign(normal: XY, seaward: XY | undefined): number {
  if (!seaward) return 1;
  return normal.x * seaward.x + normal.y * seaward.y >= 0 ? 1 : -1;
}

/** Fallback reach for a word that declares none. */
const ASPECT = 0.55;

/** Below this a feature is smaller than the curve's own sampling and cannot read. */
const MIN_SIZE = 1e-6;

/** Uniform vertex spacing for the HOST curve, in rendered units. */
const SPACING = 2;

/**
 * Radius of the fillet where a feature's flank meets the coast, as a fraction
 * of its half-width. An inlet meets the shore at a corner — that is what an
 * inlet is — but a corner with a radius, not a vertex. This is also what makes
 * the mouth the widest part of the shape: the opening spans the full declared
 * `size=` and the channel inside it is narrower by twice the fillet.
 */
const MOUTH_FILLET = 0.25;

/**
 * Narrowest a head may be, as a fraction of the flank half-width.
 *
 * The head is a semicircle of the half-width the flanks have converged to, so
 * `taper=` alone decides how pointed the feature is — but a radius of zero is
 * a cusp, which `isSmooth` is right to refuse, so even a full wedge ends in a
 * small round tip rather than a point.
 */
const MIN_HEAD = 0.08;

/**
 * Vertices per radius of curvature. The turn at each vertex is then 1/this
 * radians by construction, so the whole shape is smooth at whatever scale it
 * is drawn: at 12 that is 4.8 degrees, comfortably inside the 20 degrees #163
 * asks for, and it costs points only where the shape actually curves.
 */
const PER_RADIUS = 12;

/** Backstop so a pathological extent cannot allocate without bound. */
const MAX_POINTS = 6000;

/**
 * Vertex spacing for a host carrying these features.
 *
 * Under the outline model this no longer depends on the features at all — each
 * one brings its own sampling, set by its own radii — but it stays exported
 * because tests build a comparable baseline from it, and because a caller
 * should not have to know that the answer is now a constant.
 */
export function spacingFor(_features: PlacedFeature[]): number {
  return SPACING;
}

/**
 * Re-space a polyline's vertices evenly along its arc length, preserving its
 * shape. Endpoints are kept exactly; everything between is interpolated.
 */
export function resample(curve: XY[], spacing: number): XY[] {
  if (curve.length < 2) return curve;
  const arc = arcLengths(curve);
  const total = arc[arc.length - 1]!;
  if (total <= 0) return curve;
  const steps = Math.min(Math.max(Math.ceil(total / spacing), 2), MAX_POINTS);
  const out: XY[] = [];
  let seg = 0;
  for (let i = 0; i <= steps; i++) {
    const target = (total * i) / steps;
    while (seg + 2 < curve.length && arc[seg + 1]! < target) seg++;
    const a = curve[seg]!;
    const b = curve[seg + 1]!;
    const span = arc[seg + 1]! - arc[seg]!;
    const t = span > 0 ? (target - arc[seg]!) / span : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Why a feature could not be drawn as written.
 *
 * Three genuinely different problems with three different fixes, so they are
 * three values rather than one. Reporting an overlap as a fold would send an
 * author to shrink a feature that fits perfectly well and merely collides with
 * a neighbour — a diagnostic naming the wrong cause is the same silent
 * plausibility this phase keeps rooting out, arriving as prose.
 */
export type RejectReason =
  /** The shape would cross the course, or come to a cusp on it. */
  | { kind: "fold" }
  /** Half the mouth would sit off the end of the host: there is no coast there. */
  | { kind: "off-end" }
  /** Another feature already claims this stretch of the host. */
  | { kind: "overlap"; other: PlacedFeature };

/** A feature resolved against its host: where its window sits, and which way it goes. */
interface Sited {
  f: PlacedFeature;
  /** Arc position of the anchor on the resampled host. */
  at: number;
  /** Half the mouth width, in arc length. */
  half: number;
  /** Signed depth: the direction and distance the head lies from the coast. */
  depth: number;
  /** Unit normal at the anchor — the ONE direction the whole feature travels. */
  dir: XY;
}

/**
 * Apply every feature hosted on this curve, in one pass.
 *
 * Features are accepted in DOCUMENT ORDER — an author reading their own file
 * top to bottom sees the same decisions the renderer made — but spliced by arc
 * position, and every window is measured on the UNDEFORMED host. Measuring on
 * the running result was a real defect: the first inlet spliced in tens of
 * units of new arc length, so the second one's window covered a different
 * stretch of coast than the same declaration would have covered alone.
 */
export function deformCurve(
  curve: XY[],
  features: PlacedFeature[],
  onReject?: (f: PlacedFeature, why: RejectReason) => void,
): XY[] {
  // RESAMPLED TO A UNIFORM SPACING FIRST, and this is load-bearing rather than
  // tidying (#154, #155). The window is an arc-length span, so without it the
  // result depended on how many `via` points an author happened to type:
  // adding COLLINEAR points to a straight coast — changing nothing about the
  // line — doubled the deepest drawable feature. And a `from … to` course with
  // no via points splines to two points, so the window covered the whole coast.
  const host = resample(curve, SPACING);
  const arc = arcLengths(host);
  const total = arc[arc.length - 1] ?? 0;

  const accepted: Sited[] = [];
  let out = host;
  for (const f of features) {
    if (f.morph === "detached" || f.size < MIN_SIZE) continue;
    const sited = site(host, arc, f);
    // A window running off the end of the host cannot be spliced: half the
    // mouth would have no coast to sit on.
    if (sited === null || sited.at - sited.half <= 0 || sited.at + sited.half >= total) {
      onReject?.(f, { kind: "off-end" });
      continue;
    }
    // Two features may not claim the same stretch of coast. Reported rather
    // than composed: overlapping mouths are a contradiction in the document,
    // and blending them silently is how a corner nobody asked for appears
    // between two inlets that are each fine on their own.
    const clash = accepted.find((g) => Math.abs(g.at - sited.at) < g.half + sited.half);
    if (clash) {
      onReject?.(f, { kind: "overlap", other: clash.f });
      continue;
    }
    const next = splice(host, arc, [...accepted, sited]);
    if (!isSimple(next) || !isSmooth(next)) {
      onReject?.(f, { kind: "fold" });
      continue;
    }
    accepted.push(sited);
    out = next;
  }
  return out;
}

/** Resolve a feature against its host: anchor, direction, depth. */
function site(host: XY[], arc: number[], f: PlacedFeature): Sited | null {
  const i = nearestIndex(host, f.anchor);
  if (i < 0) return null;
  const dir = normalAt(host, i);
  // A jut goes SEAWARD and a bite goes landward. The seaward side is resolved
  // from the map (see `seawardSign`) at the anchor, then held constant across
  // the window so the feature stays one coherent shape rather than flipping
  // sides where the curve turns.
  const sign = (f.morph === "bite" ? -1 : 1) * seawardSign(dir, f.seaward);
  return { f, at: arc[i]!, half: f.size / 2, depth: sign * f.size * (f.reach ?? ASPECT), dir };
}

/**
 * Rebuild the host with every accepted feature's outline in place of the
 * stretch of coast it occupies.
 */
function splice(host: XY[], arc: number[], sited: Sited[]): XY[] {
  const order = [...sited].sort((a, b) => a.at - b.at);
  const out: XY[] = [];
  let i = 0;
  for (const s of order) {
    const from = s.at - s.half;
    const to = s.at + s.half;
    while (i < host.length && arc[i]! < from) out.push(host[i++]!);
    for (const p of outlineOf(s.f, s.depth)) {
      // (offset along the coast, depth into the shape) -> rendered coordinates.
      // The base point follows the HOST, so a feature on a curving coast bends
      // with it; the depth is added along ONE direction, the anchor's normal.
      const base = pointAtArc(host, arc, s.at + p.x);
      out.push({ x: base.x + s.dir.x * p.y, y: base.y + s.dir.y * p.y });
    }
    while (i < host.length && arc[i]! <= to) i++;
  }
  while (i < host.length) out.push(host[i++]!);
  return out;
}

/**
 * The outline of one feature in its own frame: `x` is offset along the host
 * from the anchor, `y` is depth (already signed). It runs from (-half, 0) to
 * (+half, 0), so splicing it in leaves the host continuous, and it leaves and
 * rejoins the coast tangentially, so the splice is smooth as well as closed.
 *
 * Five pieces, each sampled at its own radius of curvature:
 *
 *      -half                                    +half
 *        \___                                  ___/     <- mouth fillets (r)
 *            |                                |
 *            |                                |         <- flanks: half-width
 *             \                              /             a, converging to b
 *              \____________________________/             over the last
 *                       (   head   )                       `taper` of the depth
 */
function outlineOf(f: PlacedFeature, depth: number): XY[] {
  const half = f.size / 2;
  const D = Math.abs(depth);
  const s = Math.sign(depth) || 1;
  const t = Math.min(Math.max(f.taper ?? 1, 0), 1);
  const r = MOUTH_FILLET * Math.min(half, D);
  const a = half - r;                             // half-width of the channel
  // HOW MUCH it narrows is `taper`'s to say, not a constant's. Fixing the head
  // at a fraction of the mouth made every inlet neck to the same arrowhead
  // whatever its word, so `taper` chose only WHERE the narrowing happened —
  // and a fjord, whose whole character is being parallel-sided to its head,
  // came out as a spearpoint. At taper=1 this is the wedge the spec describes;
  // near 0 the flanks run parallel and the head is a broad round bight.
  const b = Math.max(a * (1 - t), a * MIN_HEAD);  // radius of the rounded head
  const inner = D - b;                            // depth at which the head begins

  // Too shallow to hold a fillet, a flank and a head in sequence: a scoop
  // rather than an inlet. A half-ellipse is the same shape with the flanks
  // taken out, and has the same guarantees (finite radius everywhere).
  if (inner <= r) return ellipse(half, s * D);

  const pts: XY[] = [];
  // Each piece carries both its endpoints so it can be read on its own; the
  // shared vertex at a junction is dropped here rather than in five places.
  // A repeated point is a zero-length segment, which reads as a spurious turn
  // to `isSmooth` and as a degenerate crossing to `isSimple`.
  const push = (x: number, y: number): void => {
    const p = { x, y: s * y };
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-12) return;
    pts.push(p);
  };

  // Mouth fillet, left: centred (-half, r), from the coast to the flank.
  arcPoints(r, (u) => push(-half + r * Math.sin(u), r - r * Math.cos(u)), Math.PI / 2);
  // Left flank: half-width converging from a to b over the last `t` of the run.
  flankPoints(a, b, r, inner, t, (w, n) => push(-w, n));
  // Head: a semicircle of radius b, so the trench ends in a bight.
  arcPoints(b, (u) => push(-b * Math.cos(u), inner + b * Math.sin(u)), Math.PI);
  // Right flank, mirrored: back down from the head to the fillet.
  flankPoints(a, b, r, inner, t, (w, n) => push(w, n), true);
  // Mouth fillet, right: the left one reflected, walked back out to the coast.
  arcPoints(r, (u) => push(half - r * Math.sin(u), r - r * Math.cos(u)), Math.PI / 2, true);
  return pts;
}

/** A half-ellipse from (-half, 0) to (half, 0), reaching `depth` at its centre. */
function ellipse(half: number, depth: number): XY[] {
  // The tightest radius on a half-ellipse is at whichever end of the axes is
  // sharper; sampling by it keeps a very shallow or very deep scoop equally smooth.
  const R = Math.min(half * half / Math.abs(depth), depth * depth / half);
  const steps = Math.max(8, Math.ceil((Math.PI * Math.max(half, Math.abs(depth))) / (Math.abs(R) / PER_RADIUS)));
  const out: XY[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = Math.PI - (Math.PI * i) / steps;
    out.push({ x: half * Math.cos(u), y: depth * Math.sin(u) });
  }
  return out;
}

/**
 * Sample a circular arc of radius `R` through `sweep` radians, at this
 * renderer's fixed vertices-per-radius. `reverse` walks it the other way, for
 * the mirrored half of a symmetric shape.
 */
function arcPoints(R: number, at: (u: number) => void, sweep: number, reverse = false): void {
  const steps = Math.max(2, Math.ceil(PER_RADIUS * sweep));
  for (let i = 0; i <= steps; i++) {
    const k = reverse ? steps - i : i;
    at((sweep * k) / steps);
  }
}

/**
 * Sample one flank: half-width `a` at the mouth end, converging to `b` at the
 * head, with the convergence confined to the last `t` of the run.
 *
 * The convergence is a raised cosine, so the flank leaves the fillet and meets
 * the head with a matching tangent. Its radius of curvature is
 * `2·ramp²/((a−b)·π²)` — a quantity of the same order as the feature itself,
 * which is the whole reason this model can be drawn (see the file header).
 */
function flankPoints(
  a: number, b: number, r: number, inner: number, t: number,
  at: (w: number, n: number) => void,
  reverse = false,
): void {
  const run = inner - r;
  const ramp = Math.max(t, 1e-6) * run;
  const flat = run - ramp;
  const R = a > b ? (2 * ramp * ramp) / ((a - b) * Math.PI * Math.PI) : Infinity;
  const steps = Math.max(2, Math.min(400, Math.ceil(run / Math.max(R / PER_RADIUS, run / 400))));
  for (let i = 0; i <= steps; i++) {
    const k = reverse ? steps - i : i;
    const n = (run * k) / steps;
    const w = n <= flat ? a : b + (a - b) * 0.5 * (1 + Math.cos((Math.PI * (n - flat)) / ramp));
    at(w, r + n);
  }
}

/** The point at a given arc length along a polyline, interpolated. */
function pointAtArc(curve: XY[], arc: number[], target: number): XY {
  if (target <= 0) return curve[0]!;
  const last = arc[arc.length - 1]!;
  if (target >= last) return curve[curve.length - 1]!;
  let lo = 0;
  let hi = arc.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= target) lo = mid;
    else hi = mid;
  }
  const a = curve[lo]!;
  const b = curve[lo + 1]!;
  const span = arc[lo + 1]! - arc[lo]!;
  const k = span > 0 ? (target - arc[lo]!) / span : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * The curve's left-hand normal at a vertex, from the local tangent.
 *
 * WHICH SIDE IS SEAWARD is the host's to say, not this function's: the caller
 * passes a sign resolved from the water, so a `jut` on a coast drawn in either
 * direction still goes to the same physical side.
 */
function normalAt(curve: XY[], i: number): XY {
  const a = curve[Math.max(0, i - 1)]!;
  const b = curve[Math.min(curve.length - 1, i + 1)]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function arcLengths(curve: XY[]): number[] {
  const out = [0];
  for (let i = 1; i < curve.length; i++) {
    out.push(out[i - 1]! + Math.hypot(curve[i]!.x - curve[i - 1]!.x, curve[i]!.y - curve[i - 1]!.y));
  }
  return out;
}

function nearestIndex(curve: XY[], p: XY): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < curve.length; i++) {
    const d = Math.hypot(curve[i]!.x - p.x, curve[i]!.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Sharpest turn a deformed course may make, in degrees.
 *
 * This is a FOLD detector, not a gentleness rule, and it has been loosened
 * twice under measurement. At 30° it refused legitimate steep bumps on
 * coarsely-sampled curves; at 90° it refused a FJORD, which is a landform
 * whose entire character is being long, narrow and steep-sided. Only a
 * REVERSAL is wrong — the cusp this exists to catch measured 157°.
 */
const MAX_TURN_DEGREES = 135;

/**
 * Does this curve avoid folding to a point? SIMPLICITY IS NOT ENOUGH.
 *
 * A curve can come to a CUSP and turn back without ever crossing itself, so
 * `isSimple` passes it happily while the map shows a spike. Measured on
 * Vessany's Gull Bay: non-self-intersecting, and a 157° turn. It was caught by
 * eye first, then by this number.
 */
export function isSmooth(curve: XY[], limitDegrees = MAX_TURN_DEGREES): boolean {
  const limit = (limitDegrees * Math.PI) / 180;
  for (let i = 1; i + 1 < curve.length; i++) {
    const a = curve[i - 1]!, b = curve[i]!, c = curve[i + 1]!;
    let turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > limit) return false;
  }
  return true;
}

/**
 * Does this polyline avoid crossing itself? ADR 0023 makes this a hard
 * guarantee rather than a quality target: a map that folds over itself is
 * wrong in a way no reader can repair.
 */
export function isSimple(curve: XY[]): boolean {
  const segs = curve.length - 1;
  if (segs < 2) return true;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  // Only a CLOSED ring has a first and last segment sharing an endpoint. The
  // exemption was originally unconditional, which silently forgave a genuine
  // crossing between the ends of an OPEN coastline — caught by the test that
  // asks whether this guard is vacuous, which it was.
  const closed = curve.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9;

  // BROAD-PHASED ON A UNIFORM GRID. Testing every pair is quadratic, which was
  // affordable while a course was a few hundred vertices and is not now that a
  // feature brings its own sampling (#163): a coast carrying a dozen inlets
  // runs to thousands, and `deformCurve` re-checks the whole curve once per
  // feature. The grid changes only the cost — every pair whose bounding boxes
  // meet is still tested exactly, so the answer is identical.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of curve) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const cell = Math.max(Math.hypot(maxX - minX, maxY - minY) / Math.max(16, Math.sqrt(segs)), 1e-9);
  const cols = Math.floor((maxX - minX) / cell) + 1;
  const buckets = new Map<number, number[]>();
  const cellsOf = (i: number): number[] => {
    const a = curve[i]!, b = curve[i + 1]!;
    const gx0 = Math.floor((Math.min(a.x, b.x) - minX) / cell);
    const gx1 = Math.floor((Math.max(a.x, b.x) - minX) / cell);
    const gy0 = Math.floor((Math.min(a.y, b.y) - minY) / cell);
    const gy1 = Math.floor((Math.max(a.y, b.y) - minY) / cell);
    const keys: number[] = [];
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) keys.push(gy * cols + gx);
    return keys;
  };
  for (let i = 0; i < segs; i++) {
    for (const key of cellsOf(i)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
  }
  const tested = new Set<number>();
  for (let i = 0; i < segs; i++) {
    tested.clear();
    for (const key of cellsOf(i)) {
      for (const j of buckets.get(key) ?? []) {
        if (j < i + 2 || tested.has(j)) continue;
        tested.add(j);
        if (closed && i === 0 && j === segs - 1) continue;
        if (segmentsCross(curve[i]!, curve[i + 1]!, curve[j]!, curve[j + 1]!)) return false;
      }
    }
  }
  return true;
}

function segmentsCross(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false; // parallel or degenerate
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  const EPS = 1e-9;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}
