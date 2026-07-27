/**
 * Reading one inlet's Chartdown facets off a classified image.
 *
 * This is the part no general tool does for us. #181 dismisses "authors use
 * GIS" on exactly this ground: getting a shape out of a picture is commodity
 * work, and *converting a shape into `size=`, `taper=` and `via`* is
 * Chartdown-specific and is where every error was. So the output is a
 * DECLARATION — a thing with an id that a `gm=` note or a `detail=` sub-map can
 * hang off — never an outline.
 *
 * The method follows #181's prototype: cut the mouth, flood what is behind it,
 * and read the geometry off the result. Distance is measured GEODESICALLY,
 * through the water, rather than as the crow flies: Hood Canal's head is
 * fifteen miles from its mouth in a straight line and fifty-five along the
 * channel, and it is the second number `via` has to reproduce.
 */

import type { Georef, XY } from "./georef";
import { distanceToLand, flood, type Mask } from "./raster";

export class MeasureError extends Error {}

export interface Measured {
  /** The mouth's midpoint, in map coordinates — a feature's anchor. */
  anchor: XY;
  /** Mouth width, in miles: `size=`. */
  size: number;
  /** Length of the centerline, in miles. */
  depth: number;
  /** Fraction of the depth spent converging: `taper=`. */
  taper: number;
  /** The centerline from the mouth inward, in map coordinates: `via`. */
  centerline: XY[];
  /** Half-width down the channel, in miles, for reporting. */
  profile: { at: number; halfWidth: number }[];
}

const at = (mask: Mask, x: number, y: number): number =>
  x < 0 || y < 0 || x >= mask.width || y >= mask.height ? 0 : mask.bits[y * mask.width + x]!;

/**
 * March from a point along a direction until the water ends, in pixels.
 *
 * `Infinity` where the march leaves the picture without meeting land, which is
 * a different answer from "the shore is here" and must not be confused with it:
 * treating the frame edge as a shore is how a chord drawn across open sea comes
 * back as a plausible mouth width.
 */
function edge(mask: Mask, from: XY, dir: XY, limit: number): number {
  for (let d = 0; d < limit; d++) {
    const x = Math.round(from.x + dir.x * d);
    const y = Math.round(from.y + dir.y * d);
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return Infinity;
    if (!mask.bits[y * mask.width + x]) return d;
  }
  return Infinity;
}

/**
 * Measure the inlet whose mouth is at `mouth` and which runs toward `into`.
 *
 * Both points are in PIXELS, and both are the author's: which water is "this
 * inlet" and where its mouth lies are cartographic judgements, not facts in the
 * image. Puget Sound has no line in it saying where Hood Canal begins.
 */
