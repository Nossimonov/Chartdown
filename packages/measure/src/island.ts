/**
 * An island traced from a point inside it (#197).
 *
 * `feature` measures inlets and needs a mouth to close and water to flood; an
 * island has neither. So the one class of feature the Puget Sound exercise had
 * been wrong about for nine rounds was the one the toolchain could not help
 * with — nine outlines written from recollection, described in the document as
 * traced and not traced at all: 4-to-11-point convex rings with roughly the
 * right extent and an invented shape, and nothing able to tell the difference.
 *
 * The two DIAGNOSTICS here are worth more than the geometry. Five of that map's
 * island anchors turned out not to be on their islands — some in water, some on
 * the mainland — and a tool that says so would have caught it in round 5 rather
 * than round 9.
 */

import { labelLand, traceRingFrom } from "./coast";
import type { Georef, XY } from "./georef";
import type { Mask } from "./raster";

export class IslandError extends Error {}

export interface MeasuredIsland {
  /** The ring's centroid, in map coordinates — the feature's anchor. */
  anchor: XY;
  /** The outline as OFFSETS from that anchor, per ADR 0026. */
  offsets: XY[];
  /** Area in square miles, for reporting. */
  areaMiles: number;
}

/** Area of a closed ring by the shoelace formula, always positive. */
const shoelace = (ring: XY[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

/**
 * Trace the island containing `inside`, which is a PIXEL.
 *
 * The smallest land run containing the point is the island rather than the
 * mainland it sits off, and the two ways that can fail are both reported rather
 * than measured around:
 *
 * - **the point is in water** — the anchor is not on land at all. The report
 *   names the nearest land, how far away it is and how big it is, because
 *   "your anchor is wrong, here is the island you meant" is a one-edit fix and
 *   "your anchor is wrong" is not;
 * - **the point is on the mainland** — there is no island ring to find, and no
 *   anchor fixes that. Either the classification needs tuning, or the channel
 *   that should separate them is narrower than the image can see, which is the
 *   question ADR 0027 left open.
 */
export function measureIsland(mask: Mask, georef: Georef, inside: XY): MeasuredIsland {
  const { width, height, bits } = mask;
  const px = Math.round(inside.x);
  const py = Math.round(inside.y);
  if (px < 0 || py < 0 || px >= width || py >= height) {
    throw new IslandError(`the point at ${px},${py} is outside the image`);
  }
  const perPixel = georef.milesPerPixel;
  const sqMiles = (pixels: number): number => pixels * perPixel * perPixel;
  const { runs, labels } = labelLand(mask);
  if (runs.length === 0) throw new IslandError("no land in this image — check the classification, or --invert");

  if (bits[py * width + px] === 1) {
    // In water. Find the nearest land and say what it is, so the reader can
    // tell "I missed by a little" from "there is nothing there".
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== 0) continue;
      const d = Math.hypot((i % width) - px, ((i / width) | 0) - py);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) throw new IslandError("no land in this image — check the classification, or --invert");
    const run = runs.find((r) => r.label === labels[best]);
    const size = run ? sqMiles(run.size) : 0;
    const at = georef.toMap(best % width, (best / width) | 0);
    throw new IslandError(
      `that point is in water — the nearest land is ${(bestD * perPixel).toFixed(1)}mi away at `
      + `(${at.x.toFixed(1)},${at.y.toFixed(1)}) and covers ${size.toFixed(0)} sq mi. Did you mean a point on that?`,
    );
  }

  const here = runs.find((r) => r.label === labels[py * width + px]);
  if (!here) throw new IslandError("the point is on land the trace could not label — this is a bug");
  // THE MAINLAND IS NOT AN ISLAND, and the test needs no threshold: it is the
  // largest land run in the picture. A point on it has no island ring to find,
  // and no anchor will produce one.
  if (here.top === runs[0]!.top && runs.length > 1) {
    throw new IslandError(
      `that point is on the mainland — the land run containing it covers ${sqMiles(here.size).toFixed(0)} sq mi, `
      + `the largest in this image. If it should be an island, the channel separating it is narrower than this `
      + `classification can see: try a smaller --close, or a different --index (spec 05 §2)`,
    );
  }

  // A SPECK IS NOT AN OUTLINE. Below a handful of pixels the traced ring is
  // the pixel grid rather than the island — Protection Island, about a square
  // mile of low sand, came back as four points and zero square miles, which
  // would have gone into a document as a tiny rectangle presented as a survey.
  const MIN_PIXELS = 12;
  if (here.size < MIN_PIXELS) {
    throw new IslandError(
      `that landmass is ${here.size} pixels — ${sqMiles(here.size).toFixed(2)} sq mi at ${perPixel.toFixed(3)}mi `
      + `per pixel, which is below what this image resolves. Its outline would be the pixel grid rather than the `
      + `island. Trace it from a finer image, or declare it with size= and reach= instead`,
    );
  }
  const ring = traceRingFrom(mask, here.top);
  if (ring.length < 4) throw new IslandError("that landmass is too small to trace an outline from");
  const mapRing = ring.map((p) => georef.toMap(p.x, p.y));
  // The anchor is the ring's centroid, so the offsets straddle it and the
  // declaration reads as a shape at a place rather than a place with a tail.
  const anchor = {
    x: mapRing.reduce((t, p) => t + p.x, 0) / mapRing.length,
    y: mapRing.reduce((t, p) => t + p.y, 0) / mapRing.length,
  };
  return {
    anchor,
    offsets: mapRing.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y })),
    areaMiles: shoelace(mapRing),
  };
}
