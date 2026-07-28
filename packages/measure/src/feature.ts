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

import { catmullRom, radii } from "@chartdown/core";
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
  /**
   * The centerline from the mouth inward, in map coordinates, each control
   * carrying the channel's full width there: `via (x,y)@1.5mi` (#190).
   */
  centerline: (XY & { width: number })[];
  /** Half-width down the channel, in miles, for reporting. */
  profile: { at: number; halfWidth: number }[];
  /**
   * The unit direction the centerline leaves its host on, in map coordinates.
   *
   * A renderer prepends a control of its own along the HOST's normal at the
   * mouth, and that control is part of the curve it draws (#169, #183) — so a
   * check that omits it is checking a different line, which is how a
   * declaration came to print clean and then be refused (#193).
   *
   * Knowable here after all: the mouth is the narrowest chord between two
   * headlands, so that chord IS the local coastline and its perpendicular is
   * the host's normal. It holds where the feature is placed on a coast running
   * as the measured mouth does, which is the workflow; on some other coast the
   * centerline leaves at a skew, and spec 05 §4 requires it not to.
   */
  leaves: XY;
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
  chamfer(dist, inside, mask.width, mask.height, x0, x1, y0, y1);

  let deepest = 0;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]!;
    if (Number.isFinite(d) && d > deepest) deepest = d;
  }
  if (deepest < 2) throw new MeasureError("the inlet is barely deeper than its own mouth — check the inward point");

  // THE BANDS FOLLOW THE TRUNK, not everything at that distance from the mouth
  // (#192). Flooding behind a mouth captures the arms, and an arm's water sits
  // at much the same distance from the mouth as the trunk beside it — so a band
  // spanning both has its centre BETWEEN them, and the centerline leaves the
  // channel entirely. Measured on Hood Canal, it doubled back through Dabob and
  // Quilcene and returned: six controls reversing on themselves, carrying
  // widths of 0.14, 0.1 and 0.38mi on a channel whose median is 1.5 — the tiny
  // widths being the giveaway, since mid-channel there is the gap between two
  // bays rather than any channel at all.
  //
  // Topology comes from a BACKTRACK, position still from the weighted centroid.
  // The path of steepest descent from the farthest water back to the mouth
  // cannot enter a bay, because a bay is a dead end and nothing beyond it is
  // farther. Used to pick WHICH band component is the trunk it settles the
  // question a centroid cannot; used to place the line it would hug the inside
  // of every corner, which is what a pure geodesic centerline does and why it
  // is not one here.
  // WATER IS ON THE TRUNK IF GOING THROUGH IT IS BARELY A DETOUR. Grow the
  // same field a second time from the head: a pixel's distance from the mouth
  // plus its distance from the head is the length of the best route that passes
  // through it, so the excess over the direct run is what it COSTS to go that
  // way. Mid-channel water costs nothing; water a mile up a dead-end arm costs
  // two miles, there and back. Connectivity alone cannot tell them apart — an
  // arm and the trunk are one body of water at the arm's own mouth, and where
  // that mouth is wide they stay one for a long way.
  //
  // The allowance is the channel's own width, so the junction itself counts as
  // trunk — which it is — and nothing past it does.
  const trunkPath = backtrack(dist, mask.width, mask.height);
  const back = new Float32Array(mask.bits.length).fill(Infinity);
  const headPixel = trunkPath[trunkPath.length - 1] ?? -1;
  if (headPixel >= 0) back[headPixel] = 0;
  chamfer(back, inside, mask.width, mask.height, x0, x1, y0, y1);
  const detour = Math.max(widthPixels, 4);
  const onCorridor = new Uint8Array(mask.bits.length);
  for (let i = 0; i < dist.length; i++) {
    const a = dist[i]!;
    const b = back[i]!;
    if (Number.isFinite(a) && Number.isFinite(b) && a + b <= deepest + detour) onCorridor[i] = 1;
  }
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
  const bandOf = (d: number): number => Math.min(bands, Math.floor((d / deepest) * bands));
  // Which pixels belong to the trunk at each band: grown from the backtrack's
  // own pixel there, through that band only, so an arm's cross-section is a
  // separate component and is not reached.
  const onTrunk = trunkBands(dist, mask.width, mask.height, trunkPath, bandOf, bands, onCorridor);
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]!;
    if (!Number.isFinite(d)) continue;
    if (onTrunk[i] !== 1) continue;
    const band = bandOf(d);
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

  // THE WIDTH OF A CHANNEL IS ITS CROSS-SECTION, SQUARE TO THE CENTERLINE
  // (spec 05 §4, ADR 0033). That is the quantity the renderer draws — rails
  // offset at plus and minus the half-width, perpendicular to the line — so it
  // is the one that makes the number in the document and the water on the map
  // the same width.
  //
  // Not the distance to land, which is the largest circle that FITS here: that
  // reads low wherever the centerline sits off-centre, since the nearer bank
  // caps it, and high at a bend, where the circle settles into the corner and
  // touches both outer banks at once — 1.17x the true half-width on a square
  // elbow and more as the turn sharpens. It made a channel widest exactly where
  // it turns hardest, which is the one place a ribbon cannot afford it.
  //
  // Measured WITHIN THE TRUNK, so a crossing stops where the trunk does. The
  // exactly-perpendicular ray escapes up an arm and keeps going: at Dabob Bay's
  // junction that read the trunk as 6mi across, against 1.8 either side of it.
  // The trunk's own water is already known — it is what the bands were grown
  // over, and it excludes water that is a detour — so the ray simply stops on
  // leaving it. An arm is a feature in its own right and is declared as one; it
  // is not part of its host's width.
  const reach = (p: XY, dir: XY): number => {
    for (let d = 0; d < span; d++) {
      const x = Math.round(p.x + dir.x * d);
      const y = Math.round(p.y + dir.y * d);
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return Infinity;
      if (onTrunk[y * mask.width + x] !== 1) return d;
    }
    return Infinity;
  };
  const profile = centrePixels.map((c, i) => {
    const px = Math.min(Math.max(Math.round(c.p.x), 0), mask.width - 1);
    const py = Math.min(Math.max(Math.round(c.p.y), 0), mask.height - 1);
    const before = centrePixels[Math.max(0, i - 1)]!.p;
    const after = centrePixels[Math.min(centrePixels.length - 1, i + 1)]!.p;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const len = Math.hypot(dx, dy);
    const p = { x: px, y: py };
    const a = len > 0 ? reach(p, { x: -dy / len, y: dx / len }) : Infinity;
    const b = len > 0 ? reach(p, { x: dy / len, y: -dx / len }) : Infinity;
    // The inscribed circle stands in where the centerline has no direction here
    // — a single band — or where the crossing runs off the picture rather than
    // closing on a bank, which is a point in open water rather than in a
    // channel.
    const half = Number.isFinite(a) && Number.isFinite(b)
      ? (a + b) / 2
      : (fromLand[py * mask.width + px] ?? 0);
    return { at: c.at * georef.milesPerPixel, halfWidth: half * georef.milesPerPixel };
  });

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
    leaves: leavesOn(georef, mid, across, into),
    size: widthPixels * georef.milesPerPixel,
    depth,
    taper,
    centerline: centrePixels.map((c, i) => ({
      ...georef.toMap(c.p.x, c.p.y),
      width: (profile[i]?.halfWidth ?? 0) * 2,
    })),
    profile,
  };
}

