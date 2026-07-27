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

import { catmullRom, type XY } from "./util";

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
  /**
   * The feature's CENTERLINE, as declared controls from the mouth inward (#169).
   *
   * Without it a bite is one straight run of `size × reach`. Hood Canal runs
   * 40mi south-west from Foulweather Bluff and then turns hard east for 15mi at
   * the Great Bend, and that hook is what cuts the barb off the Kitsap
   * Peninsula. A dogleg is not a BRANCH — one mouth, one head — so it is not
   * the `delta`/`fork` line-branching spec 05 §4 stages.
   *
   * Declared, it replaces `reach=`: the centerline's own length is the depth.
   */
  via?: XY[];
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

/**
 * Fallback reach for a word that declares none. Exported because the region
 * renderer needs the same number to work out how deep an inlet runs (#167),
 * and two copies of a default is how they come to disagree.
 */
export const ASPECT = 0.55;

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

/** A feature resolved against its host: where its window sits, and where it runs. */
interface Sited {
  f: PlacedFeature;
  /** Arc position of the anchor on the resampled host. */
  at: number;
  /** Half the mouth width, in arc length. */
  half: number;
  /**
   * The feature's CENTERLINE in rendered coordinates, from the mouth inward.
   *
   * Straight when nothing declares otherwise, and the shape is then exactly
   * what it was before `via` existed. Everything downstream reads only this,
   * so a bent inlet and a straight one are one code path rather than two.
   */
  centre: XY[];
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

/** Resolve a feature against its host: anchor, direction, centerline. */
function site(host: XY[], arc: number[], f: PlacedFeature): Sited | null {
  const i = nearestIndex(host, f.anchor);
  if (i < 0) return null;
  const dir = normalAt(host, i);
  // A jut goes SEAWARD and a bite goes landward. The seaward side is resolved
  // from the map (see `seawardSign`) at the anchor, then held constant across
  // the window so the feature stays one coherent shape rather than flipping
  // sides where the curve turns.
  const sign = (f.morph === "bite" ? -1 : 1) * seawardSign(dir, f.seaward);
  const mouth = host[i]!;
  // DECLARED CONTROLS REPLACE THE GENERATED RAY (#169). `reach=` generates a
  // centerline; `via` states one, and its own length is then the depth — so
  // the two are alternatives rather than a pair, the same way an outline and
  // the dials are for a detached feature (ADR 0026).
  // A MOUTH IS PERPENDICULAR TO ITS COAST. The declared controls say where the
  // feature runs, but the first stretch is not free: the mouth's two corners
  // are pinned to the host, so a centerline that leaves at a skew builds its
  // fillets in one frame while their ends sit in another, and the join comes
  // out as a corner — measured at 73 degrees on a bend whose own curvature was
  // never above 31. A short control along the inward normal makes the shape
  // leave the shore square and bend afterwards, which is also what an inlet
  // does.
  // Proportional to the FIRST LEG, not to the mouth. A short lead against a
  // long leg is exactly the uneven control spacing a Catmull-Rom overshoots on,
  // and the overshoot loops the centerline back on itself near the mouth — so
  // a perfectly reasonable bend was refused as a fold, by a control this code
  // added rather than by anything the author wrote.
  const first = f.via?.[0];
  const step = first ? sign * Math.hypot(first.x - mouth.x, first.y - mouth.y) * 0.3 : 0;
  const centre = f.via && f.via.length > 0
    ? [mouth, { x: mouth.x + dir.x * step, y: mouth.y + dir.y * step }, ...f.via]
    : [mouth, { x: mouth.x + dir.x * sign * f.size * (f.reach ?? ASPECT), y: mouth.y + dir.y * sign * f.size * (f.reach ?? ASPECT) }];
  return { f, at: arc[i]!, half: f.size / 2, centre };
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
    // The mouth's two corners are the host's OWN points at the window edges,
    // so the splice closes exactly however the coast curves there — the rest
    // of the shape is then built outward from them along the centerline.
    out.push(...ribbon(pointAtArc(host, arc, from), pointAtArc(host, arc, to), s.centre, s.f.taper ?? 1));
    while (i < host.length && arc[i]! <= to) i++;
  }
  while (i < host.length) out.push(host[i++]!);
  return out;
}

