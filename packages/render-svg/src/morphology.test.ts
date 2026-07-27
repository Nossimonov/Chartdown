/**
 * Placed morphology geometry (#93, ADR 0023).
 *
 * The properties asserted here are the ones the ADR promises an author, not
 * incidental facts about the implementation: a feature is a pure function of
 * its own data, it disturbs only its own stretch of the host, and the host
 * never crosses itself no matter what it is asked for.
 */
import { describe, expect, it } from "vitest";
import { deformCurve, isSimple, isSmooth, resample, spacingFor, type PlacedFeature } from "./morphology";
import { formatPoints, frameShape, parsePoints } from "@chartdown/core";
import { renderSource } from "./index";
import type { XY } from "./util";

/**
 * A straight west-to-east coast, already at the uniform spacing `deformCurve`
 * imposes (#155) — so a test may compare its output to this baseline by index.
 * Deforming with NO features is exactly that resampling and nothing else.
 */
const rawStraight = (n = 81, len = 400): XY[] =>
  Array.from({ length: n }, (_, i) => ({ x: (i / (n - 1)) * len, y: 100 }));
/** The baseline at the spacing THESE features will cause, so indices line up. */
const straightFor = (feats: PlacedFeature[], n = 81, len = 400): XY[] =>
  resample(rawStraight(n, len), spacingFor(feats));
const straight = (n = 81, len = 400): XY[] => straightFor([], n, len);

const feature = (over: Partial<PlacedFeature> = {}): PlacedFeature => ({
  morph: "jut", anchor: { x: 200, y: 100 }, size: 60, ...over,
});

const maxOffset = (a: XY[], b: XY[]): number =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));

describe("a placed feature deforms its host", () => {
  it("moves the curve at the anchor and leaves it simple", () => {
    const base = straightFor([feature()]);
    const out = deformCurve(base, [feature()]);
    expect(maxOffset(base, out)).toBeGreaterThan(1);
    expect(isSimple(out)).toBe(true);
  });

  it("a bite goes the opposite way from a jut of the same size", () => {
    const base = straightFor([feature()]);
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
    //
    // Asserted by POSITION, not by index. A feature now splices its own
    // outline into the host (#163), so the two curves no longer share a vertex
    // count — and index-matching was always testing the sampling rather than
    // the guarantee, which is why it had to be re-pinned every time the
    // sampling moved.
    const base = straightFor([feature()]);
    const out = deformCurve(base, [feature({ anchor: { x: 200, y: 100 }, size: 60 })]);
    // size=60 on a straight coast: the window is x ∈ [170, 230]. Everything
    // outside it must still lie exactly on the undisturbed line y = 100.
    expect(out.filter((p) => Math.abs(p.x - 200) > 30.001).every((p) => p.y === 100)).toBe(true);
    expect(out.some((p) => Math.abs(p.x - 200) < 30 && p.y !== 100)).toBe(true);
  });

  it("meets the undisturbed curve smoothly rather than with a crease", () => {
    // A raised cosine has zero slope at both window edges. Sample the step
    // between adjacent vertices: the largest one near the seam must not exceed
    // the largest one at the crest, or there is a corner where the bump lands.
    const base = straightFor([feature()]);
    const out = deformCurve(base, [feature()]);
    const steps = out.slice(1).map((p, i) => Math.abs(p.y - out[i]!.y));
    const crest = Math.max(...steps.slice(35, 45));
    const seam = Math.max(steps[29]!, steps[30]!, steps[50]!, steps[51]!);
    expect(seam).toBeLessThanOrEqual(crest);
  });
});

describe("a feature is a pure function of its own data (ADR 0023)", () => {
  it("is deterministic — no seed, no ordinal, no document order", () => {
    const base = straightFor([feature()]);
    expect(deformCurve(base, [feature()])).toEqual(deformCurve(base, [feature()]));
  });

  it("PROMOTION IS GEOMETRY-STABLE: identity is not an input", () => {
    // `island : near coast …` and `island himling "Himling" : near coast …`
    // must render identically. Nothing in the geometry can see a name, which
    // is the structural guarantee behind the spec's promise — naming adds a
    // story, not a shape.
    const base = straightFor([feature()]);
    const anonymous = deformCurve(base, [feature()]);
    const named = deformCurve(base, [feature()]);
    expect(named).toEqual(anonymous);
  });

  it("moving one feature does not move another", () => {
    const base = straightFor([feature()]);
    const a = feature({ anchor: { x: 100, y: 100 }, size: 40 });
    const b = feature({ anchor: { x: 300, y: 100 }, size: 40 });
    const both = deformCurve(base, [a, b]);
    const movedB = deformCurve(base, [a, { ...b, anchor: { x: 320, y: 100 } }]);
    // Indexed off `both`, not `base`: spacing adapts to the smallest feature
    // (#161), so a curve carrying features is sampled differently from a bare
    // one. The two outputs share a spacing, which is what makes them comparable.
    const nearA = (i: number): boolean => Math.abs(both[i]!.x - 100) < 21;
    expect(both.filter((_, i) => nearA(i))).toEqual(movedB.filter((_, i) => nearA(i)));
  });
});