/**
 * Chamfered geodesic distance, swept in place from whatever is already seeded.
 *
 * CHAMFERED, NOT FLOODED. A four-connected walk measures Manhattan distance,
 * which is exact along the axes and overstates a diagonal by 41% — and a
 * channel is under no obligation to run north-south. Measured against the
 * reference tracing of Hood Canal, which runs south-south-west, that read
 * 79.7mi where the truth is 55.8: a ratio of 1.428 against the square root of
 * two's 1.414. Every fixture that had passed was axis-aligned, where the two
 * metrics agree exactly, so nothing in the suite could have caught it.
 *
 * Shared because the same field is grown twice (#192): once from the mouth,
 * and once from the head, so that the two together say which water lies ON THE
 * WAY through and which is a detour up an arm.
 */
function chamfer(
  dist: Float32Array,
  inside: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): void {
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let round = 0; round < 64; round++) {
    let moved = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (inside[i] !== 1) continue;
        let d = dist[i]!;
        if (x > 0) d = Math.min(d, dist[i - 1]! + D1);
        if (y > 0) d = Math.min(d, dist[i - width]! + D1);
        if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1]! + D2);
        if (x + 1 < width && y > 0) d = Math.min(d, dist[i - width + 1]! + D2);
        if (d < dist[i]!) { dist[i] = d; moved = true; }
      }
    }
    for (let y = y1; y >= y0; y--) {
      for (let x = x1; x >= x0; x--) {
        const i = y * width + x;
        if (inside[i] !== 1) continue;
        let d = dist[i]!;
        if (x + 1 < width) d = Math.min(d, dist[i + 1]! + D1);
        if (y + 1 < height) d = Math.min(d, dist[i + width]! + D1);
        if (x + 1 < width && y + 1 < height) d = Math.min(d, dist[i + width + 1]! + D2);
        if (x > 0 && y + 1 < height) d = Math.min(d, dist[i + width - 1]! + D2);
        if (d < dist[i]!) { dist[i] = d; moved = true; }
      }
    }
    if (!moved) break;
  }
}

