/**
 * Turning a picture into "water here, land there", and the shape operations
 * that make the answer usable.
 *
 * NO FITTED THRESHOLDS. #181's prototype classified water as `R < 20` with
 * land at `R` 148–161 and a blue-green test bolted on for shaded forest —
 * numbers true of one Landsat scene and of nothing else. ADR 0029 names that
 * as this package's standing risk: constants tuned to somebody's imagery
 * become bug reports about their photograph. So the threshold is CHOSEN PER
 * IMAGE by Otsu's method, which maximises the separation between the two
 * classes it finds, and the choice is REPORTED — a run that classified 3% or
 * 97% of the frame as water is visibly wrong before anything is measured.
 */

import type { Raster } from "./png";

export interface Mask {
  width: number;
  height: number;
  /** One byte per pixel: 1 where water, 0 where land. */
  bits: Uint8Array;
}

export interface Classification {
  mask: Mask;
  /** Where Otsu cut, on the 0..255 index scale. */
  threshold: number;
  /** Fraction of the frame taken as water — the sanity check on the cut. */
  waterFraction: number;
  index: IndexName;
}

/**
 * How to score a pixel's wetness before thresholding.
 *
 * `luma` suits ordinary satellite imagery and hand-made masks alike, because
 * water is darker than land in both. `blue` is for the case that beat the
 * prototype: shaded forest is as dark as water and is not blue, so scoring on
 * blueness separates them where brightness cannot.
 */
export type IndexName = "luma" | "blue";

const score = (r: number, g: number, b: number, index: IndexName): number =>
  index === "blue"
    ? Math.max(0, Math.min(255, 128 + b - (r + g) / 2))
    : 255 - (0.299 * r + 0.587 * g + 0.114 * b);

/** Otsu's threshold over a 256-bin histogram: no constants, one pass. */
function otsu(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i]!;
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightB += histogram[t]!;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * histogram[t]!;
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/**
 * Split an image into water and land.
 *
 * `wetter` is the side of the cut water falls on. Both indices are written so
 * that water scores HIGH, so the default is the upper class; an author whose
 * mask is the other way round says so rather than editing their image.
 */
export function classifyWater(raster: Raster, index: IndexName = "luma", invert = false): Classification {
  const { width, height, data } = raster;
  const n = width * height;
  const values = new Uint8Array(n);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = Math.round(score(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, index));
    values[i] = v;
    histogram[v]!++;
  }
  const threshold = otsu(histogram, n);
  const bits = new Uint8Array(n);
  let wet = 0;
  for (let i = 0; i < n; i++) {
    const water = invert ? values[i]! <= threshold : values[i]! > threshold;
    bits[i] = water ? 1 : 0;
    if (water) wet++;
  }
  return { mask: { width, height, bits }, threshold, waterFraction: wet / n, index };
}

const shift = (mask: Mask, radius: number, grow: boolean): Mask => {
  const { width, height, bits } = mask;
  const out = new Uint8Array(bits.length);
  // Separable: a square structuring element is a horizontal pass then a
  // vertical one, which is O(n·r) rather than O(n·r²).
  const mid = new Uint8Array(bits.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = grow ? 0 : 1;
      for (let d = -radius; d <= radius; d++) {
        const sx = x + d;
        if (sx < 0 || sx >= width) continue;
        const v = bits[y * width + sx]!;
        if (grow ? v === 1 : v === 0) { hit = grow ? 1 : 0; break; }
      }
      mid[y * width + x] = hit;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = grow ? 0 : 1;
      for (let d = -radius; d <= radius; d++) {
        const sy = y + d;
        if (sy < 0 || sy >= height) continue;
        const v = mid[sy * width + x]!;
        if (grow ? v === 1 : v === 0) { hit = grow ? 1 : 0; break; }
      }
      out[y * width + x] = hit;
    }
  }
  return { width, height, bits: out };
};

/**
 * Close thin breaks in the water before anything is labelled.
 *
 * Order matters and #181 records why: label first and a half-mile passage
 * pinched shut by noise takes a whole arm of the map into a different
 * component. Dilate then erode reconnects a channel a few pixels wide without
 * moving any boundary that was never broken.
 *
 * BEYOND THE FRAME COUNTS AS WATER when eroding. A sea normally runs off the
 * edge of the picture, and eroding against empty space would cut a strip of it
 * away at the border — which is the one thing this step exists to prevent. The
 * price is that anything dilated INTO the border stays there, so a shape within
 * `radius` of the edge may grow by up to that much.
 */