export function measureFeature(mask: Mask, georef: Georef, mouth: XY, into: XY): Measured {
  const span = Math.hypot(mask.width, mask.height);
  if (!at(mask, Math.round(mouth.x), Math.round(mouth.y))) {
    throw new MeasureError(`the mouth at ${Math.round(mouth.x)},${Math.round(mouth.y)} is not on water — check the pixel, or the classification (run \`inspect\`)`);
  }
  if (!at(mask, Math.round(into.x), Math.round(into.y))) {
    throw new MeasureError(`the point at ${Math.round(into.x)},${Math.round(into.y)} is not on water — it should sit inside the inlet, well past its mouth`);
  }

  const runX = into.x - mouth.x;
  const runY = into.y - mouth.y;
  const runLength = Math.hypot(runX, runY);
  if (!(runLength > 0)) throw new MeasureError("the mouth and the inward point are the same pixel");

  // THE MOUTH IS THE NARROWEST CHORD THROUGH THIS POINT, found by looking, not
  // by assuming it is square to the line toward `into`. That assumption is
  // wrong exactly where it matters: on a channel that bends, the inward point
  // is off at an angle, and a chord square to THAT line cuts the channel
  // obliquely and measures it wider than it is. Measured on a canal turning a
  // right angle, it read a 20-pixel mouth as 28 — a 40% overstatement of
  // `size=`, in the direction that makes every feature look grander than it is.
  //
  // A channel's width at a point is the shortest way across it. Searching the
  // half-circle also yields the chord's direction, so the way the inlet runs
  // falls out of the geometry rather than out of where the author clicked.
  let across = { x: 0, y: 0 };
  let left = Infinity;
  let right = Infinity;
  let narrowest = Infinity;
  const STEPS = 180;
  for (let i = 0; i < STEPS; i++) {
    const angle = (i * Math.PI) / STEPS;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const a = edge(mask, mouth, dir, span);
    const b = edge(mask, mouth, { x: -dir.x, y: -dir.y }, span);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a + b < narrowest) {
      narrowest = a + b;
      across = dir;
      left = a;
      right = b;
    }
  }
  if (!Number.isFinite(narrowest)) {
    left = Infinity;
    right = Infinity;
  }
  // A MOUTH IS A CHORD ACROSS A CHANNEL, so it has to meet land at both ends.
  // Running to the edge of the picture without finding any means this point is
  // in open water, and everything downstream would then measure the sea and
  // report it as an inlet — the exact shape of plausible-and-wrong this
  // package exists to stop.
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new MeasureError(
      `the mouth at ${Math.round(mouth.x)},${Math.round(mouth.y)} does not close on land: measuring across the channel there runs off the picture without meeting a shore. A mouth sits BETWEEN two headlands — put it where the water narrows`,
    );
  }
  const widthPixels = left + right;
  if (widthPixels < 2) throw new MeasureError("the mouth measures less than two pixels across — the image is too coarse for this feature");
  const mouthA = { x: mouth.x + across.x * left, y: mouth.y + across.y * left };
  const mouthB = { x: mouth.x - across.x * right, y: mouth.y - across.y * right };
  const mid = { x: (mouthA.x + mouthB.x) / 2, y: (mouthA.y + mouthB.y) / 2 };

  // Close the mouth so the inlet parts company with the open sea, then take
  // what is behind it. Drawn a few pixels thick: a one-pixel line leaks
  // diagonally, and a leak swallows the whole sea rather than failing.
  const cut: Mask = { width: mask.width, height: mask.height, bits: Uint8Array.from(mask.bits) };
  const steps = Math.ceil(widthPixels) * 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = mouthA.x + (mouthB.x - mouthA.x) * t;
    const cy = mouthA.y + (mouthB.y - mouthA.y) * t;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && y >= 0 && x < mask.width && y < mask.height) cut.bits[y * mask.width + x] = 0;
      }
    }
  }
  const inside = flood(cut, Math.round(into.y) * mask.width + Math.round(into.x));
  const insideCount = inside.reduce((t, v) => t + v, 0);
  if (insideCount === 0) throw new MeasureError("nothing lies behind the mouth — the inward point may be on the wrong side of it");
  const water = mask.bits.reduce((t, v) => t + v, 0);
  if (insideCount > water * 0.9) {
    throw new MeasureError(
      "closing the mouth did not separate this inlet from the rest of the water — the mouth is in the wrong place, or the inlet opens to the sea somewhere else as well",
    );
  }

  // Geodesic distance from the mouth, THROUGH the water. Straight-line distance
  // would cut across every headland the channel goes round.
  //
  // CHAMFERED, NOT FLOODED. A four-connected walk measures Manhattan distance,
  // which is exact along the axes and overstates a diagonal by 41% — and a
  // channel is under no obligation to run north-south. Measured against the
  // reference tracing of Hood Canal, which runs south-south-west, this read
  // 79.7mi where the truth is 55.8: a ratio of 1.428 against √2's 1.414. Every
  // fixture that had passed was axis-aligned, where the two metrics agree
  // exactly, so nothing in the suite could have caught it.
  //
  // Diagonal steps at √2 are exact at 0°, 45° and 90° and worst at 22.5°, where
  // they overstate by 7.6%. Iterating raster passes rather than running a
  // Dijkstra keeps this to array arithmetic; a channel needs one pass per bend
  // it wraps around, so the bound is generous rather than tight.
  const dist = new Float32Array(mask.bits.length).fill(Infinity);
  const queue = new Int32Array(insideCount + 8);
  let head = 0;
  let tail = 0;
  // Seeded from the water JUST BEYOND the cut, not from the cut itself — the
  // cut is drawn thick enough that a diagonal cannot leak through it, so every
  // pixel on it is land and none of them can start a walk.
  const REACH = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(mouthA.x + (mouthB.x - mouthA.x) * t);
    const y = Math.round(mouthA.y + (mouthB.y - mouthA.y) * t);
    for (let oy = -REACH; oy <= REACH; oy++) {
      for (let ox = -REACH; ox <= REACH; ox++) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) continue;
        const at2 = py * mask.width + px;
        if (inside[at2] === 1 && dist[at2] === Infinity) { dist[at2] = 0; queue[tail++] = at2; }
      }
    }
  }
  if (tail === 0) throw new MeasureError("the mouth does not touch the water behind it");

  // Only the inlet's own bounding box is swept, so the cost follows the feature
  // rather than the picture it was cut from.
  let x0 = mask.width, x1 = 0, y0 = mask.height, y1 = 0;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] !== 1) continue;
    const x = i % mask.width;
    const y = (i / mask.width) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const D1 = 1;
  const D2 = Math.SQRT2;
  const W = mask.width;
  for (let round = 0; round < 64; round++) {
    let moved = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (inside[i] !== 1) continue;
        let d = dist[i]!;
        if (x > 0) d = Math.min(d, dist[i - 1]! + D1);
        if (y > 0) d = Math.min(d, dist[i - W]! + D1);
        if (x > 0 && y > 0) d = Math.min(d, dist[i - W - 1]! + D2);
        if (x + 1 < W && y > 0) d = Math.min(d, dist[i - W + 1]! + D2);
        if (d < dist[i]!) { dist[i] = d; moved = true; }
      }
    }
    for (let y = y1; y >= y0; y--) {
      for (let x = x1; x >= x0; x--) {
        const i = y * W + x;
        if (inside[i] !== 1) continue;
        let d = dist[i]!;
        if (x + 1 < W) d = Math.min(d, dist[i + 1]! + D1);
        if (y + 1 < mask.height) d = Math.min(d, dist[i + W]! + D1);
        if (x + 1 < W && y + 1 < mask.height) d = Math.min(d, dist[i + W + 1]! + D2);
        if (x > 0 && y + 1 < mask.height) d = Math.min(d, dist[i + W - 1]! + D2);
        if (d < dist[i]!) { dist[i] = d; moved = true; }
      }
    }
    if (!moved) break;
  }

  let deepest = 0;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]!;
    if (Number.isFinite(d) && d > deepest) deepest = d;
  }
  if (deepest < 2) throw new MeasureError("the inlet is barely deeper than its own mouth — check the inward point");

  // The centerline is the centre of the water at each distance from the mouth.
  // Averaging a band rather than picking a ridge keeps it steady where the
  // channel widens into a bay, which a medial axis does not.
  const bands = Math.max(4, Math.min(60, Math.round(deepest / Math.max(widthPixels / 2, 2))));
  const sumX = new Float64Array(bands + 1);
  const sumY = new Float64Array(bands + 1);
  const weight = new Float64Array(bands + 1);
  const count = new Float64Array(bands + 1);
  // WEIGHTED BY DEPTH FROM LAND, so the middle of the channel decides where the
  // middle of the channel is. A plain centroid is pulled off-axis at a dead
  // end, because the farthest points from the mouth are the two far CORNERS
  // rather than the centre — an artefact of measuring distance through the
  // water, present in any metric, and it put a kink in the last control of
  // every otherwise straight canal.
  const fromLand = distanceToLand(mask);
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]!;
    if (!Number.isFinite(d)) continue;
    const band = Math.min(bands, Math.floor((d / deepest) * bands));
    const w = Math.max(fromLand[i]!, 0.001);
    sumX[band]! += (i % mask.width) * w;
    sumY[band]! += ((i / mask.width) | 0) * w;
    weight[band]! += w;
    count[band]!++;
  }
  const centrePixels: { at: number; p: XY; area: number }[] = [];
  for (let b = 0; b <= bands; b++) {
    if (count[b]! === 0 || weight[b]! <= 0) continue;
    centrePixels.push({
      at: (b / bands) * deepest,
      p: { x: sumX[b]! / weight[b]!, y: sumY[b]! / weight[b]! },
      area: count[b]!,
    });
  }

  // A DEAD END'S LAST BAND IS NOT A CROSS-SECTION. The farthest water from the
  // mouth sits in the two corners of a blunt head, so the deepest band holds
  // only those corners — a handful of pixels either side of the middle, whose
  // centre is not on the channel's axis at all. Weighting cannot rescue it,
  // because every pixel in it is equally near the shore. Trimmed by AREA rather
  // than by position, so a genuinely tapering inlet, whose bands shrink
  // steadily, keeps every one of them.
  while (centrePixels.length > 2) {
    const last = centrePixels[centrePixels.length - 1]!;
    const before = centrePixels[centrePixels.length - 2]!;
    if (last.area >= before.area * 0.3) break;
    centrePixels.pop();
  }

  // Half-width per band from its area: a band of the channel is a slab, so its
  // area over its length is its width. Steadier than probing a single ray,
  // which lands in a notch as often as not.
  const bandLength = deepest / bands;
  const profile = centrePixels.map((c) => ({
    at: c.at * georef.milesPerPixel,
    halfWidth: (c.area / Math.max(bandLength, 1) / 2) * georef.milesPerPixel,
  }));

  // `taper` is the fraction of the depth spent converging. Take the flank as
  // the median half-width over the first half, and find where the shape leaves
  // it for good — which is exactly the quantity spec 05 §4 defines.
  const firstHalf = profile.slice(0, Math.max(1, Math.floor(profile.length / 2))).map((p) => p.halfWidth).sort((a, b) => a - b);
  const flank = firstHalf[Math.floor(firstHalf.length / 2)] ?? 0;
  let convergesAt = profile.length;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i]!.halfWidth < flank * 0.95 && profile.slice(i).every((p) => p.halfWidth < flank)) {
      convergesAt = i;
      break;
    }
  }
  const depth = deepest * georef.milesPerPixel;
  const taper = profile.length > 1
    ? Math.max(0, Math.min(1, 1 - (profile[Math.min(convergesAt, profile.length - 1)]!.at / Math.max(depth, 1e-9))))
    : 1;

  return {
    anchor: georef.toMap(mid.x, mid.y),
    size: widthPixels * georef.milesPerPixel,
    depth,
    taper,
    centerline: centrePixels.map((c) => georef.toMap(c.p.x, c.p.y)),
    profile,
  };
}