/** The eight neighbours, as (dx, dy) pairs. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * The path of steepest descent from the farthest water back to the mouth.
 *
 * This is the inlet's TRUNK as a topological fact: every step moves nearer the
 * mouth, so the path cannot enter a bay — a bay is a dead end, and nothing
 * inside one is farther from the mouth than its own entrance. It is used to
 * decide which water belongs to the trunk, never to place the centerline: a
 * steepest-descent path hugs the inside of every corner, which is a line no
 * channel of any width could follow.
 */
function backtrack(dist: Float32Array, width: number, height: number): Int32Array {
  let at = -1;
  let deepest = -1;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]!;
    if (Number.isFinite(d) && d > deepest) { deepest = d; at = i; }
  }
  const path: number[] = [];
  const seen = new Uint8Array(dist.length);
  // Bounded by the pixel count: every step strictly decreases the distance, so
  // it terminates, and the guard is for a corrupt field rather than a shape.
  while (at >= 0 && !seen[at] && path.length < dist.length) {
    seen[at] = 1;
    path.push(at);
    const x = at % width;
    const y = (at / width) | 0;
    let next = -1;
    let best = dist[at]!;
    for (const [dx, dy] of NEIGHBOURS) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const j = py * width + px;
      const d = dist[j]!;
      if (Number.isFinite(d) && d < best) { best = d; next = j; }
    }
    if (next < 0) break;
    at = next;
  }
  return Int32Array.from(path.reverse());
}

/**
 * The water belonging to the trunk, band by band.
 *
 * Each band is grown from the pixel the backtrack passes through at that
 * distance, spreading only within the band. An arm's cross-section at the same
 * distance is a SEPARATE component — the two are joined only near the arm's own
 * mouth, where they genuinely are one stretch of water — so it is never
 * reached, and the trunk's centre stops being an average of the two.
 */
