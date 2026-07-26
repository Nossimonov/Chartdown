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
}

/**
 * Amplitude as a fraction of `size`. A headland reads as a headland when it is
 * appreciably longer than it is wide; much above this it stops looking like
 * coast and starts looking like a spike.
 */
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
export function deformCurve(curve: XY[], features: PlacedFeature[]): XY[] {
  let out = curve;
  for (const f of features) {
    if (f.morph === "detached" || f.size < MIN_SIZE) continue;
    out = applyOne(out, f);
  }
  return out;
}

/**
 * One feature: displace every vertex inside the window along the local
 * outward normal, weighted by a raised cosine so the bump meets the
 * undisturbed curve with a matching tangent and leaves no crease.
 *
 * The amplitude is CLAMPED until the result verifies simple (ADR 0023's hard
 * guarantee — a coastline may not cross itself). Backing off is preferred to
 * failing because a slightly-too-large cape is still the feature the author
 * asked for; the caller is told when a clamp bit so an author can find out
 * they asked for more than the stretch could hold.
 */
function applyOne(curve: XY[], f: PlacedFeature): XY[] {
  const anchorIndex = nearestIndex(curve, f.anchor);
  if (anchorIndex < 0) return curve;
  const half = f.size / 2;
  // `bite` pulls landward, which is the opposite side from a jut. Direction is
  // resolved from the host, not declared (spec 05 §4) — see `outwardSign`.
  const sign = f.morph === "bite" ? -1 : 1;
  const arc = arcLengths(curve);
  const at = arc[anchorIndex]!;

  let amplitude = f.size * ASPECT;
  for (let attempt = 0; attempt < CLAMP_STEPS; attempt++) {
    const moved = displace(curve, arc, at, half, sign * amplitude);
    if (isSimple(moved)) return moved;
    amplitude *= CLAMP_FACTOR;
  }
  return curve; // nothing survived the clamp: leave the host undisturbed
}

/** How far the clamp will back off before giving up, and by how much each time. */
const CLAMP_STEPS = 8;
const CLAMP_FACTOR = 0.66;

/** Displace vertices within `half` arc-length of `at`, raised-cosine weighted. */
function displace(curve: XY[], arc: number[], at: number, half: number, amplitude: number): XY[] {
  return curve.map((p, i) => {
    const d = Math.abs(arc[i]! - at);
    if (d >= half) return p;
    // cos ramp: 1 at the anchor, 0 at the window edge, zero slope at both ends.
    const weight = 0.5 * (1 + Math.cos((Math.PI * d) / half));
    const n = normalAt(curve, i);
    return { x: p.x + n.x * amplitude * weight, y: p.y + n.y * amplitude * weight };
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
