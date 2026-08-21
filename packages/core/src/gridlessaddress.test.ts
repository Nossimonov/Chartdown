/**
 * A cell address on a gridless map (#325, ADR 0049).
 *
 * Spec 02 §2 gives the address "one form for every GRID" and reads its
 * geometry from "the header's `grid:` declaration". A region map declares
 * none, so `C4` written on one names nothing — and the region renderer's
 * placement loop has no branch for `address`, `range` or `edge`, so the
 * placement evaporated. Five spellings rendered byte-identically to their own
 * absence and `area C4..D5` emitted `<polygon points="">`.
 *
 * The rule already existed in the tree for exactly one slot: `region.ts`
 * refused a cell in a course's `via` payload (#258) and nothing else. That
 * special case is deleted here rather than left beside the general rule.
 *
 * Two properties are pinned rather than the symptom. First, EVERY slot the
 * decision names, because the defect was an enumeration that missed six of
 * seven. Second, exactly ONE diagnostic per line — the grid-flavoured checks
 * are suppressed, since "place it on the cell instead: 'C4'" is advice a
 * gridless document cannot take. The grid-map cases are pinned beside them,
 * because the risk in suppressing a check is suppressing it too far.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const region = (...lines: string[]): string =>
  ["# G", "map: region", "extent: 1000x1000", "",
   "[terrain]", "forest w : (400,400)", ...lines].join("\n");

const battlemap = (...lines: string[]): string =>
  ["# G", "map: battlemap", "grid: square 20x15", "scale: 5ft", "",
   "[terrain]", ...lines].join("\n");

const errorsOf = (src: string): string[] =>
  parse(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const warningsOf = (src: string): string[] =>
  parse(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

describe("an address is refused in every slot a gridless map admits it", () => {
  for (const [slot, line] of [
    ["bare", "grove g : C4"],
    ["under `at`", "grove g : at C4"],
    ["an edge token", "grove g : at C4.n"],
    ["under `on`'s `at` payload", "grove g : on w at C4"],
    ["a shape argument", "grove g : area (100,100) C4 (300,300)"],
  ] as const) {
    it(`refuses it ${slot}`, () => {
      const errors = errorsOf(region(line));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/this map has no grid/);
    });
  }

  it("refuses an address range, naming the point-range spelling", () => {
    const errors = errorsOf(region("grove g : area C4..D5"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/range of cell addresses/);
    expect(errors[0]).toMatch(/\(400,400\)\.\.\(500,500\)/);
  });

  it("refuses a cell in a course's `via` controls, which is where the rule used to live alone", () => {
    const src = ["# G", "map: region", "extent: 1000x1000", "",
                 "[water]", "lake a : (100,100)", "lake b : (900,900)",
                 "river r : from a via D8 to b"].join("\n");
    expect(errorsOf(src)).toHaveLength(1);
    expect(errorsOf(src)[0]).toMatch(/'D8' is a cell address/);
  });

  it("refuses it in a `[labels]` override's `at` and `sprawl` targets", () => {
    for (const hint of ["at C4", "sprawl C4..D5"]) {
      const errors = errorsOf(region("", "[labels]", `w : ${hint}`));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/this map has no grid/);
    }
  });

  it("leaves the gridless spellings alone", () => {
    expect(errorsOf(region("grove g : (500,500)", "", "[labels]", "w : at (500,500)"))).toEqual([]);
  });
});

describe("the grid-flavoured checks are suppressed, and only on a gridless map", () => {
  it("says nothing about cells when there is no grid to place one on", () => {
    for (const line of ["grove g : at C4.n", "grove g : at C4.nw"]) {
      expect(errorsOf(region(line)).join(" ")).not.toMatch(/place it on the cell instead|names a corner/);
    }
  });

  it("still refuses an edge token on a grid map, in its own words", () => {
    const errors = errorsOf(battlemap("forest w : at C4.n"));
    expect(errors.join(" ")).toMatch(/an edge token places a wall, door or window/);
  });

  it("still refuses a corner on a grid map", () => {
    expect(errorsOf(battlemap("forest w : at C4.nw")).join(" ")).toMatch(/names a corner/);
  });

  it("still accepts an address on a grid map", () => {
    expect(errorsOf(battlemap("forest w : at C4"))).toEqual([]);
  });
});

describe("`grid:` on a gridless map warns, the mirror of `detail:` on a grid map", () => {
  it("warns, because the map still draws correctly without it", () => {
    const src = ["# G", "map: region", "grid: square 10x10", "extent: 1000x1000", "",
                 "[terrain]", "forest w : (400,400)"].join("\n");
    expect(errorsOf(src)).toEqual([]);
    expect(warningsOf(src).join(" ")).toMatch(/'grid:' declares the geometry a cell address is read in/);
  });

  it("does not rescue an address — the warning and the error are both reported", () => {
    const src = ["# G", "map: region", "grid: square 10x10", "extent: 1000x1000", "",
                 "[terrain]", "forest w : at C4"].join("\n");
    expect(errorsOf(src)).toHaveLength(1);
    expect(warningsOf(src).join(" ")).toMatch(/does nothing on a region map/);
  });

  it("says nothing on a map that has a grid", () => {
    expect(warningsOf(battlemap("forest w : at C4")).join(" ")).not.toMatch(/'grid:'/);
  });
});
