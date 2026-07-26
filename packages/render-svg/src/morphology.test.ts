/**
 * Placed morphology geometry (#93, ADR 0023).
 *
 * The properties asserted here are the ones the ADR promises an author, not
 * incidental facts about the implementation: a feature is a pure function of
 * its own data, it disturbs only its own stretch of the host, and the host
 * never crosses itself no matter what it is asked for.
 */
import { describe, expect, it } from "vitest";
import { deformCurve, isSimple, isSmooth, type PlacedFeature } from "./morphology";
import { renderSource } from "./index";
import type { XY } from "./util";

/**
 * A straight west-to-east coast, already at the uniform spacing `deformCurve`
 * imposes (#155) — so a test may compare its output to this baseline by index.
 * Deforming with NO features is exactly that resampling and nothing else.
 */
const straight = (n = 81, len = 400): XY[] =>
  deformCurve(Array.from({ length: n }, (_, i) => ({ x: (i / (n - 1)) * len, y: 100 })), []);

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
    const base = straight();
    const rejected: string[] = [];
    const out = deformCurve(base, [feature({ size: 60 })], () => rejected.push("x"));
    expect(rejected).toHaveLength(0);
    expect(maxOffset(base, out)).toBeCloseTo(60 * 0.55, 6);
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
    const base = straight();
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
    const base = straight();
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
    const base = straight();
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
    // A big jut off a sharply turning coast: this one genuinely folds, which a
    // needle on a straight coast does not — a huge reach there is absurd to
    // look at but geometrically valid, and the check is about geometry.
    const src = doc(
      `coastline shore : from (300,0) via (100,300) (500,600) (100,900) to (300,1200)
` +
      `sea "W" : west of shore
` +
      `spit dungeness "Dungeness Spit" : on shore at (500,600) size=300.5mi reach=200`,
    );
    const msg = errorsOf(src).join();
    expect(msg).toMatch(/size=300\.5mi/);        // not rounded, unit kept
    expect(msg).toMatch(/'Dungeness Spit' \(spit\)/); // the entity, not just the word
    expect(msg).toMatch(/a jut that long/);      // not "a bite that deep"
    expect(msg).not.toMatch(/a bite that deep/);
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
