/**
 * `drop` ticks the footprint's perimeter, not each rectangle in it (#424).
 *
 * The cliff was drawn per `range` arg, which was two faces of one bug:
 *
 *   - a CELL-LIST area produces no `range` arg, so it got no cliff at all —
 *     the flag was accepted and drew nothing, with no diagnostic;
 *   - a MULTI-RANGE area ticked each rectangle in full, drawing a cliff
 *     straight through the seam where two of its own ranges abut.
 *
 * Structures already had the answer: union the cells, derive the perimeter
 * (spec 06 §3), which is how an L-shaped building gets one outline.
 *
 * Found by a dogfooding pass, and worth recording why it mattered: the
 * reporter reshaped their map around it. "Because of 1–3, the two hills are
 * single rectangles, which is the only form that gets a clean cliff edge. They
 * read more like terraced districts than natural hills." A renderer limitation
 * had become the world's geography.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# D", "map: battlemap", "chartdown: 0.1", "grid: square 30x20", "scale: 5ft"];
const svg = (line: string): string =>
  renderSource([...HEAD, "", "[terrain]", line].join("\n"), { mode: "gm" }).svg;

/** Just the cliff: every element carrying the `drop` class, in order. */
const cliff = (s: string): string[] => [...s.matchAll(/<line[^>]*class="drop"[^>]*>/g)].map((m) => m[0]);
const tickCount = (s: string): number => (s.match(/<line /g) ?? []).length;

/** One 6x5 block, spelled three ways. */
const ONE_RANGE = "grass g : area I2..N6 drop";
const TWO_RANGES = "grass g : area I2..K6 L2..N6 drop";
const CELL_LIST = "grass g : area " +
  ["I", "J", "K", "L", "M", "N"].flatMap((c) => [2, 3, 4, 5, 6].map((r) => `${c}${r}`)).join(" ") + " drop";

describe("one footprint, one cliff", () => {
  it("the three spellings produce an identical cliff", () => {
    // The whole bug in one assertion: these are the same area, so they must
    // have the same edge. Before, they had three different ones.
    expect(cliff(svg(ONE_RANGE))).not.toHaveLength(0);
    expect(cliff(svg(TWO_RANGES))).toEqual(cliff(svg(ONE_RANGE)));
    expect(cliff(svg(CELL_LIST))).toEqual(cliff(svg(ONE_RANGE)));
  });

  it("a cell-list area gets a cliff at all — it got none, silently", () => {
    const plain = svg(CELL_LIST.replace(" drop", ""));
    expect(svg(CELL_LIST)).not.toBe(plain);
    expect(cliff(svg(CELL_LIST)).length).toBeGreaterThan(0);
  });

  it("and two abutting ranges do not tick their shared seam", () => {
    // The seam showed up as extra ticks: 168 line elements against 130 for the
    // merged spelling of the same ground.
    expect(tickCount(svg(TWO_RANGES))).toBe(tickCount(svg(ONE_RANGE)));
  });
});

describe("shapes the reporter actually wanted", () => {
  it("an L-shaped footprint gets one outline", () => {
    const L = svg("grass g : area B2..D6 E2..G3 drop");
    expect(cliff(L).length).toBeGreaterThan(0);
    // An L has more boundary than its larger arm alone, and the cliff must
    // follow the notch rather than bridging it.
    expect(cliff(L).length).toBeGreaterThan(cliff(svg("grass g : area B2..D6 drop")).length);
  });

  it("two disjoint blocks each get their own edge", () => {
    const split = svg("grass g : area B2..C3 M2..N3 drop");
    const single = svg("grass g : area B2..C3 drop");
    expect(cliff(split).length).toBe(cliff(single).length * 2);
  });
});

describe("`difficult` reaches every spelling too", () => {
  // Same impoverished branch, and this half changes what a square COSTS to
  // cross rather than only how it looks.
  for (const [name, line] of [
    ["a range area", "mud m : area B2..D4"],
    ["a cell-list area", "mud m : area B2 C2 D2"],
    ["a bare cell", "mud m : B2"],
    ["a bare range", "mud m : B2..D4"],
  ] as const) {
    it(name, () => {
      expect(svg(line + " difficult")).toContain("url(#hatch)");
      expect(svg(line)).not.toContain("url(#hatch)");
    });
  }
});

describe("what must not move", () => {
  it("no `drop` means no cliff", () => {
    expect(cliff(svg("grass g : area I2..N6"))).toEqual([]);
    expect(cliff(svg(CELL_LIST.replace(" drop", "")))).toEqual([]);
  });

  it("a single-range cliff still surrounds its own rectangle", () => {
    // The corpus's `terrace walkway : area M2..V3 drop` is this shape, and its
    // committed SVG is regenerated with this change.
    const one = svg("terrace w : area M2..V3 drop");
    expect(cliff(one)).toHaveLength(4); // n, s, w, e — one run per side
  });
});
