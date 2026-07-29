import { describe, expect, it } from "vitest";
import { classifyWater, closeGaps, distanceToLand, flood, largestBody, type Mask } from "./raster";
import type { Raster } from "./png";

/** An image from a per-pixel colour function, so a scene has a known truth. */
const image = (w: number, h: number, at: (x: number, y: number) => [number, number, number]): Raster => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
};

const mask = (w: number, h: number, rows: string[]): Mask => ({
  width: w, height: h,
  bits: Uint8Array.from(rows.join("").split("").map((c) => (c === "#" ? 1 : 0))),
});

const show = (m: Mask): string[] => {
  const out: string[] = [];
  for (let y = 0; y < m.height; y++) {
    out.push([...m.bits.slice(y * m.width, (y + 1) * m.width)].map((b) => (b ? "#" : ".")).join(""));
  }
  return out;
};

describe("classifying water without fitted thresholds", () => {
  it("finds the cut itself on a dark-sea, bright-land scene", () => {
    // West half sea, east half land — no constant in the code knows that.
    const scene = image(40, 20, (x) => (x < 20 ? [12, 18, 40] : [150, 155, 120]));
    const got = classifyWater(scene);
    expect(got.waterFraction).toBeCloseTo(0.5, 2);
    expect(got.mask.bits[0]).toBe(1);
    expect(got.mask.bits[39]).toBe(0);
  });

  it("works on a plain black-and-white mask, which has no imagery in it at all", () => {
    const drawn = image(20, 10, (x) => (x < 8 ? [0, 0, 0] : [255, 255, 255]));
    const got = classifyWater(drawn);
    expect(got.waterFraction).toBeCloseTo(0.4, 2);
  });

  it("separates water from shaded forest, which brightness cannot", () => {
    // The case that beat #181's prototype: dark green forest is as dark as
    // water. On `luma` it reads as water; on `blue` it does not.
    const scene = image(30, 10, (x) => (x < 10 ? [10, 14, 60] : x < 20 ? [12, 30, 12] : [150, 150, 120]));
    const byLuma = classifyWater(scene, "luma");
    const byBlue = classifyWater(scene, "blue");
    // Forest sits in the middle third; sample it.
    const at = (m: Mask, x: number): number => m.bits[5 * 30 + x]!;
    expect(at(byLuma.mask, 15)).toBe(1);
    expect(at(byBlue.mask, 15)).toBe(0);
    expect(at(byBlue.mask, 5)).toBe(1);
  });

  it("inverts on request rather than making the author edit the picture", () => {
    const scene = image(20, 10, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]));
    expect(classifyWater(scene, "luma", true).mask.bits[0]).toBe(0);
  });
});

describe("closing thin breaks before anything is labelled", () => {
  it("reconnects a channel broken by a pixel of noise", () => {
    const broken = mask(7, 3, [
      ".......",
      "###.###",
      ".......",
    ]);
    expect(show(closeGaps(broken, 1))[1]).toBe("#######");
  });

  it("leaves a boundary that was never broken where it was", () => {
    // Clear of the frame by more than the radius. Nearer than that a shape
    // grows, because erosion treats beyond-the-frame as water so that closing
    // cannot disconnect a sea that runs off the picture — see `closeGaps`.
    const clean = mask(9, 5, [
      ".........",
      ".........",
      "..###....",
      ".........",
      ".........",
    ]);
    expect(show(closeGaps(clean, 1))).toEqual(show(clean));
  });
});

describe("keeping the sea and nothing else", () => {
  it("drops a pond and keeps the largest body", () => {
    const scene = mask(8, 4, [
      "####...#",
      "####....",
      "####...#",
      "####....",
    ]);
    const sea = largestBody(scene);
    expect(show(sea)).toEqual(["####....", "####....", "####....", "####...."]);
  });

  it("floods only what is reachable", () => {
    const scene = mask(5, 3, [
      "##.##",
      "##.##",
      "##.##",
    ]);
    const reached = flood(scene, 0);
    expect(reached[0]).toBe(1);
    expect(reached[1]).toBe(1);
    // Across the land stripe, the other body is not reached.
    expect(reached[3]).toBe(0);
  });
});

describe("distance to land", () => {
  it("is zero on land and grows into open water", () => {
    // '#' is water; the dots either side are land.
    const scene = mask(9, 1, ["....###.."]);
    const d = distanceToLand(scene);
    expect(d[0]).toBe(0);
    expect(d[4]).toBeGreaterThan(0);
    expect(d[5]).toBeGreaterThan(d[4]!);
  });

  it("peaks in the middle of a channel, which is how its width is read", () => {
    const channel = mask(7, 7, [
      ".......",
      ".......",
      "#######",
      "#######",
      "#######",
      ".......",
      ".......",
    ]);
    const d = distanceToLand(channel);
    const middle = d[3 * 7 + 3]!;
    const edge = d[2 * 7 + 3]!;
    expect(middle).toBeGreaterThan(edge);
    expect(middle).toBeCloseTo(2, 5);
  });
});
