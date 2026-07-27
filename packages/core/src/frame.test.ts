/**
 * Framing a traced shape (#174, ADR 0026).
 *
 * The point of the tool is that its mistakes are INVISIBLE — a shape shifted
 * by a constant is a plausible island in the wrong place — so these assert the
 * arithmetic exactly rather than approximately, and assert that the round trip
 * returns what went in.
 */
import { describe, expect, it } from "vitest";
import { formatPoints, frameShape, parsePoints, unframeShape } from "./frame";

const pts = (text: string): { x: number; y: number }[] => {
  const r = parsePoints(text);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("reading a traced outline", () => {
  it("takes what an author would actually paste", () => {
    expect(pts("(52,60) (55,70) (58,85)")).toEqual([{ x: 52, y: 60 }, { x: 55, y: 70 }, { x: 58, y: 85 }]);
    expect(pts("52,60 55,70 58,85")).toEqual(pts("(52,60) (55,70) (58,85)"));
    // A clause copied straight out of a document round-trips without editing.
    expect(pts("area (52,60) (55,70) (58,85)")).toEqual(pts("(52,60) (55,70) (58,85)"));
  });

  it("reads negatives and decimals", () => {
    expect(pts("(-2,-40.5) (3.25,-30)")).toEqual([{ x: -2, y: -40.5 }, { x: 3.25, y: -30 }]);
  });

  it("REPORTS what it could not read rather than dropping it", () => {
    // Silently skipping a malformed vertex is how an outline loses a cape and
    // still renders as a perfectly good island.
    expect(parsePoints("(52,60) (55 70) (58,85)")).toEqual({ error: expect.stringContaining("(55 70)") });
    expect(parsePoints("")).toEqual({ error: "no points given" });
    expect(parsePoints("bananas")).toEqual({ error: expect.stringContaining("could not read any points") });
  });
});

describe("framing", () => {
  const WHIDBEY = pts("(38,60) (43,70) (41,80) (46,92) (45,104) (50,118)");

  it("derives an anchor from the shape's centre when none is given", () => {
    const framed = frameShape(WHIDBEY);
    expect(framed.derived).toBe(true);
    expect(framed.anchor).toEqual({ x: 44, y: 89 }); // midpoint of 38..50, 60..118
    expect(framed.offsets[0]).toEqual({ x: -6, y: -29 });
  });

  it("uses the anchor it is given, so an existing feature keeps its position", () => {
    const framed = frameShape(WHIDBEY, { x: 40, y: 100 });
    expect(framed.derived).toBe(false);
    expect(framed.anchor).toEqual({ x: 40, y: 100 });
    expect(framed.offsets).toEqual([
      { x: -2, y: -40 }, { x: 3, y: -30 }, { x: 1, y: -20 },
      { x: 6, y: -8 }, { x: 5, y: 4 }, { x: 10, y: 18 },
    ]);
  });

  it("reports the extent, so a trace can be sanity-checked at a glance", () => {
    // The cheapest guard against a trace that came out at the wrong scale.
    expect(frameShape(WHIDBEY).extent).toEqual({ width: 12, height: 58 });
  });

  it("ROUND-TRIPS exactly", () => {
    const framed = frameShape(WHIDBEY, { x: 40, y: 100 });
    expect(unframeShape(framed.offsets, framed.anchor)).toEqual(WHIDBEY);
    const derived = frameShape(WHIDBEY);
    expect(unframeShape(derived.offsets, derived.anchor)).toEqual(WHIDBEY);
  });

  it("keeps the author's precision rather than trailing centroid decimals", () => {
    // A derived anchor sits at the shape's centre, which for a trace typed in
    // whole miles is often a half — and an unrounded one would push that half
    // through every vertex. The anchor is rounded to the precision the author
    // traced at instead, so whole-number input gives whole-number offsets. It
    // moves the anchor by up to half a unit, which is nothing on a map in
    // miles, and the round trip is still exact because unframing adds back
    // whatever anchor was chosen.
    const whole = frameShape(pts("(1,1) (2,5) (6,2)"));
    expect(formatPoints(whole.offsets)).toBe("(-3,-2) (-2,2) (2,-1)");
    expect(unframeShape(whole.offsets, whole.anchor)).toEqual(pts("(1,1) (2,5) (6,2)"));

    // Traced to a tenth, the offsets keep a tenth — no more, no less.
    const tenths = frameShape(pts("(1.5,1.2) (2.5,5.4) (6.5,2.6)"));
    expect(formatPoints(tenths.offsets)).toBe("(-2.5,-2.1) (-1.5,2.1) (2.5,-0.7)");
    expect(unframeShape(tenths.offsets, tenths.anchor)).toEqual(pts("(1.5,1.2) (2.5,5.4) (6.5,2.6)"));
  });

  it("never prints a negative zero", () => {
    // -0 in an outline reads as a typo and invites an author to 'fix' it.
    expect(formatPoints(frameShape(pts("(0,0) (10,0) (5,10)")).offsets)).not.toContain("-0)");
    expect(formatPoints(frameShape(pts("(0,0) (10,0) (5,10)")).offsets)).not.toContain("(-0,");
  });

  it("the framed outline is what spec 05 §4 wants pasted onto an entity line", () => {
    const framed = frameShape(WHIDBEY, { x: 40, y: 100 });
    expect(`island whidbey "Whidbey Island" : near shore at (${framed.anchor.x},${framed.anchor.y}) area ${formatPoints(framed.offsets)}`)
      .toBe(`island whidbey "Whidbey Island" : near shore at (40,100) area (-2,-40) (3,-30) (1,-20) (6,-8) (5,4) (10,18)`);
  });
});