export const closeGaps = (mask: Mask, radius: number): Mask =>
  radius <= 0 ? mask : shift(shift(mask, radius, true), radius, false);

/** Every pixel reachable from a seed, 4-connected, within one class. */
export function flood(mask: Mask, seed: number, want: 0 | 1 = 1): Uint8Array {
  const { width, height, bits } = mask;
  const seen = new Uint8Array(bits.length);
  if (bits[seed] !== want) return seen;
  // An explicit stack: a 100-megapixel frame would overflow a recursive one.
  const stack = new Int32Array(bits.length);
  let top = 0;
  stack[top++] = seed;
  seen[seed] = 1;
  while (top > 0) {
    const at = stack[--top]!;
    const x = at % width;
    const y = (at / width) | 0;
    if (x > 0 && !seen[at - 1] && bits[at - 1] === want) { seen[at - 1] = 1; stack[top++] = at - 1; }
    if (x + 1 < width && !seen[at + 1] && bits[at + 1] === want) { seen[at + 1] = 1; stack[top++] = at + 1; }
    if (y > 0 && !seen[at - width] && bits[at - width] === want) { seen[at - width] = 1; stack[top++] = at - width; }
    if (y + 1 < height && !seen[at + width] && bits[at + width] === want) { seen[at + width] = 1; stack[top++] = at + width; }
  }
  return seen;
}

/**
 * The largest connected body of water — the sea, as against every pond and
 * every misclassified roof.
 */
export function largestBody(mask: Mask): Mask {
  const { width, height, bits } = mask;
  const label = new Int32Array(bits.length).fill(-1);
  let best: number[] = [];
  let bestSize = 0;
  const stack = new Int32Array(bits.length);
  for (let start = 0; start < bits.length; start++) {
    if (bits[start] !== 1 || label[start] !== -1) continue;
    let top = 0;
    let size = 0;
    const members: number[] = [];
    stack[top++] = start;
    label[start] = start;
    while (top > 0) {
      const at = stack[--top]!;
      members.push(at);
      size++;
      const x = at % width;
      const y = (at / width) | 0;
      const push = (to: number): void => {
        if (bits[to] === 1 && label[to] === -1) { label[to] = start; stack[top++] = to; }
      };
      if (x > 0) push(at - 1);
      if (x + 1 < width) push(at + 1);
      if (y > 0) push(at - width);
      if (y + 1 < height) push(at + width);
    }
    if (size > bestSize) { bestSize = size; best = members; }
  }
  const out = new Uint8Array(bits.length);
  for (const i of best) out[i] = 1;
  return { width, height, bits: out };
}

/**
 * Distance from every water pixel to the nearest land, in pixels.
 *
 * Two-pass chamfer, which is a good enough Euclidean approximation for reading
 * a channel's width off its middle and costs one pass each way.
 */
export function distanceToLand(mask: Mask): Float32Array {
  const { width, height, bits } = mask;
  const dist = new Float32Array(bits.length);
  const FAR = 1e9;
  for (let i = 0; i < bits.length; i++) dist[i] = bits[i] === 1 ? FAR : 0;
  const near = (a: number, b: number): number => Math.min(a, b);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i]!;
      if (x > 0) d = near(d, dist[i - 1]! + 1);
      if (y > 0) d = near(d, dist[i - width]! + 1);
      if (x > 0 && y > 0) d = near(d, dist[i - width - 1]! + Math.SQRT2);
      if (x + 1 < width && y > 0) d = near(d, dist[i - width + 1]! + Math.SQRT2);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i]!;
      if (x + 1 < width) d = near(d, dist[i + 1]! + 1);
      if (y + 1 < height) d = near(d, dist[i + width]! + 1);
      if (x + 1 < width && y + 1 < height) d = near(d, dist[i + width + 1]! + Math.SQRT2);
      if (x > 0 && y + 1 < height) d = near(d, dist[i + width - 1]! + Math.SQRT2);
      dist[i] = d;
    }
  }
  return dist;
}