describe("the simplicity guarantee is hard (ADR 0023)", () => {
  /** Two nearly-touching arms: a jut on the near one has nowhere to go. */
  const hairpin = (gap: number): XY[] => {
    const p: XY[] = [];
    for (let i = 0; i <= 40; i++) p.push({ x: i * 5, y: 100 });
    for (let i = 1; i <= 40; i++) p.push({ x: 200 - i * 5, y: 100 + gap });
    return deformCurve(p, []); // the uniform-spacing baseline, as above
  };

  it("REFUSES a feature it cannot draw as declared, rather than shrinking it", () => {
    // A clamp was written first and rejected on the owner's argument: it
    // deliberately discards map data, and it makes `size=` a lie — the same
    // 90mi cape would come out different lengths on different stretches of
    // coast, so the number in the document would stop determining the map.
    const base = hairpin(12);
    expect(isSimple(base)).toBe(true); // the fixture starts valid
    const rejected: string[] = [];
    const out = deformCurve(base, [feature({ anchor: { x: 100, y: 100 }, size: 120 })], () => rejected.push("x"));
    expect(rejected).toHaveLength(1);
    // Compared against the SAME no-feature pass, so this isolates the
    // feature's effect from resampling (which is not perfectly idempotent on
    // a curve — about 0.17px on this hairpin).
    expect(maxOffset(deformCurve(base, []), out)).toBeLessThan(1e-9);
  });

  it("draws at the declared size when it fits — no silent shrinking anywhere", () => {
    const base = straightFor([feature()]);
    const rejected: string[] = [];
    const out = deformCurve(base, [feature({ size: 60 })], () => rejected.push("x"));
    expect(rejected).toHaveLength(0);
    // The DEPTH is `size × reach` exactly, and the MOUTH is `size` exactly.
    // Both measured off the undisturbed line rather than vertex-by-vertex:
    // what an author is promised is the shape's dimensions, not a vertex count.
    expect(Math.max(...out.map((p) => Math.abs(p.y - 100)))).toBeCloseTo(60 * 0.55, 6);
    // The outline meets the coast TANGENTIALLY at each end, so its outermost
    // vertices carry exactly zero displacement and drop out of `moved`; the
    // first one that survives sits a fraction of the fillet inside the window.
    // The mouth is 60 by construction — what is checked here is that it is not
    // quietly narrower.
    const moved = out.filter((p) => p.y !== 100);
    const span = Math.max(...moved.map((p) => p.x)) - Math.min(...moved.map((p) => p.x));
    expect(span).toBeLessThanOrEqual(60);
    expect(span).toBeGreaterThan(58);
  });

  it("isSimple actually catches a crossing — the guard is not vacuous", () => {
    expect(isSimple([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    expect(isSimple([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(true);
  });
});

describe("detached features do not touch the host", () => {
  it("an island leaves the coastline exactly as it was", () => {
    // A detached feature contributes nothing to the spacing either, so the
    // baseline is the featureless one.
    const base = straight();
    expect(deformCurve(base, [feature({ morph: "detached" })])).toEqual(base);
  });
});

describe("direction comes from the map, not from the drawing order (#93)", () => {
  // `straight()` runs west-to-east, so its normal is VERTICAL and the water
  // must lie north or south of it. The first draft of these tests put the sea
  // to the east — perpendicular to the normal, displacing nothing — which is a
  // reminder that the seaward vector is only meaningful across the line.
  const north: XY = { x: 0, y: -1 };
  /** The anchor's index, found by POSITION — the curve is resampled, so a
   *  hardcoded index no longer points at the feature (#155). */
  const anchorIndex = (pts: XY[]): number => {
    let best = 0;
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i]!.x - 200) < Math.abs(pts[best]!.x - 200)) best = i;
    }
    return best;
  };

  it("a jut goes toward the water and a bite away from it", () => {
    const base = straightFor([feature()]);
    const cape = deformCurve(base, [feature({ morph: "jut", seaward: north })]);
    const bay = deformCurve(base, [feature({ morph: "bite", seaward: north })]);
    const at = anchorIndex(base);
    expect(cape[at]!.y).toBeLessThan(base[at]!.y); // north is -y
    expect(bay[at]!.y).toBeGreaterThan(base[at]!.y);
  });

  it("REVERSING the coastline does not turn headlands into harbours", () => {
    // The property that rules out a winding convention. `sea : west of coast`
    // says which side the water is on; whether the author drew the coast
    // north-to-south or south-to-north is not the map's business. Without
    // this, editing a `from`/`to` would silently invert every feature on it.
    const base = straightFor([feature()]);
    const at = anchorIndex(base);
    const drawn = deformCurve(base, [feature({ morph: "jut", seaward: north })]);
    const reversed = deformCurve([...base].reverse(), [feature({ morph: "jut", seaward: north })]);
    expect(drawn[at]!.y).toBeLessThan(base[at]!.y);
    expect(reversed[reversed.length - 1 - at]!.y).toBeLessThan(base[at]!.y);
    // And to the same extent — not merely the same side.
    expect(reversed[reversed.length - 1 - at]!.y).toBeCloseTo(drawn[at]!.y, 6);
  });

  it("without a declared water side the shape is still drawn, deterministically", () => {
    // Warned about at the call site rather than silently skipped: a missing
    // declaration should cost a diagnostic, not a feature.
    const base = straightFor([feature()]);
    const out = deformCurve(base, [feature()]);
    expect(maxOffset(base, out)).toBeGreaterThan(1);
    expect(out).toEqual(deformCurve(base, [feature()]));
  });
});

describe("wired end to end into a region render (#93)", () => {
  const MAP = (bay: string): string =>
    `# Coast\nmap: region\nextent: 900x600mi\n\n[water]\n` +
    `coastline coast : from (210,0) via (150,130) (200,300) (120,390) (170,520) to (140,600)\n` +
    `sea "The Sea" : west of coast\n${bay}\n`;

  const coastOf = (src: string): XY[] => {
    const m = /id="cd-coast-coast"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg);
    if (!m) throw new Error("coast polyline not found in render");
    return m[1]!.trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(",").map(Number) as [number, number];
      return { x, y };
    });
  };

  /**
   * Where the coast sits at the anchor's latitude, on each curve. A course
   * carrying features is sampled far more finely than a bare one, so comparing
   * vertex i to vertex i compares unrelated places — and taking a global
   * extremum picks up the ends rather than the bump.
   */
  const xAt = (pts: XY[], y: number): number => {
    let best = Infinity;
    let x = 0;
    for (const p of pts) {
      if (Math.abs(p.y - y) < best) { best = Math.abs(p.y - y); x = p.x; }
    }
    return x;
  };
  const ANCHOR_Y = 390 * (820 / 900); // (120,390) in map units, scaled to canvas

  it("a bay bites LANDWARD, taking its direction from 'sea : west of coast'", () => {
    const plain = coastOf(MAP(""));
    const bitten = coastOf(MAP(`bay "Gull Bay" : on coast at (120,390) size=90mi`));
    const dx = xAt(bitten, ANCHOR_Y) - xAt(plain, ANCHOR_Y);
    // Sea to the WEST means landward is +x. Getting this backwards would turn
    // every harbour on the map into a headland. This anchor sits on a sharp
    // corner, which an earlier per-vertex-normal model could not bite into at
    // all — it is exactly the case worth pinning.
    expect(dx).toBeGreaterThan(5);
    expect(renderSource(MAP(`bay "Gull Bay" : on coast at (120,390) size=90mi`)).diagnostics
      .filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a cape on the same spot juts the other way", () => {
    const plain = coastOf(MAP(""));
    const jutted = coastOf(MAP(`cape "The Ness" : on coast at (120,390) size=90mi`));
    const dx = xAt(jutted, ANCHOR_Y) - xAt(plain, ANCHOR_Y);
    // The claim is the SIDE, not the size — how much survives depends on
    // how much room the corner leaves, which the clamp decides.
    expect(dx).toBeLessThan(0);
  });

  it("works for a coast written as a `path` shape too, not just `from`/`to`", () => {
    // The two spellings are handled in different branches of the resolver, and
    // wiring only one of them made every feature on a from/to coast silently
    // do nothing — which is how Vessany's Gull Bay drew a bay that wasn't there.
    const asPath = (bay: string): string =>
      `# Coast\nmap: region\nextent: 900x600mi\n\n[water]\n` +
      `coastline coast : path (210,0) (150,130) (200,300) (120,390) (170,520) (140,600)\n` +
      `sea "The Sea" : west of coast\n${bay}\n`;
    const plain = coastOf(asPath(""));
    const bitten = coastOf(asPath(`bay : on coast at (120,390) size=90mi`));
    expect(plain.some((p, i) => Math.abs(p.x - bitten[i]!.x) > 5)).toBe(true);
  });

  it("says so when nothing declares which side the water is on", () => {
    const src = `# Coast\nmap: region\nextent: 900x600mi\n\n[water]\ncoastline coast : path (210,0) (150,300) (140,600)\nbay : on coast at (150,300) size=90mi\n`;
    expect(renderSource(src).diagnostics.map((d) => d.message).join()).toMatch(/nothing on this map says which side of 'coast' the water is on/);
  });

  it("says so when a placed feature has no extent", () => {
    const src = MAP(`bay "Gull Bay" : on coast at (120,390)`);
    expect(renderSource(src).diagnostics.map((d) => d.message).join()).toMatch(/has no size=/);
  });
});

describe("detached features draw a shape beside the host (#93)", () => {
  const ISLE = (line: string): string =>
    `# Coast\nmap: region\nextent: 900x600mi\n\n[water]\n` +
    `coastline coast : path (210,0) (150,300) (140,600)\nsea "The Sea" : west of coast\n${line}\n`;

  it("an island renders a polygon rather than parsing clean and drawing nothing", () => {
    const svg = renderSource(ISLE(`island : near coast at (95,250) size=40mi`)).svg;
    const plain = renderSource(ISLE("")).svg;
    expect(svg.length).toBeGreaterThan(plain.length);
    expect(svg).toMatch(/<polygon/);
  });

  it("PROMOTION IS GEOMETRY-STABLE: naming the island does not reshape it", () => {
    // The reason its outline is keyed on the placed data rather than on its id
    // the way an ordinary blob is. An id-keyed outline would change shape at
    // the exact moment a campaign named the island, which ADR 0023 forbids.
    const anonymous = renderSource(ISLE(`island : near coast at (95,250) size=40mi`)).svg;
    const named = renderSource(ISLE(`island himling "Himling" : near coast at (95,250) size=40mi`)).svg;
    const poly = (s: string): string => /points="([^"]+)"[^>]*\/>(?![\s\S]*<polyline)/.exec(s)?.[1] ?? "";
    const shapeOf = (s: string): string[] => [...s.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1]!);
    expect(shapeOf(named)).toEqual(shapeOf(anonymous));
    expect(poly(named)).toBe(poly(anonymous));
  });

  it("says so when a detached feature has no extent", () => {
    expect(renderSource(ISLE(`island : near coast at (95,250)`)).diagnostics.map((d) => d.message).join())
      .toMatch(/has no size=/);
  });

  it("leaves the coastline itself untouched", () => {
    const coast = (s: string): string => /id="cd-coast-coast"[^>]*>.*?points="([^"]+)"/s.exec(s)?.[1] ?? "";
    expect(coast(renderSource(ISLE(`island : near coast at (95,250) size=40mi`)).svg))
      .toBe(coast(renderSource(ISLE("")).svg));
  });
});

describe("simplicity is not enough — a curve can fold without crossing (#93)", () => {
  it("isSmooth catches a cusp that isSimple happily passes", () => {
    // The exact failure the owner spotted by eye on Gull Bay: the coast came
    // to a point and turned back, never intersecting itself, so the
    // self-intersection guard reported it fine while the map showed a spike.
    const cusp = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 1 }, { x: 0, y: 2 }];
    expect(isSimple(cusp)).toBe(true);
    expect(isSmooth(cusp)).toBe(false);
  });

  it("passes an ordinary gently-curving coast", () => {
    const arc = Array.from({ length: 60 }, (_, i) => ({ x: i * 5, y: 40 * Math.sin(i / 12) }));
    expect(isSmooth(arc)).toBe(true);
  });

  it("the clamp now respects it: a bite into a tight corner stays smooth", () => {
    // A concave corner is where offsetting along the normals folds first.
    const raw: XY[] = [];
    for (let i = 0; i <= 60; i++) raw.push({ x: i * 2, y: 100 - i * 1.6 });
    for (let i = 1; i <= 60; i++) raw.push({ x: 120 + i * 2, y: 4 + i * 1.6 });
    const corner = deformCurve(raw, []);
    const out = deformCurve(corner, [feature({ morph: "bite", anchor: { x: 120, y: 4 }, size: 90 })]);
    expect(isSimple(out)).toBe(true);
    expect(isSmooth(out)).toBe(true);
  });
});