/**
 * The outline of one feature: a RIBBON along its centerline.
 *
 * `mouthA` and `mouthB` are the host's own points at the window edges, so the
 * splice closes exactly however the coast curves there. Everything else is
 * built outward from them along `centre`, as a half-width that varies with
 * distance travelled:
 *
 *      mouthA                                   mouthB
 *        \___                                  ___/     <- mouth fillets (r)
 *            |                                |
 *            |                                |         <- flanks: half-width
 *             \                              /             a, converging to b
 *              \____________________________/             over the last
 *                       (   head   )                       `taper` of the run
 *
 * A BENT INLET AND A STRAIGHT ONE ARE THE SAME CODE (#169). The centerline is
 * a two-point ray when nothing declares otherwise, so `via` costs no second
 * path and no special case — Hood Canal's Great Bend is the same construction
 * walking a different line.
 */
function ribbon(mouthA: XY, mouthB: XY, centre: XY[], taper: number): XY[] {
  const half = Math.hypot(mouthB.x - mouthA.x, mouthB.y - mouthA.y) / 2;
  const mid = { x: (mouthA.x + mouthB.x) / 2, y: (mouthA.y + mouthB.y) / 2 };
  // A declared dogleg is a BEND, not a corner: splined, so the flanks curve
  // through it the way spec 02 §9's noise-free spline curves a course.
  // Sampled DENSELY, because the ribbon only follows this line — it adds no
  // curvature of its own, so a coarsely-splined bend is drawn as the elbow it
  // was sampled as. At 8 samples per span the Great Bend rendered with two
  // visible corners and a 42 degree turn; the shape is then re-spaced below,
  // so the cost is bounded by the centerline's length rather than by this.
  const spined = centre.length > 2 ? catmullRom([mid, ...centre.slice(1)], 96) : [mid, ...centre.slice(1)];
  const path = resample(spined, Math.max(SPACING / 4, 1e-6));
  const arcs = arcLengths(path);
  const L = arcs[arcs.length - 1]!;
  if (!(L > 0) || !(half > 0)) return [mouthA, mouthB];

  const t = Math.min(Math.max(taper, 0), 1);
  // Below this, two points are the same point. Scale-relative rather than a
  // fixed epsilon: the residue that matters is proportional to the feature,
  // and an absolute guess is right for one map size and wrong for the next.
  const TINY = Math.max(half, L) * 1e-6;
  const r = MOUTH_FILLET * Math.min(half, L);
  const a = half - r;                             // half-width of the channel
  // HOW MUCH it narrows is `taper`'s to say, not a constant's. Fixing the head
  // at a fraction of the mouth made every inlet neck to the same arrowhead
  // whatever its word, so `taper` chose only WHERE the narrowing happened —
  // and a fjord, whose whole character is being parallel-sided to its head,
  // came out as a spearpoint. At taper=1 this is the wedge the spec describes;
  // near 0 the flanks run parallel and the head is a broad round bight.
  const b = Math.max(a * (1 - t), a * MIN_HEAD);  // radius of the rounded head
  const inner = L - b;                            // distance at which the head begins
  const shallow = inner <= r;

  /** Half-width at distance `s` along the centerline. */
  const widthAt = (s: number): number => {
    if (shallow) {
      // Too short to hold a fillet, a flank and a head in sequence: a scoop
      // rather than an inlet. A half-ellipse is the same shape with the flanks
      // taken out, and keeps the same guarantee of a finite radius everywhere.
      return half * Math.sqrt(Math.max(0, 1 - (s / L) ** 2));
    }
    if (s <= r) return half - r * Math.sqrt(Math.max(0, 1 - (1 - s / r) ** 2));
    if (s >= inner) return Math.sqrt(Math.max(0, b * b - (s - inner) ** 2));
    const run = inner - r;
    const ramp = Math.max(t, 1e-6) * run;
    const flat = run - ramp;
    const n = s - r;
    return n <= flat ? a : b + (a - b) * 0.5 * (1 + Math.cos((Math.PI * (n - flat)) / ramp));
  };

  // Sampled per REGION at that region's own radius, so the vertex count follows
  // the shape's detail rather than the map's extent (#163).
  const stops: number[] = [];
  const span = (steps: number, at: (u: number) => number): void => {
    for (let i = 1; i <= steps; i++) stops.push(at(i / steps));
  };
  const QUARTER = Math.max(2, Math.ceil((PER_RADIUS * Math.PI) / 2));
  stops.push(0);
  // THE ROUND REGIONS ARE SAMPLED BY ANGLE, NOT BY DISTANCE. Stepping evenly
  // along the centerline under-samples a circular arc exactly where it turns
  // most — at the lip of the fillet, where the half-width leaves the mouth on
  // a square-root, and at the tip of the head, where it closes on one. Both
  // measured as corners: a 98.7 degree turn at the tip of a taper=1 wedge, and
  // a mouth 8% narrower than declared because its first sample had already cut
  // the corner. Even angle is even turn, which is the whole basis of #163.
  if (shallow) {
    span(Math.max(8, QUARTER * 2), (k) => L * Math.sin((k * Math.PI) / 2));
  } else {
    span(QUARTER, (k) => r * (1 - Math.cos((k * Math.PI) / 2)));
    // The flank's radius of curvature is `2·ramp²/((a−b)·π²)` — of the same
    // order as the feature itself, which is what makes this model drawable.
    const run = inner - r;
    const ramp = Math.max(t, 1e-6) * run;
    const R = a > b ? (2 * ramp * ramp) / ((a - b) * Math.PI * Math.PI) : Infinity;
    const flankSteps = Math.max(2, Math.min(400, Math.ceil(run / Math.max(R / PER_RADIUS, run / 400))));
    span(flankSteps, (k) => r + run * k);
    span(QUARTER, (k) => inner + b * Math.sin((k * Math.PI) / 2));
  }

  // AND BY THE CENTERLINE'S OWN CURVATURE. Everything above samples the WIDTH
  // profile — how fast the shape narrows — which is the only thing that varies
  // when the centerline is straight. A declared bend puts curvature in the
  // other dimension, and the flank is exactly where the width is constant, so
  // nothing was asking for samples through the turn: Hood Canal's Great Bend
  // drew at 42 degrees while every regional radius it contains was under 5.
  //
  // Offset rails are parallel curves, so they turn through the same angle as
  // the line they follow — the requirement is therefore the same one #163
  // already sets everywhere else, `ds ≤ R/PER_RADIUS`, now asked of the
  // centerline. A straight centerline has infinite radius, so this contributes
  // nothing and no existing render moves.
  // Applied as a CEILING ON EVERY GAP rather than as extra stops near the
  // bend, because the gaps that need filling are not near it. `taper=0.15`
  // gives the flank a radius of 1334 units, so it is sampled six times across
  // 581 — right for a straight line, and it means the two samples bracketing
  // the turn sit 90 units apart. Walking the curve adding points where it
  // curves cannot fix a step that strides over the curvature entirely.
  const tightest = Math.min(...curvature(path, arcs).filter((R) => Number.isFinite(R)));
  if (Number.isFinite(tightest) && tightest > 0) {
    const ceiling = Math.max(tightest / PER_RADIUS, L / 2000);
    for (let s = ceiling; s < L; s += ceiling) stops.push(s);
  }
  stops.sort((x, y) => x - y);

  // The frame at the mouth is the HOST's, so the two rails start exactly on
  // the host's own points; further in it is the centerline's own.
  const side = { x: (mouthB.x - mouthA.x) / (2 * half), y: (mouthB.y - mouthA.y) / (2 * half) };
  const frameAt = (s: number): { p: XY; n: XY } => {
    const p = pointAtArc(path, arcs, s);
    const ahead = pointAtArc(path, arcs, Math.min(L, s + SPACING / 8));
    const back = pointAtArc(path, arcs, Math.max(0, s - SPACING / 8));
    const dx = ahead.x - back.x;
    const dy = ahead.y - back.y;
    const len = Math.hypot(dx, dy) || 1;
    let n = { x: -dy / len, y: dx / len };
    // Kept on the same side as the mouth's own, so the ribbon cannot flip
    // where the centerline turns — the reason a bend is drawable at all.
    if (n.x * side.x + n.y * side.y < 0) n = { x: -n.x, y: -n.y };
    return { p, n };
  };

  const left: XY[] = [];
  const right: XY[] = [];
  for (const s of stops) {
    const { p, n } = frameAt(s);
    // SNAPPED TO ZERO AT THE TIP. The head closes where `s` reaches `inner + b`,
    // but `inner` is itself `L − b`, so the arithmetic leaves a width around
    // 1e-7 rather than 0 — and the two rails then end a fraction of a nanometre
    // apart instead of on the same point. That is invisible in the geometry and
    // very visible in the output: the pair prints identically at the renderer's
    // precision, so the polyline carries a zero-length segment, which reads as
    // a right-angle turn to anything measuring the drawn curve. Measured on the
    // raw geometry the same shape turns 4.7 degrees.
    const raw = widthAt(s);
    const w = raw < TINY ? 0 : raw;
    left.push({ x: p.x - n.x * w, y: p.y - n.y * w });
    right.push({ x: p.x + n.x * w, y: p.y + n.y * w });
  }
  left[0] = mouthA;
  right[0] = mouthB;

  const out = [...left, ...right.reverse()];
  // A repeated point is a zero-length segment, which reads as a spurious turn
  // to `isSmooth` and as a degenerate crossing to `isSimple`. The tolerance is
  // well below anything the renderer can draw and well above the noise above.
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1]!.x, p.y - out[i - 1]!.y) > TINY);
}

