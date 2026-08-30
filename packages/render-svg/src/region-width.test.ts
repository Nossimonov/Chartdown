/**
 * A region `width=` is a measure in map units (#367).
 *
 * Spec 05 §4 says `width=<measure>`, and `grammar.ebnf` has
 * `measure = number , [ unit ]` — so `1.5mi` and `1.5` are the same thing said
 * two ways. Both were wrong, in opposite directions:
 *
 *   `Number("1.5mi")` -> NaN, written straight into `stroke-width="NaN"` with
 *   `check` saying `ok`. The feature is invisible in most rasterizers.
 *
 *   `Number("1.5")`   -> 1.5 CANVAS pixels. A hairline on a 20-mile map, and
 *   the same hairline on a 40-mile one, so the breadth of a marsh did not
 *   depend on the map it was drawn on.
 *
 * A band's breadth is how wide the marsh IS — geometry, which ADR 0037 puts in
 * map units. The ridge path was already correct, which is exactly why ridges
 * were the only region geometry whose width worked, and why the reporter found
 * `ridge … width=5mi` fine on the very same document.
 *
 * Found by an agent drafting a real map. The NaN half announces itself; the
 * bare-number half is invisible unless you compare two extents, which is the
 * half that makes a correctly-written document quietly wrong.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

/** 20 mi across an 820 px canvas = 41 px per mi. */
const PX_PER_MI = 41;

const doc = (extent: string, line: string): string =>
  ["map: region", `extent: ${extent}`, "", "[water]",
    "coastline coast : from (0,3) via (6,8) (13,7) to (20,10)", "", "[terrain]", line].join("\n");

/** Every stroke width in the output, as numbers. */
const strokes = (svg: string): number[] =>
  [...svg.matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => Number(m[1]));

const widest = (svg: string): number => Math.max(...strokes(svg));

describe("a declared width is in map units", () => {
  it("a unit-suffixed width scales, and does not emit NaN", () => {
    const svg = renderSource(doc("20x14mi", "marsh fen : along coast width=1.5mi")).svg;
    expect(svg).not.toContain("NaN");
    expect(widest(svg)).toBeCloseTo(1.5 * PX_PER_MI, 1);
  });

  it("a bare number means the same thing — it is a measure with the unit elided", () => {
    const withUnit = renderSource(doc("20x14mi", "marsh fen : along coast width=1.5mi")).svg;
    const bare = renderSource(doc("20x14mi", "marsh fen : along coast width=1.5")).svg;
    expect(widest(bare)).toBeCloseTo(widest(withUnit), 6);
    expect(widest(bare)).toBeCloseTo(1.5 * PX_PER_MI, 1); // NOT 1.5 canvas px
  });

  it("a river, which is where this was found", () => {
    const svg = renderSource([
      "map: region", "extent: 20x14mi", "", "[water]",
      'river styx "The Styx" : from (0,12) via (6,13) (13,12) to (20,13) width=1mi',
    ].join("\n")).svg;
    expect(svg).not.toContain("NaN");
    expect(widest(svg)).toBeCloseTo(PX_PER_MI, 1);
  });

  it("doubling the extent halves the drawn breadth (ADR 0037)", () => {
    // The property the bare-number bug violated: geometry may not depend on the
    // canvas. One mile is one mile; the pixels it occupies are not.
    const at = (extent: string): number => widest(renderSource(doc(extent, "marsh fen : along coast width=1.5mi")).svg);
    const twenty = at("20x14mi");
    expect(at("40x28mi")).toBeCloseTo(twenty / 2, 1);
    expect(at("80x56mi")).toBeCloseTo(twenty / 4, 1);
  });
});

describe("what must not move", () => {
  it("no declared width still means the ink default, in canvas units", () => {
    // The fallback is not a measure anybody wrote — it is the weight a line
    // gets when nothing says otherwise, and it stays put as the map grows.
    const at = (extent: string): number[] => strokes(renderSource(doc(extent, "marsh fen : along coast")).svg);
    expect(at("20x14mi")).toEqual(at("40x28mi"));
  });

  it("a ridge, which was right all along", () => {
    const svg = renderSource(doc("400x300mi", "mountains spine : ridge (100,100) (200,150) (300,120) width=70mi")).svg;
    expect(svg).not.toContain("NaN");
  });
});