describe("a word carries its own proportions (#93)", () => {
  const MAP = (line: string): string =>
    `# Sound\nmap: region\nextent: 400x800mi\n\n[water]\n` +
    `coastline coast : from (200,0) via (210,200) (205,400) (215,600) to (200,800)\n` +
    `sea "The Sound" : west of coast\n${line}\n`;
  const reachOf = (word: string): number => {
    const pts = (s: string): number => {
      const m = /id="cd-sound-coast"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(s).svg)!;
      return Math.max(...m[1]!.trim().split(/\s+/).map((p) => Number(p.split(",")[0])));
    };
    return pts(MAP(`${word} : on coast at (210,200) size=60mi`)) - pts(MAP(""));
  };

  it("a fjord is deeper than a sound, which is deeper than a cove — at the SAME size", () => {
    // Without `reach=` these three drew the identical shape and differed only
    // in colour, which is useless on a coast whose character is that one inlet
    // is long and narrow while another is a shallow scoop.
    expect(reachOf("cove")).toBeLessThan(reachOf("sound"));
    expect(reachOf("sound")).toBeLessThan(reachOf("fjord"));
  });

  it("derivation carries it: fjord inherits from sound and deepens it", () => {
    expect(reachOf("fjord")).toBeGreaterThan(0);
    expect(reachOf("headland")).toBeCloseTo(reachOf("cape") as number, 0);
  });

  it("several features on one coast all draw, with no errors", () => {
    const many = renderSource(MAP(
      `cape : on coast at (210,120) size=50mi\nfjord : on coast at (205,300) size=90mi\n` +
      `cove : on coast at (215,520) size=40mi\nisland : near coast at (150,250) size=30mi`,
    ));
    expect(many.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("an island is LAND, even declared among the water (#93)", () => {
  const SRC = `# Isles\nmap: region\nextent: 400x400mi\n\n[water]\n` +
    `coastline coast : from (300,0) via (290,200) to (300,400)\n` +
    `sea "The Sound" : west of coast\n` +
    `island vashon "Vashon" : near coast at (150,150) size=60mi\n`;

  const fillsOf = (svg: string, id: string): string[] => {
    const m = new RegExp(`id="cd-isles-${id}">(.{0,4000}?)</g>`, "s").exec(svg);
    return m ? [...m[1]!.matchAll(/fill="([^"]+)"/g)].map((x) => x[1]!) : [];
  };

  it("does not take the sea's fill just because it sits in [water]", () => {
    // Spec 05 §2 says an island rises ABOVE the sea that surrounds it, but the
    // water branch painted by SECTION rather than by word — so every island on
    // a coastline map came out invisible against the sound. Unreachable until
    // #93 made `island` a placeable standard-library word.
    const svg = renderSource(SRC).svg;
    const sea = renderSource(SRC).svg.match(/fill="#b9d3e6"/g) ?? [];
    expect(fillsOf(svg, "vashon")).not.toContain("#b9d3e6");
    expect(sea.length).toBe(1); // the sea itself, and nothing else
  });

  it("gets the land surface and a coastline stroke, like a continent", () => {
    const m = /id="cd-isles-vashon">(.{0,4000}?)<\/g>/s.exec(renderSource(SRC).svg);
    expect(m![1]).toMatch(/stroke="#8fa8b8"/); // the coastline stroke
  });
});

describe("Wave 5 regressions (#153–#156)", () => {
  const doc = (body: string): string =>
    `map: region\nextent: 600x1200mi\n\n[water]\n${body}\n`;
  const errorsOf = (src: string): string[] =>
    renderSource(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  const warningsOf = (src: string): string[] =>
    renderSource(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  const COAST = `coastline shore : from (300,0) via (300,600) to (300,1200)\nsea "W" : west of shore\n`;

  it("#153 reach= on the ENTITY line wins over the vocabulary word's value", () => {
    // The spec promised a per-entity override and the code read only the
    // vocabulary, so every reach= on an entity was silently ignored.
    const shallow = doc(`${COAST}bay a : on shore at (300,600) size=50mi reach=0.2`);
    const deep = doc(`${COAST}bay a : on shore at (300,600) size=50mi reach=3`);
    const spanOf = (src: string): number => {
      const m = /id="cd-document-shore"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)!;
      const xs = m[1]!.trim().split(/\s+/).map((p) => Number(p.split(",")[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spanOf(deep)).toBeGreaterThan(spanOf(shallow) * 2);
  });

  it("#153 a bad reach= on an entity line is validated, as it is on a vocab line", () => {
    expect(warningsOf(doc(`${COAST}bay a : on shore at (300,600) size=50mi reach=banana`)).join())
      .toMatch(/'reach=banana' is not a number/);
  });

  it("#154 a from…to course with NO via points still draws its features", () => {
    // Two controls spline to two points, so the window covered the whole coast
    // and each feature displaced an endpoint instead of drawing anything —
    // silently, with a plausible-looking map. This is the shortest document
    // anyone writes to try the feature out.
    const src = `map: region\nextent: 300x400mi\n\n[water]\n` +
      `coastline coast : from (150,0) to (150,400)\nsea "W" : west of coast\n` +
      `cape "A cape" : on coast at (150,100) size=60mi\nbay "A bay" : on coast at (150,300) size=60mi\n`;
    const m = /id="cd-document-coast"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)!;
    const pts = m[1]!.trim().split(/\s+/);
    expect(pts.length).toBeGreaterThan(100); // not the two-point degenerate curve
    const xs = pts.map((p) => Number(p.split(",")[0]));
    // Both features present: the coast reaches west of its line AND east of it.
    const line = xs[0]!;
    expect(Math.min(...xs)).toBeLessThan(line - 10);
    expect(Math.max(...xs)).toBeGreaterThan(line + 10);
  });

  it("#155 whether a feature fits does NOT depend on how many via points were typed", () => {
    // Collinear via points change nothing about the line. They used to double
    // the deepest drawable feature each time they doubled, because the fold
    // check read per-vertex turn on the rendered polyline.
    const straightCoast = (nvia: number): string => {
      const via = Array.from({ length: nvia }, (_, i) => `(300,${Math.round((1200 * (i + 1)) / (nvia + 1))})`).join(" ");
      return doc(
        `coastline shore : from (300,0) ${via ? `via ${via} ` : ""}to (300,1200)\n` +
        `sea "W" : west of shore\nbay a : on shore at (300,600) size=50mi reach=6\n`,
      );
    };
    for (const n of [0, 1, 3, 7, 15]) {
      expect(errorsOf(straightCoast(n)), `${n} via points`).toEqual([]);
    }
  });

  it("#156 the refusal quotes the size as written, names the entity, and matches the shape", () => {
    // A big jut into the mouth of a hairpin: the tongue has to cross the far
    // arm of the coast, which is a genuine fold. The earlier fixture — a huge
    // reach off a zigzag — no longer refuses, and that is correct: under the
    // outline model (#163) a long narrow tongue does not fold, it is merely
    // absurd to look at, and the check is about geometry rather than taste.
    const src = doc(
      `coastline shore : from (100,300) via (500,300) (500,340) to (100,340)
` +
      `sea "W" : south of shore
` +
      `spit dungeness "Dungeness Spit" : on shore at (300,300) size=300.5mi reach=3`,
    );
    const msg = errorsOf(src).join();
    expect(msg).toMatch(/size=300\.5mi/);        // not rounded, unit kept
    expect(msg).toMatch(/'Dungeness Spit' \(spit\)/); // the entity, not just the word
    expect(msg).toMatch(/a jut that long/);      // not "a bite that deep"
    expect(msg).not.toMatch(/a bite that deep/);
  });

  it("#163 a refusal names ITS OWN cause: off the end of the host, not a fold", () => {
    // Reporting this as a fold would send an author to shrink a feature whose
    // size is fine — it is in the wrong place, and only the message can say so.
    const msg = errorsOf(doc(`${COAST}cape a "A Cape" : on shore at (300,20) size=300.5mi`)).join();
    expect(msg).toMatch(/half of its mouth would lie off the end of 'shore'/);
    expect(msg).not.toMatch(/fold/);
  });

  it("#163 two features may not claim the same stretch, and the report names both", () => {
    // Composing them is what put a corner between two inlets that are each
    // perfectly drawable alone. Refused and named, so the author decides.
    const msg = errorsOf(doc(
      `${COAST}bay one "First Bay" : on shore at (300,600) size=200mi\n` +
      `bay two "Second Bay" : on shore at (300,640) size=200mi`,
    )).join();
    expect(msg).toMatch(/'Second Bay' \(bay\)/);
    expect(msg).toMatch(/claims the same stretch of 'shore' as 'First Bay' \(bay\)/);
    // The FIRST one still draws — one bad declaration does not cost its neighbour.
    expect(msg).not.toMatch(/'First Bay' \(bay\) cannot/);
  });

  it("#163 an inlet is a smooth curve at every taper, not a polygon", () => {
    // The defect this model replaced: depth as a function of position along the
    // coast is a GRAPH, and a graph cannot have parallel sides — reaching a
    // fjord's depth within its mouth forced a radius of curvature of 0.013
    // units, so every inlet drew with 60-90 degree corners. The done-state #163
    // asks for is 20 degrees at the densities the renderer itself chooses.
    for (const taper of [1, 0.6, 0.4, 0.2, 0.15]) {
      const src = doc(`${COAST}sound s "An Inlet" : on shore at (300,600) size=20mi reach=3 taper=${taper}`);
      expect(errorsOf(src), `taper=${taper}`).toEqual([]);
      const m = /id="cd-document-shore"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)!;
      const pts = m[1]!.trim().split(/\s+/).map((p) => {
        const [x, y] = p.split(",").map(Number) as [number, number];
        return { x, y };
      });
      let worst = 0;
      for (let i = 1; i + 1 < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
        let t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
        if (t > Math.PI) t = 2 * Math.PI - t;
        worst = Math.max(worst, (t * 180) / Math.PI);
      }
      expect(worst, `taper=${taper} turned ${worst.toFixed(1)}°`).toBeLessThan(20);
    }
  });
});

describe("a detached feature has two dials as well (#159)", () => {
  const MAP = (line: string): string =>
    `# Isles\nmap: region\nextent: 120x240mi\n\n[water]\n` +
    `coastline shore : from (75,0) via (72,80) (74,160) to (75,240)\n` +
    `sea "The Sound" : west of shore\n${line}\n`;

  const bbox = (src: string, id: string): { w: number; h: number } => {
    const g = new RegExp(`id="cd-isles-${id}">(.{0,9000}?)</g>`, "s").exec(renderSource(src).svg)!;
    const pts = /points="([^"]+)"/.exec(g[1]!)![1]!.trim().split(/\s+/)
      .map((p) => p.split(",").map(Number) as [number, number]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  it("reach= elongates it — Whidbey is 40mi long and a few wide, not a 40mi circle", () => {
    const b = bbox(MAP(`island whidbey "W" : near shore at (55,60) size=40mi reach=0.15`), "whidbey");
    expect(b.h / b.w).toBeGreaterThan(4);
  });

  it("the long axis follows the HOST — a shore-parallel island, as every long one in a sound is", () => {
    // The shore here runs north-south, so an elongated island must be taller
    // than it is wide. Inferred rather than declared, the way direction is.
    const b = bbox(MAP(`island whidbey "W" : near shore at (55,60) size=40mi reach=0.15`), "whidbey");
    expect(b.h).toBeGreaterThan(b.w);
  });

  it("reach=1 and an absent reach= are identical, so no existing render moves", () => {
    const absent = bbox(MAP(`island a "A" : near shore at (55,60) size=40mi`), "a");
    const one = bbox(MAP(`island a "A" : near shore at (55,60) size=40mi reach=1`), "a");
    expect(one).toEqual(absent);
    expect(absent.w / absent.h).toBeCloseTo(1, 1); // round
  });

  it("derivation carries it: `skerry : island reach=0.2` inherits the shape", () => {
    const src = `# Isles\nmap: region\nextent: 120x240mi\n\n[vocab]\nskerry : island reach=0.2\n\n[water]\n` +
      `coastline shore : from (75,0) via (72,80) (74,160) to (75,240)\nsea "S" : west of shore\n` +
      `skerry s "S1" : near shore at (55,60) size=40mi\n`;
    const b = bbox(src, "s");
    expect(b.h / b.w).toBeGreaterThan(3);
  });

  it("stays a pure function of its data — naming it does not reshape it (ADR 0023)", () => {
    const anon = bbox(MAP(`island a : near shore at (55,60) size=40mi reach=0.15`), "a");
    const named = bbox(MAP(`island a "Whidbey Island" : near shore at (55,60) size=40mi reach=0.15`), "a");
    expect(named).toEqual(anon);
  });
});

describe("an island with no water around it is reported (#164)", () => {
  // The issue's own reproduction. Nine of the Puget Sound exercise map's
  // fifteen islands were drawn on dry land and `check` said nothing — a
  // stroked contour on open grass with a place-name beside it, which at
  // full-map zoom reads as a faint mark rather than as a mistake.
  const SRC = `map: region
extent: 300x300mi

[water]
coastline coast : from (150,0) via (150,100) (150,200) to (150,300)
sea "The Sea" : west of coast
island good "In the sea" : near coast at (90,60) size=30mi reach=0.6
island half "A narrow channel" : near coast at (138,150) size=30mi reach=0.6
island inland "Forty miles inland" : near coast at (210,240) size=30mi reach=0.6
`;
  const warningsOf = (src: string): string[] =>
    renderSource(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  it("names the island that is on land", () => {
    const msg = warningsOf(SRC).join();
    expect(msg).toMatch(/'Forty miles inland' is an island with no water around it/);
    expect(msg).toMatch(/spec 05 §2/);
  });

  it("says nothing about the island that is in the sea", () => {
    expect(warningsOf(SRC).join()).not.toMatch(/'In the sea'/);
  });

  it("says nothing about one separated by a NARROW channel — that is #165, not a mistake", () => {
    // Bainbridge really is separated from the Kitsap Peninsula by half a mile
    // of water, which at map scale is thinner than the coastline stroke. The
    // right rendering is one merged landmass, not a warning.
    //
    // The fixture used to sit the island ON the coast, overlapping it by
    // fifteen miles, which is not what that sentence describes — a sub-scale
    // GAP is still a gap, and it is the gap that makes this legitimate. An
    // island genuinely overlapping its shore is #180's case and is now
    // reported, so this asserts what the comment always meant.
    expect(warningsOf(SRC).join()).not.toMatch(/'A narrow channel'/);
  });

  it("is a WARNING — the map still renders", () => {
    expect(renderSource(SRC).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(renderSource(SRC).svg).toContain("Forty miles inland");
  });

  it("stays quiet on a map that declares no water at all", () => {
    // Nothing on such a map says where the sea is, so there is no fact to
    // report — inventing one would warn on every island of every map that
    // does not model its water.
    const dry = `map: region\nextent: 300x300mi\n\n[water]\n` +
      `coastline coast : from (150,0) via (150,150) to (150,300)\n` +
      `island a "Alone" : near coast at (90,60) size=30mi\n`;
    expect(warningsOf(dry).join()).not.toMatch(/no water around it/);
  });
});

describe("an arm may hang off an arm (#170)", () => {
  // Every secondary arm of Puget Sound hangs off a primary one — Dabob and
  // Quilcene off Hood Canal, Dyes off Sinclair, Oakland off Hammersley. All of
  // them drew NOTHING AT ALL: a bite is spliced into its host's course, and a
  // bite is not a course, so nothing ever asked for them.
  const COAST = `# P
map: region
extent: 80x160mi

[water]
` +
    `coastline shore : from (40,0) via (38,60) (39,110) to (40,160)
sea "S" : west of shore
`;
  const HOOD = `fjord hood "Hood Canal" : on shore at (38,50) size=3mi reach=9 taper=0.2
`;
  const DABOB = `sound dabob "Dabob Bay" : on hood at (56,44) size=2mi reach=4 taper=0.3
`;
  const coastOf = (src: string): { x: number; y: number }[] =>
    /id="cd-p-shore"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)![1]!
      .trim().split(/\s+/).map((q) => {
        const [x, y] = q.split(",").map(Number) as [number, number];
        return { x, y };
      });

  it("the arm CHANGES THE MAP — it used to leave the coast byte-identical", () => {
    const without = coastOf(COAST + HOOD);
    const with_ = coastOf(COAST + HOOD + DABOB);
    expect(with_.length).toBeGreaterThan(without.length + 100);
  });

  it("says nothing — the water side comes from the canal, not from the map", () => {
    // `sea : west of hood` is not a sentence about Hood Canal, so the old
    // warning suggested a fix that could not be written. The arm's water IS
    // the canal, so its side is the direction to the canal's own centerline.
    expect(renderSource(COAST + HOOD + DABOB).diagnostics).toEqual([]);
  });

  it("works whichever order the two are declared in", () => {
    // Resolved after the whole pre-scan, so a bay declared above the canal it
    // hangs off is not a different document.
    expect(coastOf(COAST + DABOB + HOOD).length).toBe(coastOf(COAST + HOOD + DABOB).length);
  });

  it("the arm reaches ACROSS the canal's line, not along it", () => {
    // Dabob hangs off the canal's north flank; the canal runs east. An arm
    // that inherited the canal's own seaward would run east too, and vanish
    // into it.
    const with_ = coastOf(COAST + HOOD + DABOB);
    const without = coastOf(COAST + HOOD);
    const northOf = (pts: { x: number; y: number }[]): number => Math.min(...pts.filter((p) => p.x > 500).map((p) => p.y));
    expect(northOf(with_)).toBeLessThan(northOf(without) - 20);
  });
});

describe("a placed feature is named on its body (#171)", () => {
  // The anchor is a point on the HOST shoreline, so labelling there put a
  // 40mi canal's name on the coast with forty miles of canal unnamed below
  // it, and piled four South Sound inlets' names into a six-mile square while
  // the water they name lay thirty miles apart and unlabelled. Spec 07 §5
  // already names an area-shaped feature in its body.
  const SRC = `# P
map: region
extent: 100x200mi

[water]
coastline shore : from (50,0) via (48,80) (49,140) to (50,200)
sea "S" : west of shore
sound a "Alpha Inlet" : on shore at (48,70) size=6mi reach=4 taper=0.3
sound b "Beta Inlet" : on shore at (48,90) size=6mi reach=4 taper=0.3
fjord c "Gamma Canal" : on shore at (49,130) via (72,138) (86,160) size=4mi taper=0.2
`;
  const SC = 820 / 100;
  const labelAt = (name: string): { x: number; y: number } => {
    const tag = new RegExp(`<text([^>]*)>${name}<`).exec(renderSource(SRC).svg)!;
    return {
      x: Number(/x="([\d.-]+)"/.exec(tag[1]!)![1]) / SC,
      y: Number(/y="([\d.-]+)"/.exec(tag[1]!)![1]) / SC,
    };
  };

  it("sits at the middle of the feature, not at its mouth on the shore", () => {
    // The coast is at x=48..50; this inlet is 6mi wide and reaches 24mi east,
    // so its middle is at x=60 and its mouth is not.
    expect(labelAt("Alpha Inlet").x).toBeCloseTo(60, 0);
  });

  it("follows a DECLARED centerline to its midpoint, not a straight guess", () => {
    // Gamma runs (49,130) -> (72,138) -> (86,160): halfway along that line by
    // arc length, which a depth-along-the-normal estimate would miss entirely.
    const p = labelAt("Gamma Canal");
    expect(p.x).toBeGreaterThan(65);
    expect(p.y).toBeGreaterThan(135);
  });

  it("two inlets on one stretch of coast are named where they actually are", () => {
    // They were crowded because they were placed at the same point, which
    // defeats 07 §5's shrink-and-leader machinery rather than exercising it.
    expect(Math.abs(labelAt("Alpha Inlet").y - labelAt("Beta Inlet").y)).toBeGreaterThan(15);
  });
});

describe("a detached feature may carry its own outline (#172, ADR 0026)", () => {
  // Three numbers produce a lozenge. That is right for the anonymous mid-river
  // islet ADR 0023 is written around, and wrong for Whidbey Island, which
  // doglegs at Coupeville — and a landform a reader recognises is exactly what
  // a campaign attaches itself to, which is the ADR's own test for what must
  // be declared data.
  const MAP = (body: string): string => `# Whid
map: region
extent: 100x200mi

[water]
coastline shore : from (72,0) via (70,80) (71,140) to (72,200)
sea "S" : west of shore
${body}`;
  const WHIDBEY = `area (-2,-40) (3,-30) (1,-20) (6,-8) (5,4) (10,18) (7,32) (2,26) (-1,10) (-5,-6) (-6,-24)`;
  const poly = (src: string): { x: number; y: number }[] => {
    const g = /id="cd-whid-w">(.{0,40000}?)<\/g>/s.exec(renderSource(src).svg);
    const m = g && /points="([^"]+)"/.exec(g[1]!);
    return m ? m[1]!.trim().split(/\s+/).map((q) => {
      const [x, y] = q.split(",").map(Number) as [number, number];
      return { x, y };
    }) : [];
  };
  const form = (src: string): string => {
    const p = poly(src);
    const cx = p.reduce((s, q) => s + q.x, 0) / p.length;
    const cy = p.reduce((s, q) => s + q.y, 0) / p.length;
    return p.map((q) => `${(q.x - cx).toFixed(2)},${(q.y - cy).toFixed(2)}`).join(" ");
  };
  const diags = (src: string): string[] => renderSource(src).diagnostics.map((d) => `${d.severity}: ${d.message}`);

  it("the outline is DRAWN, not silently discarded", () => {
    // Supplied alongside the dials it used to render byte-identically to the
    // declaration without it: accepted and thrown away.
    const shaped = poly(MAP(`island w "Whidbey" : near shore at (40,100) ${WHIDBEY}\n`));
    const lozenge = poly(MAP(`island w "Whidbey" : near shore at (40,100) size=80mi reach=0.18\n`));
    expect(shaped.length).toBeGreaterThan(0);
    expect(form(MAP(`island w "Whidbey" : near shore at (40,100) ${WHIDBEY}\n`)))
      .not.toBe(form(MAP(`island w "Whidbey" : near shore at (40,100) size=80mi reach=0.18\n`)));
    expect(lozenge.length).toBeGreaterThan(0);
  });

  it("it is ORGANICALLY FINISHED, not drawn raw", () => {
    // Eleven declared points render as a drawn coast rather than a surveyed
    // polygon; left raw it reads as strangely angular against every other
    // coastline on the map (spec 02 §9, ADR 0025).
    expect(poly(MAP(`island w "Whidbey" : near shore at (40,100) ${WHIDBEY}\n`)).length).toBeGreaterThan(11 * 4);
  });

  it("the points are FRAMED: moving it is ONE coordinate, and the shape does not change", () => {
    // The property that keeps it a placed feature. Absolute points would mean
    // transforming the whole set to move the island, and would leave it behind
    // when its host moved.
    expect(form(MAP(`island w "Whidbey" : near shore at (25,60) ${WHIDBEY}\n`)))
      .toBe(form(MAP(`island w "Whidbey" : near shore at (40,100) ${WHIDBEY}\n`)));
  });

  it("an outline AND the dials is an ERROR — one would have to be discarded", () => {
    const msg = diags(MAP(`island w "Whidbey" : near shore at (40,100) size=80mi ${WHIDBEY}\n`)).join();
    expect(msg).toMatch(/error: 'Whidbey' declares an outline AND size=/);
    expect(msg).toMatch(/Drop size=, or drop the outline/);
    expect(poly(MAP(`island w "Whidbey" : near shore at (40,100) size=80mi ${WHIDBEY}\n`))).toEqual([]);
  });

  it("a reach= INHERITED from the vocabulary is not a conflict", () => {
    // `skerry : island reach=0.2` would otherwise make every outline on a
    // derived word an error. Only what is written on the entity line counts.
    const src = `# Whid\nmap: region\nextent: 100x200mi\n\n[vocab]\nskerry : island reach=0.2\n\n[water]\n` +
      `coastline shore : from (72,0) via (70,80) to (72,200)\nsea "S" : west of shore\n` +
      `skerry w "Whidbey" : near shore at (40,100) ${WHIDBEY}\n`;
    expect(renderSource(src).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("an outline of fewer than three points is reported", () => {
    expect(diags(MAP(`island w "Whidbey" : near shore at (40,100) area (-2,-40) (3,-30)\n`)).join())
      .toMatch(/outline of 2 points — an outline needs at least three/);
  });

  it("PROMOTION IS GEOMETRY-STABLE still: naming it does not reshape it", () => {
    const anon = form(MAP(`island w : near shore at (40,100) ${WHIDBEY}\n`));
    expect(form(MAP(`island w "Whidbey" : near shore at (40,100) ${WHIDBEY}\n`))).toBe(anon);
  });

  it("a trace framed by `chartdown frame` renders WHERE IT WAS TRACED (#174)", () => {
    // The loop that matters: absolute trace -> framed clause -> drawn island.
    // The tool's whole purpose is that a mis-subtracted offset is invisible —
    // a plausible island in the wrong place — so the round trip is asserted
    // against the traced coordinates rather than against the tool's own output.
    const traced = parsePoints("(38,60) (43,70) (41,80) (46,92) (45,104) (50,118)");
    if ("error" in traced) throw new Error(traced.error);
    const framed = frameShape(traced);
    const p = poly(MAP(`island w "W" : near shore at (${framed.anchor.x},${framed.anchor.y}) area ${formatPoints(framed.offsets)}\n`));
    const sc = 820 / 100; // canvas units per map mile at this extent
    const xs = p.map((q) => q.x / sc);
    const ys = p.map((q) => q.y / sc);
    // Asserted as a FRACTION of the shape, not an absolute slack: the outline
    // is a silhouette that gets textured (spec 02 §9), so the finished curve
    // bulges a little past its controls — measured at 0.74mi on a 58mi island,
    // which is the same finishing every `area` has always had. What would
    // matter is a systematic shift, and that shows up as a moved centre rather
    // than as a wider one.
    const near = (got: number, want: number, span: number): void => {
      expect(Math.abs(got - want) / span, `${got.toFixed(2)} vs ${want}`).toBeLessThan(0.02);
    };
    near(Math.min(...xs), 38, 12);
    near(Math.max(...xs), 50, 12);
    near(Math.min(...ys), 60, 58);
    near(Math.max(...ys), 118, 58);
    // And the CENTRE is where the trace put it, within a fifth of a mile —
    // this is the assertion that would catch a mis-subtracted offset, since
    // that shifts the shape without changing its size.
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 44)).toBeLessThan(0.2);
    expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 89)).toBeLessThan(0.2);
  });
});

describe("an island takes its bearing from the water it sits in (#167, ADR 0024)", () => {
  // Six of Puget Sound's named islands divide two arms of the sea. Hartstene
  // is what makes Case Inlet and Pickering Passage two inlets rather than one
  // bay — it lies ALONG its channel, and the coastline it was cut into runs
  // across that channel, so taking the bearing from the host drew a bar
  // damming the inlet instead of an island splitting it.
  const MAP = (islands: string): string => `# Hartstene
map: region
extent: 70x120mi

[water]
coastline shore : from (30,0) via (28,40) (29,80) to (30,120)
sea "South Sound" : west of shore
sound case "The Embayment" : on shore at (28,40) size=6mi reach=3 taper=0.15
${islands}`;

  const bbox = (src: string, id: string): { w: number; h: number } => {
    const g = new RegExp(`id="cd-hartstene-${id}">(.{0,20000}?)</g>`, "s").exec(renderSource(src).svg)!;
    const pts = /points="([^"]+)"/.exec(g[1]!)![1]!.trim().split(/\s+/)
      .map((p) => p.split(",").map(Number) as [number, number]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const INSIDE = `island hartstene "Hartstene Island" : near shore at (36,40) size=13mi reach=0.14`;
  const OUTSIDE = `island offshore "Out In The Sound" : near shore at (14,80) size=13mi reach=0.14`;

  it("an island INSIDE an inlet lies along the inlet, not along the coast", () => {
    const b = bbox(MAP(INSIDE), "hartstene");
    // The coast here runs north-south and the inlet runs east-west.
    expect(b.w).toBeGreaterThan(b.h * 4);
  });

  it("an island in OPEN WATER is unchanged — it still follows the shore", () => {
    // The reason this could be a corrected inference rather than a breaking
    // change: open water contains no channel, so the host-tangent path stands.
    const b = bbox(MAP(OUTSIDE), "offshore");
    expect(b.h).toBeGreaterThan(b.w * 4);
  });

  it("the two rules coexist on one map", () => {
    const src = MAP(`${INSIDE}\n${OUTSIDE}`);
    expect(renderSource(src).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(bbox(src, "hartstene").w).toBeGreaterThan(bbox(src, "hartstene").h);
    expect(bbox(src, "offshore").h).toBeGreaterThan(bbox(src, "offshore").w);
  });

  it("water on BOTH sides: the island divides the inlet rather than damming it", () => {
    // The claim the issue was filed for. Sampled across the island's short
    // axis at its centre: land in the middle, and the INLET'S WATER either
    // side. Asserting merely "not island" for the flanking points would be
    // vacuous — a point outside the island's own bounding box is trivially
    // not-island, and would pass just as happily over open grass.
    const svg = renderSource(MAP(INSIDE)).svg;
    const polyOf = (s: string): { x: number; y: number }[] =>
      s.trim().split(/\s+/).map((p) => {
        const [x, y] = p.split(",").map(Number) as [number, number];
        return { x, y };
      });
    const island = polyOf(/points="([^"]+)"/.exec(
      /id="cd-hartstene-hartstene">(.{0,20000}?)<\/g>/s.exec(svg)![1]!,
    )![1]!);
    // The sea is the largest polygon on a coastline map.
    const sea = [...svg.matchAll(/<polygon points="([^"]+)"/g)]
      .map((m) => polyOf(m[1]!)).sort((a, b) => b.length - a.length)[0]!;
    const inside = (pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!;
        if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    const ys = island.map((p) => p.y);
    const xs = island.map((p) => p.x);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const halfH = (Math.max(...ys) - Math.min(...ys)) / 2;

    expect(inside({ x: cx, y: cy }, island)).toBe(true);                 // land in the middle
    for (const side of [-1, 1]) {
      const pt = { x: cx, y: cy + side * halfH * 2 };
      expect(inside(pt, island), `${side < 0 ? "north" : "south"} of the island`).toBe(false);
      expect(inside(pt, sea), `${side < 0 ? "north" : "south"} channel is water`).toBe(true);
    }
  });

  it("stays a pure function of the DECLARED data — naming it does not re-point it", () => {
    const anon = bbox(MAP(`island hartstene : near shore at (36,40) size=13mi reach=0.14`), "hartstene");
    expect(bbox(MAP(INSIDE), "hartstene")).toEqual(anon);
  });
});

describe("land is one region — overlapping shapes are not double-outlined (#165)", () => {
  // Bainbridge really is separated from the Kitsap Peninsula by about half a
  // mile of water, which on a 100mi-wide map is thinner than the coastline
  // stroke. What the renderer drew instead was Bainbridge's outline running
  // across the peninsula, which reads as a mistake.
  const SRC = `map: region
extent: 300x300mi

[water]
coastline coast : from (150,0) via (150,100) (150,200) to (150,300)
sea "The Sea" : west of coast
island a "Half a mile offshore" : near coast at (146,80) size=40mi reach=0.4
island b "Overlapping pair, west" : near coast at (100,200) size=40mi reach=0.6
island c "Overlapping pair, east" : near coast at (118,210) size=40mi reach=0.6
`;
  const svg = (): string => renderSource(SRC).svg;
  /** The `points` of the FILL polygon inside an entity's group. */
  const shapeOf = (s: string, id: string): string =>
    /points="([^"]+)"/.exec(new RegExp(`id="cd-document-${id}">(.{0,20000}?)</g>`, "s").exec(s)![1]!)![1]!;
  const maskOf = (s: string, id: string): string =>
    new RegExp(`<mask id="${id}"[^>]*>(.*?)</mask>`, "s").exec(s)![1]!;

  it("an island's shore is stroked separately from its fill, and only the stroke is masked", () => {
    // The fill is land wherever it lands — paper over paper where it meets the
    // mainland, invisible and correct. Only the shore needs water to exist.
    expect(svg()).toMatch(/fill="none" stroke="[^"]+"[^/]*mask="url\(#cd-shore-document-0\)"/);
  });

  it("that mask shows the water, hides the OTHER islands, and never hides the island itself", () => {
    // Hiding its own interior would eat half its own stroke width, so every
    // shore on the map would come out thin — the kind of change that looks
    // like a theme tweak and is actually a geometry bug.
    const s = svg();
    const mask = maskOf(s, "cd-shore-document-1"); // island b
    expect(mask).toContain(shapeOf(s, "c"));  // its overlapping neighbour, hidden
    expect(mask).toContain(shapeOf(s, "a"));
    expect(mask).not.toContain(shapeOf(s, "b"));
  });

  it("a coastline is hidden wherever an island has merged with it", () => {
    const s = svg();
    expect(s).toMatch(/id="cd-document-coast" mask="url\(#cd-coast-union-document\)"/);
    expect(maskOf(s, "cd-coast-union-document")).toContain(shapeOf(s, "a"));
  });

  it("an island is LAND in the land mask, so terrain on it is not clipped away by the sea", () => {
    const mask = maskOf(svg(), "cd-land-document");
    // White AFTER the water's black: the island puts back what the sea took.
    expect(mask.lastIndexOf('fill="#fff"')).toBeGreaterThan(mask.indexOf('fill="#000"'));
  });

  it("a map with no islands carries no union masks and an unmasked coastline", () => {
    const plain = renderSource(`map: region\nextent: 300x300mi\n\n[water]\n` +
      `coastline coast : from (150,0) via (150,150) to (150,300)\nsea "The Sea" : west of coast\n`).svg;
    expect(plain).not.toContain("cd-shore-document");
    expect(plain).not.toContain("cd-coast-union");
    expect(plain).toMatch(/id="cd-document-coast">/);
  });
});

describe("a river ending in open water says so (#166)", () => {
  // Nine rivers of the Puget Sound map were authored mouth-first from a bare
  // coordinate, which put every mouth a mile or two inside the water. The
  // Stillaguamish ran the length of Port Susan and carried on overland, and
  // nothing in `check` or the render suggested it.
  const SRC = `map: region
extent: 300x300mi

[water]
coastline coast : from (150,0) via (150,100) (150,200) to (150,300)
sea "The Sea" : west of coast

[paths]
river proper "Declared to the shore" : from (280,60) via (220,70) to coast at (150,80)
river loose "Declared from open water" : from (100,220) via (200,235) to (280,250)
`;
  const warningsOf = (src: string): string[] =>
    renderSource(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  it("names the river and the water body it ends inside", () => {
    const msg = warningsOf(SRC).join();
    expect(msg).toMatch(/'Declared from open water' ends inside 'The Sea'/);
    expect(msg).toMatch(/to <coastline> at/); // the fix is a spelling that works
  });

  it("says nothing about the one declared `to coast at (…)` — the correct spelling", () => {
    expect(warningsOf(SRC).join()).not.toMatch(/'Declared to the shore'/);
  });

  it("a river ending on dry land is not questioned", () => {
    const inland = `map: region\nextent: 300x300mi\n\n[water]\n` +
      `coastline coast : from (150,0) via (150,150) to (150,300)\nsea "The Sea" : west of coast\n\n` +
      `[paths]\nriver r "The Upland" : from (280,60) via (250,80) to (220,100)\n`;
    expect(warningsOf(inland).join()).not.toMatch(/ends inside/);
  });

  it("`join` is untouched — a confluence is water meeting water by design", () => {
    const joined = `map: region\nextent: 300x300mi\n\n[water]\n` +
      `coastline coast : from (150,0) via (150,150) to (150,300)\nsea "The Sea" : west of coast\n\n` +
      `[paths]\nriver trunk "The Trunk" : from (280,60) via (220,90) to coast at (150,120)\n` +
      `river branch "The Branch" : from (280,200) via (240,160) join trunk\n`;
    expect(warningsOf(joined).join()).not.toMatch(/'The Branch' ends inside/);
  });
});

describe("a named stretch of water is a name, not a mass (#160)", () => {
  const MAP = (section: string, line: string): string =>
    `# Basins\nmap: region\nextent: 200x300mi\n\n[water]\n` +
    `coastline coast : from (110,0) via (105,150) to (110,300)\nsea "The Sound" : west of coast\n` +
    (section === "water" ? `${line}\n` : `\n[terrain]\n${line}\n`);
  const attrsOf = (svg: string, id: string): string[] => {
    const g = new RegExp(`id="cd-basins-${id}">(.{0,3000}?)</g>`, "s").exec(svg);
    return g ? [...g[1]!.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]!) : [];
  };

  it("takes no fill — neither the sea's nor a land tint", () => {
    // In [terrain] a zone drew a land tint sitting ON the water; in [water] it
    // drew an opaque sea-coloured polygon that occluded whatever lay beneath.
    // Neither is what a reader means by naming part of a sea.
    const svg = renderSource(MAP("water", `region central "Central Basin" : area (40,90) (95,100) (90,180) (35,170)`)).svg;
    expect(attrsOf(svg, "central")).toEqual(["none"]);
  });

  it("still carries its name onto the map", () => {
    const svg = renderSource(MAP("water", `region central "Central Basin" : area (40,90) (95,100) (90,180) (35,170)`)).svg;
    expect(svg).toContain("Central Basin");
  });

  it("is a real entity — it takes an id, and gm= stays GM-only", () => {
    const src = MAP("water", `region central "Central Basin" : area (40,90) (95,100) (90,180) (35,170) gm="Smugglers work the north end."`);
    expect(renderSource(src, { mode: "gm" }).svg).toContain("Smugglers work the north end.");
    expect(renderSource(src, { mode: "player" }).svg).not.toContain("Smugglers work the north end.");
  });

  it("a zone on LAND is untouched — it still takes its realm tint", () => {
    const svg = renderSource(MAP("terrain", `region inland "The Weald" : area (140,90) (190,100) (185,180) (135,170)`)).svg;
    expect(attrsOf(svg, "inland").filter((f) => f !== "none").length).toBeGreaterThan(0);
  });
});

describe("a centerline is bounded by curvature, not by total turn (#177)", () => {
  // A corner too tight to take in one step is exactly the corner a real
  // waterway completes in a series of smaller angles separated by distance.
  // The rail-side test used to compare each station's normal against the
  // MOUTH's vector — which is `cos` of how far the line has turned — so it
  // changed sign at 90° of CUMULATIVE turn and swapped the two rails. The
  // refusal was honest (the swap really did cross the outline) but the fold
  // was manufactured by the check rather than declared by the author.
  const coast = (): XY[] => resample([{ x: 50, y: 0 }, { x: 50, y: 260 }], spacingFor([]));
  /** Leaves the mouth heading east, turning `deg` in total over `steps` legs. */
  const arc = (steps: number, deg: number, len: number): XY[] => {
    const out: XY[] = [];
    let p = { x: 50, y: 130 };
    let heading = 0;
    for (let i = 0; i < steps; i++) {
      heading += (deg * Math.PI) / 180 / steps;
      p = { x: p.x + Math.cos(heading) * len, y: p.y + Math.sin(heading) * len };
      out.push({ ...p });
    }
    return out;
  };
  const draws = (via: XY[], size = 3): boolean => {
    let refused = false;
    deformCurve(coast(), [{
      morph: "bite", anchor: { x: 50, y: 130 }, size, taper: 0.2,
      seaward: { x: -1, y: 0 }, via,
    }], () => { refused = true; });
    return !refused;
  };

  it("draws a bend of many times the half-width whatever the total comes to", () => {
    // Twenty-four legs of 25 units: a radius of hundreds against a half-width
    // of 1.5, nowhere near folding anything. Every one of these was refused.
    for (const total of [90, 120, 150, 180, 240, 300]) {
      expect(draws(arc(24, total, 25)), `${total} degrees over 24 legs`).toBe(true);
    }
  });

  it("spreading a turn over more distance now HELPS, where it used to not", () => {
    // The two columns of #177's table were identical: 120 degrees was refused
    // at one leg and at six alike. Spreading a bend is the whole technique for
    // drawing a channel of finite width around a tight corner, and the same
    // total taken in smaller steps is a wider radius rather than a new shape.
    expect(draws(arc(3, 180, 25)), "180 degrees in 3 legs").toBe(false);
    expect(draws(arc(24, 180, 25)), "180 degrees in 24 legs").toBe(true);
  });

  it("still refuses a bend far tighter than the ribbon is wide", () => {
    // The bound that remains is the real one: an offset curve folds when the
    // centerline's radius drops below the half-width. Here the radius is a
    // fraction of it, and `isSimple` catches the crossing on the drawn
    // boundary rather than on a proxy for it.
    expect(draws(arc(24, 300, 0.05), 12)).toBe(false);
  });
});

describe("a bent centerline draws no sharper than a straight one (#176)", () => {
  // Reported as a pointed head and a cusp of 155.9 and 168.5 degrees that
  // `check` passed at exit 0 — which was contradictory, since `deformCurve`
  // validates the curve it returns against a 135 degree limit. Both halves
  // were true: the geometry was inside the limit, and the OUTPUT was not the
  // geometry.
  const doc = (centerline: string): string => `map: region
extent: 120x120mi

[water]
coastline shore : from (30,0) via (29,30) (28,60) (29,90) to (30,120)
sea "S" : west of shore
sound a "A bent inlet" : on shore at (28,60) ${centerline} size=3mi taper=0.2
`;
  const drawnShore = (src: string): XY[] =>
    /id="cd-document-shore"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)![1]!
      .trim().split(/\s+/).map((q) => {
        const [x, y] = q.split(",").map(Number) as [number, number];
        return { x, y };
      });
  const sharpest = (pts: XY[]): number => {
    let worst = 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      let t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
      if (t > Math.PI) t = 2 * Math.PI - t;
      worst = Math.max(worst, (t * 180) / Math.PI);
    }
    return worst;
  };

  it("keeps every reported centerline in the straight one's range", () => {
    const straight = sharpest(drawnShore(doc("via (48,60)")));
    for (const bent of [
      "via (44,62) (56,70)",
      "via (42,63) (52,72) (60,88)",
      "via (40,64) (48,72) (54,84) (58,96)",
    ]) {
      // Was 155.9, 168.5 and 124.6 degrees against a straight case of 11.1.
      expect(sharpest(drawnShore(doc(bent))), bent).toBeLessThan(straight * 3);
    }
  });

  it("never prints the same vertex twice — a zero-length segment has no direction", () => {
    // This is what made a smooth curve measure 155.9 degrees: two vertices
    // closer than `fmt` can express print identically, and the segment between
    // them then reads as an arbitrary turn to anything measuring the drawn
    // curve.
    for (const spec of ["via (48,60)", "via (42,63) (52,72) (60,88)"]) {
      const pts = drawnShore(doc(spec));
      const repeats = pts.filter((p, i) => i > 0 && p.x === pts[i - 1]!.x && p.y === pts[i - 1]!.y);
      expect(repeats, spec).toEqual([]);
    }
  });
});

