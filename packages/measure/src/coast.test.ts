/**
 * The spine, not the shore (#198).
 *
 * Measured against coasts built to known shapes, because the operation this
 * package exists to justify is exactly the one that is easy to assert and hard
 * to eyeball: a traced coastline already contains every inlet, and what a
 * document wants is the same coast with the inlets it intends to DECLARE taken
 * off.
 */
import { describe, expect, it } from "vitest";
import { arcsBetween, CoastError, fillInlets, measureCoast, runLength, traceRing } from "./coast";
import type { Mask } from "./raster";
import type { Georef } from "./georef";

const W = 200;
const H = 120;

/** Sea across the top, land below, plus whatever `carve` calls water. */
const scene = (carve: (x: number, y: number) => boolean = () => false): Mask => {
  const bits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) bits[y * W + x] = y < 40 || carve(x, y) ? 1 : 0;
  }
  return { width: W, height: H, bits };
};

/** A 4px inlet at x=50 and a 30px one at x=120, both biting 60px inland. */
const INLETS = scene((x, y) =>
  (x >= 50 && x < 54 && y < 100) || (x >= 120 && x < 150 && y < 100));

const wet = (m: Mask, x: number, y: number): boolean => m.bits[y * W + x] === 1;

const georef = (milesPerPixel: number): Georef => ({
  toMap: (px, py) => ({ x: px * milesPerPixel, y: py * milesPerPixel }),
  toPixel: (x, y) => ({ x: x / milesPerPixel, y: y / milesPerPixel }),
  extent: { width: W * milesPerPixel, height: H * milesPerPixel },
  milesPerPixel,
  rotationDegrees: 0,
  residualMiles: 0,
  baseline: 1,
});

describe("filling the inlets a document will declare", () => {
  it("removes what is narrower than twice the radius, and keeps what is not", () => {
    // The whole basis of the operation: the split between "declare this as a
    // feature" and "this is the spine" is a width, and it is the author's to
    // set — the same judgement `--mouth` already asks for.
    const r3 = fillInlets(INLETS, 3);   // 4px inlet < 6px; 30px inlet > 6px
    expect(wet(r3, 52, 80)).toBe(false);
    expect(wet(r3, 135, 80)).toBe(true);

    const r20 = fillInlets(INLETS, 20); // both below 40px
    expect(wet(r20, 52, 80)).toBe(false);
    expect(wet(r20, 135, 80)).toBe(false);
  });

  it("leaves the open sea alone at every radius it can survive", () => {
    // Up to 15 only: this fixture's sea is 40px deep, so eroding it by 40
    // legitimately consumes it. An opening cannot preserve water thinner than
    // the disc, and the sea here is thinner than the map's own scale suggests.
    for (const r of [1, 5, 15]) {
      expect(wet(fillInlets(INLETS, r), 10, 10), `r=${r}`).toBe(true);
    }
  });

  it("never invents water where the image said land", () => {
    // The dilation half of an opening can push a boundary outward, and a shore
    // that moves is a shore that is wrong — the same objection ADR 0027 makes
    // to widening a channel so it draws better.
    const filled = fillInlets(INLETS, 8);
    for (let i = 0; i < filled.bits.length; i++) {
      if (filled.bits[i] === 1) expect(INLETS.bits[i], `pixel ${i}`).toBe(1);
    }
  });

  it("is a no-op at radius zero", () => {
    expect([...fillInlets(INLETS, 0).bits]).toEqual([...INLETS.bits]);
  });

  it("cannot be reached by simplification, which is why it exists", () => {
    // A deep narrow inlet survives any tolerance below its own depth, so no
    // amount of thinning turns a traced shore into a spine.
    const traced = traceRing(INLETS);
    const spine = traceRing(fillInlets(INLETS, 3));
    // Bounded ABOVE as well: the ring also runs along the image's bottom edge,
    // which crosses the same column and is not the inlet.
    const dips = (ring: { x: number; y: number }[]): number =>
      ring.filter((p) => p.x >= 50 && p.x < 54 && p.y > 60 && p.y < 110).length;
    expect(dips(traced)).toBeGreaterThan(0);
    expect(dips(spine)).toBe(0);
  });
});

describe("tracing the boundary", () => {
  it("walks the largest landmass and comes back", () => {
    const ring = traceRing(scene());
    // The land is the lower 80 rows, so its boundary is about 2*(200+80).
    expect(ring.length).toBeGreaterThan(500);
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(2);
  });

  it("says so when there is no land", () => {
    const allWater: Mask = { width: 10, height: 10, bits: new Uint8Array(100).fill(1) };
    expect(() => traceRing(allWater)).toThrow(CoastError);
    expect(() => traceRing(allWater)).toThrow(/no land in this image/);
  });

  it("gives two complementary arcs between two points", () => {
    const ring = traceRing(scene());
    const { forward, backward } = arcsBetween(ring, { x: 10, y: 40 }, { x: 190, y: 40 });
    // Every vertex is on one arc or the other, and both ends are shared.
    expect(forward.length + backward.length).toBe(ring.length + 2);
    expect(forward[0]).toEqual(backward[0]);
    expect(forward[forward.length - 1]).toEqual(backward[backward.length - 1]);
  });
});

describe("choosing which arc is the coastline", () => {
  it("prefers the shore over the edge of the picture", () => {
    // Where land runs off the image the ring follows the frame, and that is
    // not a coastline — it is where the photograph stops. Told to take the
    // LONGER arc, the trace happily returned the way round the border: on the
    // real imagery that came back as six controls and 356 miles of straight
    // edge.
    const got = measureCoast(INLETS, georef(0.1), {
      from: { x: 2, y: 40 },
      to: { x: W - 3, y: 40 },
      fill: 3,
    });
    // The shore runs along y=40 and dips into the broad inlet; the other way
    // round is three sides of the frame.
    expect(got.forwardOnFrame).toBeLessThan(0.2);
    expect(got.backwardOnFrame).toBeGreaterThan(0.8);
    expect(got.points.every((p) => p.y < 11)).toBe(true);
  });

  it("reports both arcs' lengths whichever it takes", () => {
    const got = measureCoast(INLETS, georef(0.1), {
      from: { x: 2, y: 40 },
      to: { x: W - 3, y: 40 },
      fill: 3,
    });
    expect(got.forwardMiles).toBeGreaterThan(0);
    expect(got.backwardMiles).toBeGreaterThan(0);
    expect(runLength(got.points)).toBeCloseTo(got.forwardMiles, 6);
  });
});
