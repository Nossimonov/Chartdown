/**
 * The coastline a document wants, which is not the coastline (#198).
 *
 * A traced shore already contains every inlet, because simplification preserves
 * a large-amplitude excursion however narrow it is: Hood Canal is 1.5mi wide
 * and 40mi deep, so no tolerance below 40mi removes it. Declaring `fjord hood`
 * on a coast that already has Hood Canal in it draws the canal twice.
 *
 * What a document wants is the shore with the features it intends to declare
 * REMOVED — ADR 0023's smooth spine, with the discrete things taken off so they
 * can go back on as named entities. That is one morphological step rather than
 * a cleverer simplification: close the land with a disc, and every inlet
 * narrower than twice its radius fills in while the broad basins survive.
 */

import type { Georef, XY } from "./georef";
import { distanceToLand, type Mask } from "./raster";

export class CoastError extends Error {}

/**
 * Fill every inlet narrower than twice `radius`, in pixels.
 *
 * A morphological OPENING of the water: erode it by the radius, which deletes
 * anything thinner than twice that, then dilate what survives back out. Both
 * halves are distance transforms rather than kernel passes, so the cost is two
 * sweeps regardless of how large the radius is — a 2mi disc at 0.05mi per pixel
 * is 40 pixels across, and a kernel that size would be 5,000 samples per pixel.
 *
 * The dilation is taken from the SURVIVING water rather than by re-growing the
 * eroded shape, which is what makes this an opening and not merely an erosion:
 * water that was never thin comes back exactly where it was.
 */
export function fillInlets(mask: Mask, radius: number): Mask {
  if (!(radius > 0)) return { ...mask, bits: Uint8Array.from(mask.bits) };
  const fromLand = distanceToLand(mask);
  // Water at least `radius` from any shore: the parts too broad to be an inlet.
  const kept: Mask = {
    width: mask.width,
    height: mask.height,
    // Inverted, because `distanceToLand` measures from the 1s to the 0s and the
    // next question is "how far is this from the water that survived".
    bits: Uint8Array.from(mask.bits, (b, i) => (b === 1 && fromLand[i]! > radius ? 0 : 1)),
  };
  const toKept = distanceToLand(kept);
  const bits = new Uint8Array(mask.bits.length);
  for (let i = 0; i < bits.length; i++) {
    // Still water only where the original said so: dilating may not invent
    // water on land, or the shore would move outward by the radius.
    bits[i] = mask.bits[i] === 1 && (kept.bits[i] === 0 || toKept[i]! <= radius) ? 1 : 0;
  }
  return { width: mask.width, height: mask.height, bits };
}

/** The eight neighbours in clockwise order, starting east. */
const RING: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * Walk the outer boundary of the largest run of `land` pixels, clockwise.
 *
 * Moore-neighbour tracing: from a known boundary pixel, sweep the eight
 * neighbours from where the walk arrived and step to the first that is land.
 * It returns the ring as PIXELS, a staircase — which is the honest output at
 * this resolution, and which `simplify` then reduces to controls a person would
 * write. Smoothing it here would be inventing a shore.
 */
export function traceRing(mask: Mask): XY[] {
  const { width, height, bits } = mask;
  const land = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && bits[y * width + x] === 0;

  // The largest landmass, so an offshore speck cannot be mistaken for the coast.
  const seen = new Uint8Array(bits.length);
  let start = -1;
  let biggest = 0;
  const queue = new Int32Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== 0 || seen[i] === 1) continue;
    let tail = 0;
    let size = 0;
    let top = i;
    seen[i] = 1;
    queue[tail++] = i;
    for (let head = 0; head < tail; head++) {
      const at = queue[head]!;
      size++;
      if (at < top) top = at;
      const x = at % width;
      const y = (at / width) | 0;
      for (const [dx, dy] of RING) {
        const px = x + dx;
        const py = y + dy;
        if (!land(px, py)) continue;
        const j = py * width + px;
        if (seen[j] === 1) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    if (size > biggest) { biggest = size; start = top; }
  }
  if (start < 0) throw new CoastError("no land in this image — check the classification, or --invert");

  const sx = start % width;
  const sy = (start / width) | 0;
  const out: XY[] = [];
  let cx = sx;
  let cy = sy;
  // `top` is the lowest index, so the pixel above it is water and the walk can
  // begin by sweeping from there.
  let from = 6;
  const LIMIT = bits.length * 4;
  do {
    out.push({ x: cx, y: cy });
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const dir = (from + k) % 8;
      const [dx, dy] = RING[dir]!;
      if (!land(cx + dx, cy + dy)) continue;
      cx += dx;
      cy += dy;
      // Resume the sweep from behind where we came in, so the walk hugs the
      // boundary instead of cutting across the interior.
      from = (dir + 5) % 8;
      moved = true;
      break;
    }
    if (!moved) break;
  } while ((cx !== sx || cy !== sy) && out.length < LIMIT);
  if (out.length < 4) throw new CoastError("the largest landmass is too small to have a coastline");
  return out;
}

