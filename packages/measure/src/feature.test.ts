/**
 * Measured against inlets built to known dimensions, because the whole point
 * of this package is that a number nobody checked is what six rounds of the
 * Puget Sound exercise produced.
 */
import { describe, expect, it } from "vitest";
import { measureFeature, MeasureError, simplify } from "./feature";
import type { Mask } from "./raster";
import type { Georef } from "./georef";

const W = 400;
const H = 300;

/** A georeference with no rotation and a round scale, so miles are readable. */
const georef = (milesPerPixel: number): Georef => ({
  toMap: (px, py) => ({ x: px * milesPerPixel, y: py * milesPerPixel }),
  extent: { width: W * milesPerPixel, height: H * milesPerPixel },
  milesPerPixel,
  rotationDegrees: 0,
  residualMiles: 0,
  baseline: 1,
});

/** Open sea down the west edge, plus whatever `carve` calls water. */
const scene = (carve: (x: number, y: number) => boolean): Mask => {
  const bits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) bits[y * W + x] = x < 40 || carve(x, y) ? 1 : 0;
  }
  return { width: W, height: H, bits };
};

/** A straight channel east from the sea: 20px wide, 200px long. */
const STRAIGHT = scene((x, y) => x >= 40 && x < 240 && Math.abs(y - 150) < 10);

describe("measuring a straight inlet of known size", () => {
  const got = measureFeature(STRAIGHT, georef(0.1), { x: 45, y: 150 }, { x: 200, y: 150 });

  it("reads the mouth width from the image", () => {
    // 20 pixels at a tenth of a mile each.
    expect(got.size).toBeCloseTo(2, 1);
  });

  it("reads the depth along the channel", () => {
    // ~200 pixels of channel, measured from the mouth cut.
    expect(got.depth).toBeGreaterThan(18);
    expect(got.depth).toBeLessThan(21);
  });

  it("anchors at the middle of the mouth, in map coordinates", () => {
    expect(got.anchor.x).toBeCloseTo(4.5, 0);
    expect(got.anchor.y).toBeCloseTo(15, 1);
  });

  it("runs its centerline down the middle", () => {
    for (const p of got.centerline) expect(Math.abs(p.y - 15)).toBeLessThan(0.4);
    // And it goes INWARD: the last control is deeper than the first.
    expect(got.centerline[got.centerline.length - 1]!.x).toBeGreaterThan(got.centerline[0]!.x + 15);
  });

  it("calls a parallel-sided channel barely tapered", () => {
    // Nothing converges until the very end, which is what taper= means.
    expect(got.taper).toBeLessThan(0.25);
  });
});

describe("measuring a channel that bends, which is the case via exists for", () => {
  // East 120px, then south 100px — the shape of a Great Bend.
  const BENT = scene((x, y) =>
    (x >= 40 && x < 160 && Math.abs(y - 100) < 10) || (Math.abs(x - 150) < 10 && y >= 100 && y < 200));
  // The mouth sits inside the channel, not at its junction with the sea: a
  // chord across the junction slips into open water and is refused, correctly.
  const got = measureFeature(BENT, georef(0.1), { x: 60, y: 100 }, { x: 150, y: 190 });

  it("measures the distance THROUGH the water, not across the headland", () => {
    // Straight line from mouth to head is ~145px = 14.5mi; along the channel
    // it is ~220px = 22mi. The second is the one `via` has to reproduce.
    const asCrowFlies = Math.hypot(150 - 60, 190 - 100) * 0.1;
    // The claim is the RATIO, not a particular number of miles: going round
    // the corner is half again as far as cutting across it.
    expect(got.depth).toBeGreaterThan(asCrowFlies * 1.4);
  });

  it("produces a centerline that turns the corner", () => {
    const first = got.centerline[0]!;
    const last = got.centerline[got.centerline.length - 1]!;
    // It ends south and east of where it began, having gone east first.
    expect(last.x).toBeGreaterThan(first.x + 8);
    expect(last.y).toBeGreaterThan(first.y + 6);
    const easternmost = Math.max(...got.centerline.map((p) => p.x));
    expect(easternmost).toBeGreaterThan(last.x - 1);
  });
});

describe("measuring a wedge, which should read as fully tapered", () => {
  // Wide at the mouth, closing to nothing: a cove rather than a fjord.
  const WEDGE = scene((x, y) => x >= 40 && x < 240 && Math.abs(y - 150) < 30 * (1 - (x - 40) / 200));
  const got = measureFeature(WEDGE, georef(0.1), { x: 45, y: 150 }, { x: 180, y: 150 });

  it("distinguishes it from the parallel-sided channel", () => {
    const straight = measureFeature(STRAIGHT, georef(0.1), { x: 45, y: 150 }, { x: 200, y: 150 });
    expect(got.taper).toBeGreaterThan(straight.taper);
    expect(got.taper).toBeGreaterThan(0.5);
  });

  it("narrows down its profile from mouth to head", () => {
    const first = got.profile[0]!.halfWidth;
    const last = got.profile[got.profile.length - 1]!.halfWidth;
    expect(last).toBeLessThan(first / 2);
  });
});

describe("refusing to measure what it cannot", () => {
  it("says so when the mouth is on land", () => {
    expect(() => measureFeature(STRAIGHT, georef(0.1), { x: 300, y: 20 }, { x: 200, y: 150 }))
      .toThrow(/not on water/);
  });

  it("says so when the mouth is in open water rather than between headlands", () => {
    // Measuring across the channel here runs off the picture without meeting a
    // shore. Left alone it would report the sea's own dimensions as an inlet's
    // — plausible, and completely wrong.
    const OPEN = scene((x) => x < 380);
    expect(() => measureFeature(OPEN, georef(0.1), { x: 40, y: 150 }, { x: 300, y: 150 }))
      .toThrow(/does not close on land/);
  });

  it("says so when the inward point is not water", () => {
    expect(() => measureFeature(STRAIGHT, georef(0.1), { x: 45, y: 150 }, { x: 300, y: 20 }))
      .toThrow(/should sit inside the inlet/);
  });
});

describe("thinning a centerline to what a person would write", () => {
  it("keeps a bend and drops the points along a straight run", () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 2 }, { x: 5, y: 4 }];
    const thin = simplify(line, 0.2);
    expect(thin.length).toBeLessThan(line.length);
    expect(thin[0]).toEqual({ x: 0, y: 0 });
    expect(thin[thin.length - 1]).toEqual({ x: 5, y: 4 });
    // The corner at (3,0) survives; the collinear points before it do not.
    expect(thin).toContainEqual({ x: 3, y: 0 });
    expect(thin).not.toContainEqual({ x: 1, y: 0 });
  });

  it("leaves a short line alone", () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5)).toHaveLength(2);
  });
});