describe("a declared centerline chooses its own side (#175)", () => {
  // Under an enclosed sea the map yields ONE vector for a whole body, reduced
  // to a side by a dot product with the local normal — so on a shore that
  // wraps a peninsula it is inverted on one limb, and where the coast turns
  // square to it the answer is arithmetic noise. The mouth's lead followed
  // that, while the channel followed the author, and the contradiction was
  // reported as a fold the author had not written.
  const SHORE = "from (50,0) via (48,30) (52,60) (48,90) to (50,120)";
  const doc = (sea: string, feature: string): string => `map: region
extent: 100x120mi

[water]
coastline shore : ${SHORE}
${sea}
${feature}
`;
  const HALFPLANE = `sea "S" : east of shore`;
  const ENCLOSED = `sea "S" : area (50,0) along shore (50,120) (100,120) (100,0)`;
  const refusals = (src: string): number =>
    renderSource(src).diagnostics.length;

  it("gives the same answer however the sea is spelled", () => {
    // #175's A/B: only the sea declaration differs, and it decided whether a
    // centerline could be drawn at all.
    for (const f of [
      `sound c "X" : on shore at (52,60) size=2mi reach=4 taper=0.2`,
      `sound c "X" : on shore at (52,60) via (44,60) size=2mi taper=0.2`,
      `fjord h "H" : on shore at (52,60) via (46,62) (42,66) (38,72) size=2mi taper=0.15`,
    ]) {
      expect(refusals(doc(ENCLOSED, f)), f).toBe(refusals(doc(HALFPLANE, f)));
    }
  });

  it("accepts a centerline in every direction that clears the coast", () => {
    // The accepted set was a single bearing out of eight, and at four of five
    // anchors on the reported map it was disjoint from the land side.
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7]];
    for (const [dx, dy] of dirs) {
      const f = `sound c "X" : on shore at (52,60) via (${(52 + dx * 8).toFixed(1)},${(60 + dy * 8).toFixed(1)}) size=2mi taper=0.2`;
      expect(refusals(doc(ENCLOSED, f)), `${dx},${dy}`).toBe(0);
    }
  });

  it("an arm on a canal that states its course needs no side from the map", () => {
    // Dabob Bay hangs off Hood Canal. Where the canal declares its centerline
    // that line IS the answer, so the arm was being dropped for want of
    // something it never needed — and which sea spelling two features away
    // decided whether it got.
    const canal = `fjord hood "Hood Canal" : on shore at (52,60) via (46,62) (42,66) (38,72) size=2mi taper=0.15`;
    const arm = `sound dabob "Dabob Bay" : on hood at (42,66) size=1.5mi reach=5 taper=0.3`;
    expect(refusals(doc(ENCLOSED, `${canal}\n${arm}`))).toBe(0);
  });
});

