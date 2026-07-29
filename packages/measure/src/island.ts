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

/**
 * A SPECK IS NOT AN OUTLINE. Below a handful of pixels the traced ring is the
 * pixel grid rather than the island — Protection Island, about a square mile of
 * low sand, came back as four points and zero square miles, which would have
 * gone into a document as a tiny rectangle presented as a survey.
 *
 * At module scope because the DIAGNOSTICS have to apply the same threshold
 * (#201): a "nearest land" the tracer would itself refuse is not an answer, and
 * reporting one produced the sentence "the nearest land is 0.0mi away … and
 * covers 0 sq mi" — a point in water, with land at no distance, of no size.
 */
const MIN_PIXELS = 12;

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

  // Only a run the TRACER WOULD ACCEPT can be the answer to "did you mean
  // that?" (#201). Without this the nearest-land scan happily returned a
  // three-pixel speck, and on `_sea4.png` reported 7.1mi to nothing while the
  // nearest real land was 5.67mi away.
  const bigEnough = new Set(runs.filter((r) => r.size >= MIN_PIXELS).map((r) => r.label));

  /**
   * The nearest pixel of every qualifying land run, nearest run first.
   *
   * Per RUN rather than one global minimum, because "the nearest land" can be
   * a speck with a landmass just behind it (#201): from one probe on this
   * imagery the nearest land is 97 pixels of sand at 7.14mi and the mainland
   * is at 7.98mi, so a single answer sends the reader to the sand.
   */
  const nearestRuns = (want: (label: number) => boolean): { index: number; distance: number; size: number }[] => {
    const best = new Map<number, { index: number; distance: number }>();
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== 0) continue;
      const label = labels[i]!;
      if (!bigEnough.has(label) || !want(label)) continue;
      const d = Math.hypot((i % width) - px, ((i / width) | 0) - py);
      const cur = best.get(label);
      if (!cur || d < cur.distance) best.set(label, { index: i, distance: d });
    }
    return [...best.entries()]
      .map(([label, at]) => ({ ...at, size: runs.find((r) => r.label === label)?.size ?? 0 }))
      .sort((a, b) => a.distance - b.distance);
  };

  /**
   * A SUGGESTION THAT DOES NOT MOVE IS NOT A SUGGESTION (#201).
   *
   * The nearest land pixel sits ON the boundary, and a map coordinate prints to
   * 0.1mi — two pixels at this scale — so an author who pasted back exactly
   * what the message said landed in the water and got the same message again.
   * Two fixes at once: step to a pixel whose four neighbours are also land, and
   * give the answer in PIXELS, which carry no rounding at all.
   */
  const inward = (index: number): number => {
    const ix = index % width;
    const iy = (index / width) | 0;
    const ux = ix - px;
    const uy = iy - py;
    const len = Math.hypot(ux, uy) || 1;
    for (let step = 0; step <= 4; step++) {
      const cx = Math.round(ix + (ux / len) * step);
      const cy = Math.round(iy + (uy / len) * step);
      if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) break;
      const at = cy * width + cx;
      if (labels[at] !== labels[index]) continue;
      const solid = bits[at] === 0 && bits[at - 1] === 0 && bits[at + 1] === 0
        && bits[at - width] === 0 && bits[at + width] === 0;
      if (solid) return at;
    }
    return index;
  };

  /** Below a tenth of a mile a rounded distance reads as zero — say pixels. */
  const away = (pixels: number): string =>
    pixels * perPixel >= 0.1 ? `${(pixels * perPixel).toFixed(1)}mi` : `${Math.round(pixels)} pixels`;

  type Candidate = { index: number; distance: number; size: number };
  const describe = (c: Candidate): string => {
    const spot = inward(c.index);
    const at = georef.toMap(spot % width, (spot / width) | 0);
    const area = sqMiles(c.size);
    return `${away(c.distance)} away, ${area.toFixed(area < 1 ? 2 : 0)} sq mi, at (${at.x.toFixed(1)},${at.y.toFixed(1)})`
      + ` — \`--inside ${spot % width},${(spot / width) | 0}\``;
  };
  /**
   * The nearest, and the nearest BIGGER one if it is comparably close.
   *
   * "Bigger and within twice the distance" needs no size threshold to be
   * chosen: whether a speck is worth pointing at is decided by what else is
   * beside it, which is the fact the reader is missing rather than a number
   * anyone has to pick.
   */
  const offer = (found: Candidate[]): string => {
    const first = found[0]!;
    const bigger = found.find((c) => c.size > first.size && c.distance <= first.distance * 2);
    return bigger ? `${describe(first)}; the nearest larger land is ${describe(bigger)}` : describe(first);
  };

  if (bits[py * width + px] === 1) {
    // In water. Find the nearest land and say what it is, so the reader can
    // tell "I missed by a little" from "there is nothing there".
    const found = nearestRuns(() => true);
    if (found.length === 0) {
      throw new IslandError(
        `that point is in water, and this image has no land run big enough to trace — every one is under ${MIN_PIXELS} `
        + `pixels. Check the classification, or --invert`,
      );
    }
    throw new IslandError(`that point is in water. The nearest land is ${offer(found)}. Did you mean one of those?`);
  }

  const here = runs.find((r) => r.label === labels[py * width + px]);
  if (!here) throw new IslandError("the point is on land the trace could not label — this is a bug");
  // THE MAINLAND IS NOT AN ISLAND, and the test needs no threshold: it is the
  // largest land run in the picture. A point on it has no island ring to find,
  // and no anchor will produce one.
  if (here.top === runs[0]!.top && runs.length > 1) {
    // AND WHERE THE NEAREST THING THAT IS NOT THE MAINLAND IS (#201). "The run
    // containing it is the largest in this image" is equally true of a point on
    // an island's neighbour, a point ten miles inland, and a genuinely welded
    // island — and it reads as the third. Rounds nine and ten both concluded
    // from this message that Squaxin and McNeil were beyond the classification
    // and went looking at image resolution; the anchors were thirteen pixels
    // off their own islands, inherited from a hand-drawn map. The evidence that
    // tells the two cases apart is already in hand, so it is now given.
    const other = nearestRuns((label) => label !== here.label);
    const lead = `that point is on the mainland (${sqMiles(here.size).toFixed(0)} sq mi, the largest in this image).`;
    const advice = `the channel is narrower than this classification can see: try a smaller --close, a different `
      + `--index, or a finer image (spec 05 §2)`;
    throw new IslandError(
      other.length === 0 ? `${lead} There is no other land in this image, so ${advice}`
        : `${lead} The nearest land that is NOT the mainland is ${offer(other)}. If you meant that, use it. `
          + `If not, ${advice}`,
    );
  }

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