/** Index of the ring vertex nearest a point. */
const nearestOn = (ring: XY[], at: XY): number => {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i]!.x - at.x, ring[i]!.y - at.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
};

/** Length of a polyline, in whatever units it is expressed. */
export const runLength = (pts: XY[]): number => {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return sum;
};

/**
 * The arc of a closed ring running from one point to another.
 *
 * A ring has two of them, and which one is meant is not a fact about the
 * geometry: a coastline is an OPEN path cut from a closed boundary, and the cut
 * is the author's. Both are returned so the caller can choose and can say what
 * it chose — picking one silently is how a map comes to describe the wrong half
 * of an island.
 */
export function arcsBetween(ring: XY[], from: XY, to: XY): { forward: XY[]; backward: XY[] } {
  const a = nearestOn(ring, from);
  const b = nearestOn(ring, to);
  const forward: XY[] = [];
  for (let i = a; ; i = (i + 1) % ring.length) {
    forward.push(ring[i]!);
    if (i === b) break;
  }
  const backward: XY[] = [];
  for (let i = a; ; i = (i - 1 + ring.length) % ring.length) {
    backward.push(ring[i]!);
    if (i === b) break;
  }
  return { forward, backward };
}

export interface MeasuredCoast {
  /** The chosen arc, in map coordinates. */
  points: XY[];
  /** Length of each arc in miles, so the caller can say which it took. */
  forwardMiles: number;
  backwardMiles: number;
  /** How much of each ran along the edge of the picture, as a fraction. */
  forwardOnFrame: number;
  backwardOnFrame: number;
}

/**
 * How much of an arc lies along the edge of the image, by length.
 *
 * Where land runs off the picture the traced ring follows the frame, and that
 * stretch is not a coastline — it is where the photograph stops. Told to take
 * the LONGER of the two arcs between two points on the frame, the trace
 * happily returned the way round the border: at a 2mi fill it came back as six
 * controls and 356 miles of straight edge.
 */
function onFrame(pixels: XY[], mask: Mask): number {
  const edge = (p: XY): boolean =>
    p.x <= 1 || p.y <= 1 || p.x >= mask.width - 2 || p.y >= mask.height - 2;
  let along = 0;
  let total = 0;
  for (let i = 1; i < pixels.length; i++) {
    const d = Math.hypot(pixels[i]!.x - pixels[i - 1]!.x, pixels[i]!.y - pixels[i - 1]!.y);
    total += d;
    if (edge(pixels[i]!) && edge(pixels[i - 1]!)) along += d;
  }
  return total > 0 ? along / total : 0;
}

/**
 * Trace a coastline between two points, with narrow inlets filled.
 *
 * `fill` and `from`/`to` are in PIXELS; `tolerance` is in miles, because it is
 * a statement about the document rather than about the picture.
 */
export function measureCoast(
  mask: Mask,
  georef: Georef,
  options: { from: XY; to: XY; fill: number; through?: XY },
): MeasuredCoast {
  const filled = fillInlets(mask, options.fill);
  const ring = traceRing(filled);
  const { forward, backward } = arcsBetween(ring, options.from, options.to);
  const toMap = (pts: XY[]): XY[] => pts.map((p) => georef.toMap(p.x, p.y));
  const f = toMap(forward);
  const b = toMap(backward);
  const forwardMiles = runLength(f);
  const backwardMiles = runLength(b);
  const forwardOnFrame = onFrame(forward, filled);
  const backwardOnFrame = onFrame(backward, filled);
  // Where the author names a point the coast passes through, that settles it.
  // Otherwise the arc that is LESS of the picture's own edge: a frame is where
  // the image stops, not a shore, and preferring the longer arc sent the trace
  // the way round the border. Length breaks a tie, since between two arcs that
  // are equally coastline the shore is the convoluted one.
  const pick = options.through
    ? (nearestOn(forward, options.through) !== 0
        && nearestOn(forward, options.through) !== forward.length - 1
        ? "forward" : "backward")
    : Math.abs(forwardOnFrame - backwardOnFrame) > 0.05
      ? (forwardOnFrame < backwardOnFrame ? "forward" : "backward")
      : (forwardMiles >= backwardMiles ? "forward" : "backward");
  return {
    points: pick === "forward" ? f : b,
    forwardMiles,
    backwardMiles,
    forwardOnFrame: pick === "forward" ? forwardOnFrame : backwardOnFrame,
    backwardOnFrame: pick === "forward" ? backwardOnFrame : forwardOnFrame,
  };
}
