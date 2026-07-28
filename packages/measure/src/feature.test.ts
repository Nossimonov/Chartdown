/**
 * Measured against inlets built to known dimensions, because the whole point
 * of this package is that a number nobody checked is what six rounds of the
 * Puget Sound exercise produced.
 */
import { describe, expect, it } from "vitest";
import { easeBends, measureFeature, MeasureError, simplify, tightestBend } from "./feature";
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
    // The claim is the RATIO, not a particular number of miles: going round the
    // corner is a third again as far as cutting across it. Not the full √2 of
    // the centerline's own L, because the shortest way through a channel with
    // width to it clips the inside of the bend — which is what a geodesic
    // through water means, and what a boat would do.
    expect(got.depth).toBeGreaterThan(asCrowFlies * 1.25);
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

describe("a channel running DIAGONALLY, where the metric had to be right (#181)", () => {
  // Every other fixture here runs along an axis, and a four-connected walk is
  // EXACT along an axis — so the suite was blind to its 41% overstatement of a
  // diagonal until the real Puget Sound mask showed Hood Canal at 79.7mi where
  // the reference tracing says 55.8. That ratio, 1.428, is √2 wearing a hat.
  const DIAGONAL = scene((x, y) => x >= 40 && Math.abs((y - 60) - (x - 40)) < 10 && y < 260);
  const got = measureFeature(DIAGONAL, georef(0.1), { x: 60, y: 80 }, { x: 200, y: 220 });

  it("measures a 45° run at its true length, not its Manhattan length", () => {
    // From (60,80) to the far end near (240,260): about 180px each way, so a
    // true length near 254px = 25.4mi. Manhattan would call it 360px = 36mi.
    expect(got.depth).toBeGreaterThan(22);
    expect(got.depth).toBeLessThan(28);
  });

  it("measures the mouth PERPENDICULAR to the run, not along an axis", () => {
    // `|y - x - 20| < 10` is a band whose perpendicular half-width is 10/√2,
    // so the channel is 14.14px across — and a horizontal or vertical chord
    // through it would measure 20. Finding 1.41mi rather than 2.0 is the
    // narrowest-chord search doing its job on a diagonal.
    expect(got.size).toBeCloseTo(1.41, 1);
  });
});

describe("a centerline follows the trunk, not the arms (#192)", () => {
  // Flooding behind a mouth captures the arms too, and an arm's water sits at
  // much the same distance from the mouth as the trunk beside it — so a band
  // spanning both had its centre BETWEEN them, and the line left the channel.
  // On Hood Canal it doubled back through Dabob and Quilcene and returned: six
  // controls reversing on themselves, carrying widths of 0.14, 0.1 and 0.38mi
  // on a channel whose median is 1.5.
  const TRUNK_LOW = 145;
  const TRUNK_HIGH = 155;
  // A straight channel east, with a BAY hanging off its north side: a narrow
  // neck opening into a body wider than the trunk, which is what an arm looks
  // like — Dabob off Hood Canal. An opening WIDER than the trunk is not an arm
  // but a basin, and the channel there really does widen; this does not claim
  // to tell those apart, because they are not different things.
  const ARMED = scene((x, y) =>
    (x >= 40 && x < 300 && y > TRUNK_LOW && y < TRUNK_HIGH)
    || (x >= 160 && x < 172 && y > 118 && y <= TRUNK_LOW)
    || (x >= 140 && x < 210 && y > 95 && y <= 118));

  const got = measureFeature(ARMED, georef(0.1), { x: 45, y: 150 }, { x: 280, y: 150 });

  it("stays in the trunk where an arm hangs off it", () => {
    // Every control belongs to the channel it is describing. Pulled toward the
    // arm, the centre of the band leaves the water entirely.
    for (const p of got.centerline) {
      const py = p.y / 0.1;
      expect(py, `(${p.x},${p.y})`).toBeGreaterThan(TRUNK_LOW - 2);
      expect(py, `(${p.x},${p.y})`).toBeLessThan(TRUNK_HIGH + 2);
    }
  });

  it("never doubles back on itself", () => {
    // The signature of the defect: a control behind the one before it.
    for (let i = 1; i < got.centerline.length; i++) {
      expect(got.centerline[i]!.x, `control ${i}`).toBeGreaterThan(got.centerline[i - 1]!.x - 1e-9);
    }
  });

  it("does not report the arm as part of the trunk's own length", () => {
    // 260 pixels of trunk at a tenth of a mile each; the arm adds none of it.
    expect(got.depth).toBeGreaterThan(22);
    expect(got.depth).toBeLessThan(30);
  });
});

/** An elbow whose controls clear the width but whose splined curve does not. */
const KINKED = [
  { x: 0, y: 0, width: 4 }, { x: 10, y: 0, width: 4 },
  { x: 11, y: 1.5, width: 4 }, { x: 11, y: 12, width: 4 },
];

/** Radius of the circle through each consecutive triple of controls. */
const circumradii = (pts: { x: number; y: number }[]): number[] => {
  const out: number[] = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    if (area < 1e-12) continue;
    out.push((Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) * Math.hypot(a.x - c.x, a.y - c.y)) / (4 * area));
  }
  return out;
};

describe("a measured centerline is checked as the renderer will draw it (#192)", () => {
  // Spec 05 §4 refuses a bend whose radius drops below the half-width there,
  // and the curve that has to satisfy it is the SPLINE, not the controls. An
  // interpolating spline's curvature at a knot depends on its neighbours, so a
  // control polygon can clear the rule everywhere while the curve through it
  // does not: measured on Hood Canal, all 27 controls passed and the drawn
  // line turned at 0.5mi carrying a half-width of 1.1.
  it("sees a bend the control polygon hides", () => {
    // Three controls whose own circumradius clears the width, splined into a
    // turn that does not.
    // Every consecutive triple's own circumradius clears the half-width; the
    // curve through them does not.
    expect(Math.min(...circumradii(KINKED))).toBeGreaterThan(KINKED[0]!.width / 2);
    expect(tightestBend(KINKED)).toBeLessThan(1);
  });

  it("passes a line that turns gently for its width", () => {
    const gentle = Array.from({ length: 9 }, (_, i) => ({
      x: 20 * Math.cos((i * Math.PI) / 16), y: 20 * Math.sin((i * Math.PI) / 16), width: 2,
    }));
    expect(tightestBend(gentle)).toBeGreaterThan(1);
  });

  it("eases a bend the channel cannot follow, within the channel", () => {
    const eased = easeBends(KINKED);
    expect(tightestBend(eased)).toBeGreaterThan(tightestBend(KINKED));
    // Bounded by the channel: a control may move within its own half-width of
    // where it was measured, and no further — beyond that, easing would be
    // inventing a course rather than reading one.
    for (let i = 0; i < KINKED.length; i++) {
      const moved = Math.hypot(eased[i]!.x - KINKED[i]!.x, eased[i]!.y - KINKED[i]!.y);
      expect(moved, `control ${i}`).toBeLessThanOrEqual(KINKED[i]!.width / 2 + 1e-9);
    }
    // The endpoints are extents, not shape: the anchor and the head stay put.
    expect(eased[0]).toEqual(KINKED[0]);
    expect(eased[eased.length - 1]).toEqual(KINKED[KINKED.length - 1]);
  });

  it("leaves a straight line alone", () => {
    const straight = Array.from({ length: 6 }, (_, i) => ({ x: i * 5, y: 0, width: 2 }));
    expect(easeBends(straight)).toEqual(straight);
  });
});