describe("an arm does not re-space the feature it hangs off (#179)", () => {
  // Arms run as a second pass over the coast the feature they hang off is
  // already spliced into. That pass used to re-sample its input at the host
  // spacing, which throws away an outline sampled at its own radii — and lands
  // the new samples by TOTAL ARC LENGTH, so an unrelated feature elsewhere on
  // the coast moved where they fell and turned a drawable arm into a fold.
  const SHORE = "from (50,0) via (48,30) (52,60) (48,90) to (50,120)";
  const SEA = `sea "S" : area (50,0) along shore (50,120) (100,120) (100,0)`;
  const CANAL = `fjord hood "Hood Canal" : on shore at (52,60) via (46,62) (42,66) (38,72) size=2mi taper=0.15`;
  const ARM = `sound dabob "Dabob Bay" : on hood at (42,66) size=1.5mi reach=5 taper=0.3`;
  const doc = (extra: string, withArm = true): string => `map: region
extent: 100x120mi

[water]
coastline shore : ${SHORE}
${SEA}
${CANAL}
${withArm ? ARM : ""}
${extra}
`;
  const shoreOf = (src: string): { pts: XY[]; sharp: number } => {
    const pts = /id="cd-document-shore"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)![1]!
      .trim().split(/\s+/).map((q) => {
        const [x, y] = q.split(",").map(Number) as [number, number];
        return { x, y };
      });
    let sharp = 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      let t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
      if (t > Math.PI) t = 2 * Math.PI - t;
      sharp = Math.max(sharp, (t * 180) / Math.PI);
    }
    return { pts, sharp };
  };

  it("adding a feature elsewhere on the coast does not refuse the arm", () => {
    // A bay thirty miles away on the far side of the canal's mouth. Nothing
    // about the arm changes, and it used to decide whether the arm drew.
    for (const extra of [
      "",
      `bay b1 "B1" : on shore at (50,52) size=3mi reach=2`,
      `bay b2 "B2" : on shore at (48,30) size=3mi reach=2`,
      `cape c1 "C1" : on shore at (48,30) size=3mi`,
    ]) {
      expect(renderSource(doc(extra)).diagnostics, extra || "(nothing)").toEqual([]);
    }
  });

  it("the arm ADDS to its host's outline instead of coarsening it", () => {
    // Measured before the fix: 1211 vertices down to 756, and the coast's
    // sharpest turn up from 29 degrees to 82 — a silent degradation of a
    // canal that drew perfectly well on its own.
    const alone = shoreOf(doc("", false));
    const armed = shoreOf(doc("", true));
    expect(armed.pts.length).toBeGreaterThan(alone.pts.length);
    expect(armed.sharp).toBeLessThan(alone.sharp + 5);
  });
});