/**
 * Local radius of curvature at each vertex of a polyline (#169).
 *
 * A parallel curve turns through the same angle as the line it offsets, so
 * this is what decides how finely a ribbon must be sampled through a bend —
 * the same `ds ≤ R/PER_RADIUS` rule the rest of the shape already obeys.
 * Straight runs give `Infinity`, which correctly asks for nothing.
 */
function curvature(curve: XY[], arc: number[]): number[] {
  const out: number[] = new Array(curve.length).fill(Infinity);
  for (let i = 1; i + 1 < curve.length; i++) {
    const a = curve[i - 1]!, b = curve[i]!, c = curve[i + 1]!;
    let turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const ds = (arc[i + 1]! - arc[i - 1]!) / 2;
    out[i] = turn > 1e-9 && ds > 0 ? ds / turn : Infinity;
  }
  return out;
}

/**
 * The tightest radius anywhere within one vertex of this arc position.
 *
 * Taken as a MINIMUM over the neighbourhood rather than read at a point: a
 * bend's curvature lives on a couple of vertices, and a step that lands
 * between them would read the turn as gentle and stride straight over it.
 */
function radiusNear(radii: number[], arc: number[], s: number): number {
  let lo = 0;
  let hi = arc.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= s) lo = mid;
    else hi = mid;
  }
  let best = Infinity;
  for (let i = Math.max(0, lo - 1); i <= Math.min(radii.length - 1, lo + 2); i++) {
    best = Math.min(best, radii[i]!);
  }
  return best;
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
