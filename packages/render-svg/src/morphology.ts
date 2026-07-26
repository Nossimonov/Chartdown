/**
 * Placed morphology (spec 05 §4, #93, ADR 0023): discrete features that
 * deform a line locally, each one declared data rather than generated noise.
 *
 * The geometry is deliberately small and pure. A feature's shape is a function
 * of (kind, anchor, size, host curve) and nothing else — no seed, no ordinal,
 * no dependence on other entities — because ADR 0023's whole point is that a
 * feature must not move under an unrelated edit. That is also why the
 * deformation is a smooth bump over a WINDOW of the curve rather than an
 * inserted vertex: inserting points would make the result depend on how
 * densely the host happened to be sampled.
 */

import type { XY } from "./util";

/** What a feature's geometry does to its host (the `morph=` facet). */
export type Morph = "jut" | "bite" | "detached";

export interface PlacedFeature {
  morph: Morph;
  /** Where on the host it sits, in rendered coordinates. */
  anchor: XY;
  /** Extent along the host, in rendered units. */
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

/**
 * Apply every feature hosted on this curve, in one pass.
 *
 * Order does not matter to the result when features do not overlap, and when
 * they do the later one composes on the earlier — which is the same rule
 * declaration order already gives terrain (spec 06 §6).
 */
export function deformCurve(
  curve: XY[],
  features: PlacedFeature[],
  onReject?: (f: PlacedFeature) => void,
): XY[] {
  let out = curve;
  for (const f of features) {
    if (f.morph === "detached" || f.size < MIN_SIZE) continue;
    const next = applyOne(out, f);
    if (next === null) {
      onReject?.(f);
      continue;
    }
    out = next;
  }
  return out;
}

/**
 * One feature: displace every vertex inside the window along the local
 * outward normal, weighted by a raised cosine so the bump meets the
 * undisturbed curve with a matching tangent and leaves no crease.
 *
 * The feature is drawn at the size it ASKED FOR or not at all. An earlier
 * draft clamped the amplitude down until the result verified, and that was
 * rejected on the owner's argument: a clamp deliberately discards map data. It
 * also makes `size=` a lie — two capes both declared 90mi would render at
 * different sizes depending on their host's local curvature, so the number in
 * the document would stop determining what is on the map, which is the whole
 * thesis of ADR 0023.
 *
 * Returning null means "this cannot be drawn as written"; the caller reports
 * it and the author changes the document.
 */
function applyOne(curve: XY[], f: PlacedFeature): XY[] | null {
  const anchorIndex = nearestIndex(curve, f.anchor);
  if (anchorIndex < 0) return null;
  const half = f.size / 2;
  // A jut goes SEAWARD and a bite goes landward. The seaward side is resolved
  // from the map (see `seawardSign`) at the anchor, then held constant across
  // the window so the bump stays one coherent shape rather than flipping
  // sides where the curve turns.
  const facing = seawardSign(normalAt(curve, anchorIndex), f.seaward);
  const sign = (f.morph === "bite" ? -1 : 1) * facing;
  const arc = arcLengths(curve);
  const at = arc[anchorIndex]!;

  const dir = normalAt(curve, anchorIndex);
  const moved = displace(curve, arc, at, half, sign * f.size * (f.reach ?? ASPECT), dir);
  return isSimple(moved) && isSmooth(moved) ? moved : null;
}

/**
 * Displace vertices within `half` arc-length of `at`, raised-cosine weighted,
 * all in ONE direction — the normal at the anchor.
 *
 * Per-vertex normals were tried first and are wrong at exactly the places a
 * feature is most wanted. On a sharp headland the two arms have normals
 * pointing tens of degrees apart, so the halves of the bump travel in
 * different directions and pinch the curve between them; the result folded and
 * was refused, even though a cartographer would happily draw a bay there.
 *
 * A bay is a bite in a direction, not an offset of a curve. Displacing the
 * whole window along the anchor's normal is both the simpler model and the one
 * that matches what the word means.
 */
function displace(curve: XY[], arc: number[], at: number, half: number, amplitude: number, dir: XY): XY[] {
  return curve.map((p, i) => {
    const d = Math.abs(arc[i]! - at);
    if (d >= half) return p;
    // cos ramp: 1 at the anchor, 0 at the window edge, zero slope at both ends.
    const weight = 0.5 * (1 + Math.cos((Math.PI * d) / half));
    return { x: p.x + dir.x * amplitude * weight, y: p.y + dir.y * amplitude * weight };
  });
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
 * Does this polyline avoid crossing itself? ADR 0023 makes this a hard
 * guarantee rather than a quality target: a map that folds over itself is
 * wrong in a way no reader can repair, so the amplitude is reduced until this
 * passes.
 *
 * Adjacent segments share an endpoint and are skipped; everything else is
 * tested pairwise, which is quadratic and fine at the vertex counts a rendered
 * spine has.
 */
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
 * Displacing a curve along its own normals by an amount near the local radius
 * of curvature produces a CUSP on the concave side — the classic offset-curve
 * failure. A cusp comes to a point and turns back without the curve ever
 * crossing itself, so `isSimple` passes it happily while the map shows a
 * spike. Measured on Vessany's Gull Bay: non-self-intersecting, and a 157°
 * turn. Densifying the samples did not help, because the fold was real
 * geometry rather than coarse drawing — it was caught by eye first, then by
 * this number.
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

export function isSimple(curve: XY[]): boolean {
  const first = curve[0];
  const last = curve[curve.length - 1];
  // Only a CLOSED ring has a first and last segment sharing an endpoint. The
  // exemption was originally unconditional, which silently forgave a genuine
  // crossing between the ends of an OPEN coastline — caught by the test that
  // asks whether this guard is vacuous, which it was.
  const closed =
    curve.length > 2 && first !== undefined && last !== undefined &&
    Math.hypot(first.x - last.x, first.y - last.y) < 1e-9;
  for (let i = 0; i + 1 < curve.length; i++) {
    for (let j = i + 2; j + 1 < curve.length; j++) {
      if (closed && i === 0 && j + 1 === curve.length - 1) continue;
      if (segmentsCross(curve[i]!, curve[i + 1]!, curve[j]!, curve[j + 1]!)) return false;
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