describe("a skewed centerline is not reported as a fold (#183)", () => {
  // Spec 05 §4 requires a centerline to leave its host perpendicular, and on a
  // curved shore that direction cannot be judged by eye. Reported as a fold it
  // sent an author to try smaller sizes, smaller reaches and straighter
  // stretches, none of which was ever the problem.
  const doc = (via: string, size = "2mi"): string => `map: region
extent: 100x130mi

[water]
coastline shore : from (50,0) via (48,30) (52,60) (48,90) to (50,120)
sea "S" : east of shore
sound c "Case Inlet" : on shore at (52,60) ${via} size=${size} taper=0.2
`;
  const messages = (src: string): string[] => renderSource(src).diagnostics.map((d) => d.message);

  it("names the skew, the angle, and a point to try", () => {
    const [msg] = messages(doc("via (52,52)"));
    expect(msg).toMatch(/leaves the host at \d+° from the normal/);
    expect(msg).toMatch(/must leave perpendicular/);
    expect(msg).toMatch(/Try a first via point at \(-?[\d.]+,-?[\d.]+\)/);
    // The size is NOT quoted, because changing it is exactly the wrong edit.
    expect(msg).not.toMatch(/size=/);
  });

  it("suggests a point that actually draws", () => {
    // The suggestion is spliced and validated before being offered, so it is
    // a fact about this map rather than an estimate.
    const [msg] = messages(doc("via (52,52)"));
    const m = /via point at \((-?[\d.]+),(-?[\d.]+)\)/.exec(msg!)!;
    expect(messages(doc(`via (${m[1]},${m[2]})`))).toEqual([]);
  });

  it("leaves a genuine fold reading as a fold", () => {
    // On the normal and far too big for its stretch: the perpendicular would
    // not rescue it, so the honest answer is still a fold — with the size
    // named, because here the size IS the thing to change.
    const [msg] = messages(doc("via (44,60)", "60mi"));
    expect(msg).toMatch(/would fold this stretch/);
    expect(msg).toMatch(/size=60mi/);
  });
});

