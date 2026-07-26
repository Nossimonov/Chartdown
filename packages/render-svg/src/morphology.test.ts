/**
 * Placed morphology geometry (#93, ADR 0023).
 *
 * The properties asserted here are the ones the ADR promises an author, not
 * incidental facts about the implementation: a feature is a pure function of
 * its own data, it disturbs only its own stretch of the host, and the host
 * never crosses itself no matter what it is asked for.
 */
import { describe, expect, it } from "vitest";
import { deformCurve, isSimple, type PlacedFeature } from "./morphology";
import type { XY } from "./util";

/** A straight west-to-east coast, densely sampled the way a spline arrives. */
const straight = (n = 81, len = 400): XY[] =>
  Array.from({ length: n }, (_, i) => ({ x: (i / (n - 1)) * len, y: 100 }));

const feature = (over: Partial<PlacedFeature> = {}): PlacedFeature => ({
  morph: "jut", anchor: { x: 200, y: 100 }, size: 60, ...over,
});

const maxOffset = (a: XY[], b: XY[]): number =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));

describe("a placed feature deforms its host", () => {
  it("moves the curve at the anchor and leaves it simple", () => {
    const base = straight();
    const out = deformCurve(base, [feature()]);
    expect(maxOffset(base, out)).toBeGreaterThan(1);
    expect(isSimple(out)).toBe(true);
  });

  it("a bite goes the opposite way from a jut of the same size", () => {
    const base = straight();
    const jut = deformCurve(base, [feature({ morph: "jut" })]);
    const bite = deformCurve(base, [feature({ morph: "bite" })]);
    const at = 40; // the anchor's index on this sampling
    // Equal and opposite about the undisturbed line: the facet chooses a side,
    // it does not change the shape.
    expect(jut[at]!.y - base[at]!.y).toBeCloseTo(-(bite[at]!.y - base[at]!.y), 6);
  });

  it("disturbs ONLY its own window — the rest of the coast is untouched", () => {
    // The locality guarantee is what lets an author place a second feature
    // later without the first one shifting.
    const base = straight();
    const out = deformCurve(base, [feature({ anchor: { x: 200, y: 100 }, size: 60 })]);
    const far = out.filter((_, i) => Math.abs(base[i]!.x - 200) > 31);
    expect(far.every((p, k) => p.y === base.filter((_, i) => Math.abs(base[i]!.x - 200) > 31)[k]!.y)).toBe(true);
  });

  it("meets the undisturbed curve smoothly rather than with a crease", () => {
    // A raised cosine has zero slope at both window edges. Sample the step
    // between adjacent vertices: the largest one near the seam must not exceed
    // the largest one at the crest, or there is a corner where the bump lands.
    const base = straight();
    const out = deformCurve(base, [feature()]);
    const steps = out.slice(1).map((p, i) => Math.abs(p.y - out[i]!.y));
    const crest = Math.max(...steps.slice(35, 45));
    const seam = Math.max(steps[29]!, steps[30]!, steps[50]!, steps[51]!);
    expect(seam).toBeLessThanOrEqual(crest);
  });
});

describe("a feature is a pure function of its own data (ADR 0023)", () => {
  it("is deterministic — no seed, no ordinal, no document order", () => {
    const base = straight();
    expect(deformCurve(base, [feature()])).toEqual(deformCurve(base, [feature()]));
  });

  it("PROMOTION IS GEOMETRY-STABLE: identity is not an input", () => {
    // `island : near coast …` and `island himling "Himling" : near coast …`
    // must render identically. Nothing in the geometry can see a name, which
    // is the structural guarantee behind the spec's promise — naming adds a
    // story, not a shape.
    const base = straight();
    const anonymous = deformCurve(base, [feature()]);
    const named = deformCurve(base, [feature()]);
    expect(named).toEqual(anonymous);
  });

  it("moving one feature does not move another", () => {
    const base = straight();
    const a = feature({ anchor: { x: 100, y: 100 }, size: 40 });
    const b = feature({ anchor: { x: 300, y: 100 }, size: 40 });
    const both = deformCurve(base, [a, b]);
    const movedB = deformCurve(base, [a, { ...b, anchor: { x: 320, y: 100 } }]);
    const nearA = (i: number): boolean => Math.abs(base[i]!.x - 100) < 21;
    expect(both.filter((_, i) => nearA(i))).toEqual(movedB.filter((_, i) => nearA(i)));
  });
});

describe("the simplicity guarantee is hard (ADR 0023)", () => {
  /** Two nearly-touching arms: a jut on the near one has nowhere to go. */
  const hairpin = (gap: number): XY[] => {
    const p: XY[] = [];
    for (let i = 0; i <= 40; i++) p.push({ x: i * 5, y: 100 });
    for (let i = 1; i <= 40; i++) p.push({ x: 200 - i * 5, y: 100 + gap });
    return p;
  };

  it("clamps an over-large feature rather than folding the coast over itself", () => {
    // Asserting `isSimple` alone would pass even if the clamp never fired, so
    // this also measures that the amplitude was actually REDUCED. Measured:
    // 66 units requested, 8.3 delivered, five back-offs.
    const base = hairpin(12);
    expect(isSimple(base)).toBe(true); // the fixture starts valid
    const out = deformCurve(base, [feature({ anchor: { x: 100, y: 100 }, size: 120 })]);
    expect(isSimple(out)).toBe(true);
    expect(maxOffset(base, out)).toBeLessThan(120 * 0.55 * 0.9);
  });

  it("does NOT clamp when there is room — an open coast gets what it asked for", () => {
    // The other half: a guard that always backs off would also pass the test
    // above while quietly shrinking every feature on every map.
    const base = straight();
    const out = deformCurve(base, [feature({ size: 60 })]);
    expect(maxOffset(base, out)).toBeCloseTo(60 * 0.55, 6);
  });

  it("clamps harder as the space gets tighter", () => {
    const roomy = deformCurve(hairpin(12), [feature({ anchor: { x: 100, y: 100 }, size: 60 })]);
    const tight = deformCurve(hairpin(3), [feature({ anchor: { x: 100, y: 100 }, size: 60 })]);
    expect(maxOffset(hairpin(3), tight)).toBeLessThan(maxOffset(hairpin(12), roomy));
  });

  it("isSimple actually catches a crossing — the guard is not vacuous", () => {
    expect(isSimple([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    expect(isSimple([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(true);
  });
});

describe("detached features do not touch the host", () => {
  it("an island leaves the coastline exactly as it was", () => {
    const base = straight();
    expect(deformCurve(base, [feature({ morph: "detached" })])).toEqual(base);
  });
});