function trunkBands(
  dist: Float32Array,
  width: number,
  height: number,
  trunk: Int32Array,
  bandOf: (d: number) => number,
  bands: number,
  onCorridor: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(dist.length);
  const seeds: number[][] = Array.from({ length: bands + 1 }, () => []);
  for (const i of trunk) {
    const d = dist[i]!;
    if (Number.isFinite(d)) seeds[bandOf(d)]!.push(i);
  }
  const queue = new Int32Array(dist.length);
  for (let b = 0; b <= bands; b++) {
    let tail = 0;
    for (const s of seeds[b]!) {
      if (out[s] === 1) continue;
      out[s] = 1;
      queue[tail++] = s;
    }
    for (let head = 0; head < tail; head++) {
      const at = queue[head]!;
      const x = at % width;
      const y = (at / width) | 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const j = py * width + px;
        if (out[j] === 1) continue;
        if (onCorridor[j] !== 1) continue;
        const d = dist[j]!;
        if (!Number.isFinite(d) || bandOf(d) !== b) continue;
        out[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return out;
}

/**
 * Thin a centerline to the controls an author would actually write.
 *
 * Douglas–Peucker, because a `via` list is DECLARED DATA a person reads and
 * edits: sixty points down a canal is the wall of coordinates ADR 0023 exists
 * to remove, wearing a different hat. The tolerance is a fraction of the
 * feature's own width, so a wide sound keeps fewer controls than a narrow one
 * and both keep the bends that matter.
 *
 * Thinned for READABILITY only. This used to be followed by a second pass that
 * forced the survivors to be evenly spaced, because the renderer's spline
 * overshot on uneven ones — a tool working around a renderer limitation, and
 * one that cost exactly the controls a bend is made of. With the spline now
 * centripetal (#189), spacing no longer changes a centerline's shape, so the
 * measurement emits the controls the shape actually needs.
 */
export function simplify<T extends XY>(points: T[], tolerance: number): T[] {
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

/**
 * Which way the centerline leaves the mouth, in MAP coordinates.
 *
 * Perpendicular to the mouth chord, taking the side the inlet actually runs to
 * — the chord has two normals and only one of them goes inland. Resolved in map
 * space rather than pixel space so a rotated georeference cannot turn it: the
 * two endpoints are converted and the direction taken between them.
 */
function leavesOn(georef: Georef, mid: XY, across: XY, into: XY): XY {
  const inward = (into.x - mid.x) * -across.y + (into.y - mid.y) * across.x >= 0 ? 1 : -1;
  const tip = { x: mid.x - across.y * inward, y: mid.y + across.x * inward };
  const a = georef.toMap(mid.x, mid.y);
  const b = georef.toMap(tip.x, tip.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/**
 * The line a renderer will actually draw: the declared controls with the
 * MOUTH LEAD a renderer inserts ahead of them (#169, #193).
 *
 * Proportional to the first leg, and along the direction the centerline leaves
 * its host on, exactly as the renderer builds it. Where the centerline leaves
 * perpendicular — which spec 05 §4 requires — this is collinear with the first
 * leg and changes nothing; where it does not, it is a corner at the mouth, and
 * that corner is the shape being refused.
 */
export function withMouthLead<T extends XY & { width?: number }>(
  anchor: T,
  controls: T[],
  leaves: XY,
): T[] {
  const first = controls[0];
  if (!first) return [anchor];
  const leg = Math.hypot(first.x - anchor.x, first.y - anchor.y);
  if (!(leg > 0)) return [anchor, ...controls];
  const step = leg * 0.3;
  const lead = { ...anchor, x: anchor.x + leaves.x * step, y: anchor.y + leaves.y * step };
  return [anchor, lead, ...controls];
}

/** Samples per span when asking what the renderer will actually draw. */
const SPAN_SAMPLES = 24;

/**
 * How tight this line's worst bend is, as a multiple of the width it carries.
 *
 * Asked of the SPLINE, not of the controls (#192). Spec 05 §4 refuses a bend
 * whose radius drops below the half-width there, and the curve that has to
 * satisfy that is the one the renderer draws — an interpolating spline's
 * curvature at a knot depends on its neighbours, so a control polygon can clear
 * the rule everywhere while the curve through it does not. Measured on Hood
 * Canal: all 27 controls passed, and the drawn line turned at 0.5mi carrying a
 * half-width of 1.1.
 *
 * Below 1 the shape cannot be drawn as stated. The mouth's own lead is the
 * renderer's and depends on a coastline this tool does not have (ADR 0028), so
 * the first span is approximate; everything past it is exact.
 */
export function tightestBend<T extends XY & { width?: number }>(points: T[]): number {
  if (points.length < 3) return Infinity;
  const curve = catmullRom(points, SPAN_SAMPLES);
  const r = radii(curve);
  let worst = Infinity;
  for (let k = 1; k + 1 < curve.length; k++) {
    if (!Number.isFinite(r[k]!)) continue;
    // The sample's own span, by construction of the output: `SPAN_SAMPLES`
    // points per span, in order, then the final control.
    const span = Math.min(points.length - 2, Math.floor(k / SPAN_SAMPLES));
    const t = (k % SPAN_SAMPLES) / SPAN_SAMPLES;
    const w0 = points[span]!.width ?? 0;
    const w1 = points[span + 1]!.width ?? w0;
    const half = (w0 + (w1 - w0) * t) / 2;
    if (!(half > 0)) continue;
    worst = Math.min(worst, r[k]! / half);
  }
  return worst;
}

/**
 * Ease the bends a channel of this width cannot follow.
 *
 * A centerline is only meaningful down to the scale of the channel's own
 * width: curvature finer than that is measurement noise, not geography. Where
 * a band's centre is tugged sideways — at a junction, where the trunk and an
 * arm briefly are one stretch of water — the line acquires a corner the water
 * does not have, and a corner tighter than the half-width cannot be drawn at
 * all.
 *
 * Bounded by the channel: a control may move anywhere within its own
 * half-width of where it was measured, and no further. Inside that circle the
 * line is still in the water it describes and still as true as the measurement
 * was; outside it, easing would be inventing a course. So this cannot rescue a
 * genuinely hairpin channel, and does not pretend to — it returns what it
 * reached, and the caller says so.
 *
 * Endpoints are fixed: the first is the feature's anchor on its host and the
 * last is its head, and both are extents rather than shape.
 */
export function easeBends<T extends XY & { width?: number }>(points: T[], target = 1.2, fixed = 1): T[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const out = points.map((p) => ({ ...p }));
  const from = points.map((p) => ({ x: p.x, y: p.y }));
  for (let round = 0; round < 200; round++) {
    if (tightestBend(out) >= target) break;
    const prev = out.map((p) => ({ x: p.x, y: p.y }));
    for (let i = Math.max(1, fixed); i + 1 < out.length; i++) {
      const a = prev[i - 1]!;
      const b = prev[i]!;
      const c = prev[i + 1]!;
      const LAMBDA = 0.3;
      let x = b.x + ((a.x + c.x) / 2 - b.x) * LAMBDA;
      let y = b.y + ((a.y + c.y) / 2 - b.y) * LAMBDA;
      const cap = (out[i]!.width ?? 0) / 2;
      const dx = x - from[i]!.x;
      const dy = y - from[i]!.y;
      const moved = Math.hypot(dx, dy);
      if (cap > 0 && moved > cap) {
        x = from[i]!.x + (dx / moved) * cap;
        y = from[i]!.y + (dy / moved) * cap;
      }
      out[i]!.x = x;
      out[i]!.y = y;
    }
  }
  return out;
}