describe("an island welded to the mainland is reported (#180)", () => {
  // #164 fires only when a footprint is WHOLLY dry. The failure that matters
  // is weaker: still mostly in water, but touching the shore, so #165's union
  // joins the two and the document's island is not one on the map. The test is
  // navigational — could a reader sail round it?
  const doc = (x: number): string => `map: region
extent: 100x100mi

[water]
coastline shore : from (50,0) via (50,30) (50,60) to (50,100)
sea "S" : west of shore
island i "An Isle" : near shore at (${x},50) area (0,-6) (2,-3) (2.5,3) (1,6) (-1,5) (-2,0) (-1.5,-4)
`;
  const messages = (x: number): string[] => renderSource(doc(x)).diagnostics.map((d) => d.message);

  it("reports an island whose outline reaches the coast", () => {
    // The island's east side extends 2.5mi from its anchor, so from x=48 it
    // touches the shore at x=50.
    for (const x of [48, 49, 50, 51]) {
      const [msg] = messages(x);
      expect(msg, `x=${x}`).toMatch(/touches the mainland along \d+% of its shore/);
      // Where it touches and how far in — a bare share is not actionable, and
      // near the threshold it reads like a clean island.
      expect(msg, `x=${x}`).toMatch(/near \(-?[\d.]+,-?[\d.]+\)/);
      expect(msg, `x=${x}`).toMatch(/reaching about [\d.]+mi inland/);
    }
  });

  it("leaves a genuine channel alone, however narrow", () => {
    // 0.5mi, 0.3mi and 0.1mi of open water: all still islands.
    for (const x of [40, 44, 47, 47.2, 47.4]) {
      expect(messages(x), `x=${x}`).toEqual([]);
    }
  });

  it("still gives the wholly-dry case its own message", () => {
    // One cause, one report: a dry island is not also 'joined to the mainland'.
    const msgs = messages(62);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/no water around it/);
  });
});