/**
 * Thin a centerline to the controls an author would actually write.
 *
 * Douglas–Peucker, because a `via` list is DECLARED DATA a person reads and
 * edits: sixty points down a canal is the wall of coordinates ADR 0023 exists
 * to remove, wearing a different hat. The tolerance is a fraction of the
 * feature's own width, so a wide sound keeps fewer controls than a narrow one
 * and both keep the bends that matter.
 */
/**
 * Space the controls out, which the renderer's spline cares about more than
 * their number.
 *
 * A measured centerline crowds its controls where the channel bends and leaves
 * long gaps down the straights, and that unevenness — not the count, and not
 * the feature's size — is what a Catmull-Rom overshoots on. Measured on a canal
 * turning a right angle: six controls with three of them within a mile of each
 * other and then a ten-mile jump was REFUSED at every size from 1.56mi down to
 * 0.3mi, while the same shape in two evenly spread controls drew at full size.
 * So a tool that emits the first is emitting something no map can use.
 */
export function spaceOut(points: XY[], minGap: number): XY[] {
  if (points.length < 3) return points.slice();
  const out = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1]!;
    if (Math.hypot(points[i]!.x - last.x, points[i]!.y - last.y) >= minGap) out.push(points[i]!);
  }
  const end = points[points.length - 1]!;
  const last = out[out.length - 1]!;
  // The head is kept whatever its spacing — it is the feature's extent — but a
  // control crowding it is dropped in its favour.
  if (out.length > 1 && Math.hypot(end.x - last.x, end.y - last.y) < minGap) out.pop();
  out.push(end);
  return out;
}

export function simplify(points: XY[], tolerance: number): XY[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const a = points[from]!;
    const b = points[to]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstAt = -1;
    for (let i = from + 1; i < to; i++) {
      const p = points[i]!;
      const away = len > 0
        ? Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len
        : Math.hypot(p.x - a.x, p.y - a.y);
      if (away > worst) { worst = away; worstAt = i; }
    }
    if (worstAt > 0 && worst > tolerance) {
      keep[worstAt] = 1;
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
