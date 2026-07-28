/**
 * Tracing an island from a point inside it (#197).
 *
 * The DIAGNOSTICS are the point as much as the geometry: five of the Puget
 * Sound exercise's island anchors turned out not to be on their islands, and
 * nothing in the toolchain could say so for nine rounds.
 */
import { describe, expect, it } from "vitest";
import { IslandError, measureIsland } from "./island";
import type { Mask } from "./raster";
import type { Georef } from "./georef";

const W = 200;
const H = 200;

/** A big landmass on the left, one round island offshore, one speck. */
const scene = (): Mask => {
  const bits = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mainland = x < 60;
      const island = Math.hypot(x - 130, y - 100) < 25;
      const speck = Math.hypot(x - 180, y - 30) < 2;
      if (mainland || island || speck) bits[y * W + x] = 0;
    }
  }
  return { width: W, height: H, bits };
};

const georef = (milesPerPixel: number): Georef => ({
  toMap: (px, py) => ({ x: px * milesPerPixel, y: py * milesPerPixel }),
  toPixel: (x, y) => ({ x: x / milesPerPixel, y: y / milesPerPixel }),
  extent: { width: W * milesPerPixel, height: H * milesPerPixel },
  milesPerPixel,
  rotationDegrees: 0,
  residualMiles: 0,
  baseline: 1,
});

const G = georef(0.1);

describe("tracing the island a point sits on", () => {
  it("returns its outline, framed as offsets from the anchor", () => {
    const got = measureIsland(scene(), G, { x: 130, y: 100 });
    // ADR 0026: an outline is offsets from the anchor, so moving the island is
    // one coordinate and the shape travels with it.
    const spread = Math.max(...got.offsets.map((p) => Math.hypot(p.x, p.y)));
    expect(spread).toBeGreaterThan(2);
    expect(spread).toBeLessThan(3.5);
    // The anchor is the ring's centroid, so the offsets straddle it.
    expect(Math.min(...got.offsets.map((p) => p.x))).toBeLessThan(0);
    expect(Math.max(...got.offsets.map((p) => p.x))).toBeGreaterThan(0);
    expect(got.anchor.x).toBeCloseTo(13, 0);
    expect(got.anchor.y).toBeCloseTo(10, 0);
  });

  it("measures its area", () => {
    // A disc of 25 pixels at a tenth of a mile: pi * 2.5^2 = 19.6 sq mi.
    const got = measureIsland(scene(), G, { x: 130, y: 100 });
    expect(got.areaMiles).toBeGreaterThan(17);
    expect(got.areaMiles).toBeLessThan(22);
  });

  it("takes the island the point is on, not the largest landmass", () => {
    const island = measureIsland(scene(), G, { x: 130, y: 100 });
    expect(island.areaMiles).toBeLessThan(50);
  });
});

describe("a point that is not on an island", () => {
  it("in water: names the nearest land, how far and how big", () => {
    // "Your anchor is wrong, here is the island you meant" is a one-edit fix.
    // "Your anchor is wrong" is not.
    let message = "";
    try { measureIsland(scene(), G, { x: 130, y: 60 }); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/that point is in water/);
    expect(message).toMatch(/nearest land is [\d.]+mi away/);
    expect(message).toMatch(/covers \d+ sq mi/);
    expect(message).toMatch(/Did you mean a point on that\?/);
  });

  it("on the mainland: says so, and why no anchor fixes it", () => {
    // No threshold is needed — the mainland is the largest land run in the
    // picture, which is exact.
    let message = "";
    try { measureIsland(scene(), G, { x: 20, y: 100 }); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/on the mainland/);
    expect(message).toMatch(/largest in this image/);
    expect(message).toMatch(/narrower than this classification can see/);
  });

  it("a speck: refuses rather than tracing the pixel grid", () => {
    expect(() => measureIsland(scene(), G, { x: 180, y: 30 })).toThrow(IslandError);
    expect(() => measureIsland(scene(), G, { x: 180, y: 30 })).toThrow(/below what this image resolves/);
  });

  it("off the image entirely", () => {
    expect(() => measureIsland(scene(), G, { x: -5, y: 10 })).toThrow(/outside the image/);
  });
});