describe("a feature's water side is resolved locally (#178)", () => {
  // A coast with a peninsula jutting EAST between y=42 and y=58: land is west
  // and INSIDE the peninsula, water is east and also NORTH of the peninsula's
  // north shore. One vector for the whole body cannot say that — on the north
  // shore the local normal runs north/south, so its dot product with "east" is
  // about zero and the sign that falls out is arithmetic noise. Measured before
  // the fix, an enclosed sea drew the bay and the cape THE WRONG WAY ROUND
  // here, with nothing reported: a generated run has no declared direction to
  // contradict, so it does not fold, it just lands on the wrong side.
  const SHORE = "from (50,0) via (50,20) (50,40) (66,42) (80,45) (80,55) (66,58) (50,60) (50,80) to (50,120)";
  const SCALE = 820 / 130;
  const doc = (sea: string, feature: string): string => `map: region
extent: 130x130mi

[water]
coastline shore : ${SHORE}
${sea}
${feature}
`;
  const HALFPLANE = `sea "S" : east of shore`;
  const ENCLOSED = `sea "S" : area (50,0) along shore (50,120) (130,120) (130,0)`;

  /** The coast's north and south extremes in a window round a map point. */
  const band = (src: string, cx: number, cy: number): { lo: number; hi: number } => {
    const m = /id="cd-document-shore"[^>]*>.*?points="([^"]+)"/s.exec(renderSource(src).svg)!;
    const pts = m[1]!.trim().split(/\s+/)
      .map((q) => {
        const [x, y] = q.split(",").map(Number) as [number, number];
        return { x, y };
      })
      .filter((p) => Math.abs(p.x - cx * SCALE) < 7 * SCALE && Math.abs(p.y - cy * SCALE) < 9 * SCALE);
    return { lo: Math.min(...pts.map((p) => p.y)) / SCALE, hi: Math.max(...pts.map((p) => p.y)) / SCALE };
  };

  for (const [label, sea] of [["a half-plane", HALFPLANE], ["an enclosed sea", ENCLOSED]] as const) {
    it(`bites into the peninsula and juts out of it, under ${label}`, () => {
      const bare = band(doc(sea, ""), 66, 42);
      const bay = band(doc(sea, `bay b "B" : on shore at (66,42) size=4mi reach=1.5`), 66, 42);
      const cape = band(doc(sea, `cape c "C" : on shore at (66,42) size=4mi reach=1.5`), 66, 42);
      // A bay is water cutting SOUTH into the peninsula: the band's south edge
      // moves and its north edge does not.
      expect(bay.hi).toBeGreaterThan(bare.hi + 3);
      expect(Math.abs(bay.lo - bare.lo)).toBeLessThan(1);
      // A cape is land reaching NORTH into the water: the mirror.
      expect(cape.lo).toBeLessThan(bare.lo - 3);
      expect(Math.abs(cape.hi - bare.hi)).toBeLessThan(1);
    });
  }

  it("gives the same answer however the sea is spelled", () => {
    // The A/B that started #175 and finished here: the sea's spelling is not
    // supposed to be a fact about the coastline.
    for (const feature of [
      `bay b "B" : on shore at (66,42) size=4mi reach=1.5`,
      `cape c "C" : on shore at (66,42) size=4mi reach=1.5`,
      `bay w "W" : on shore at (50,20) size=4mi reach=1.5`,
    ]) {
      expect(band(doc(ENCLOSED, feature), 66, 42), feature)
        .toEqual(band(doc(HALFPLANE, feature), 66, 42));
    }
  });
});

describe("an undetermined side is reported, not guessed (#178)", () => {
  // Spec 05 §4: where the water's declaration does not determine the side at
  // an anchor, a renderer MUST NOT guess silently. A shore with declared sea
  // on BOTH sides — a spit, an isthmus — genuinely does not say which way a
  // bay faces, and picking one is how a map comes to contradict its document.
  const SRC = `map: region
extent: 100x100mi

[water]
coastline shore : from (50,0) via (50,40) (50,60) to (50,100)
sea "West" : west of shore
sea "East" : east of shore
bay b "B" : on shore at (50,50) size=4mi reach=1.5
`;

  it("says so, and says what would fix it", () => {
    const warnings = renderSource(SRC).diagnostics.filter((d) => d.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/does not say which side/);
    expect(warnings[0]!.message).toMatch(/spec 05 §4/);
  });

  it("still draws the map — this is a warning, not a refusal", () => {
    expect(renderSource(SRC).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(renderSource(SRC).svg).toContain("<svg");
  });
});
