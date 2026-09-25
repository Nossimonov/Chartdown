/**
 * Ledges are emergent (spec 06 §5, #425).
 *
 * "Wherever adjacent placements' elevations differ, the renderer draws a
 * theme-styled edge... There is no cliff-tracing grammar." That was the one
 * thing §5 promised and did not do: `elevation=` tinted a zone and drew no
 * edge anywhere, so the only way to get a cliff was `drop` — the explicit
 * spelling that sentence says an author should not need.
 *
 * Found by a dogfooding pass, whose reporter tried a single range, multiple
 * ranges and a cell list, in both shipped themes, and never got a ledge.
 *
 * The terms §5 left undefined were settled with the maintainer and written
 * into it: the winning declaration decides a cell's height, undeclared ground
 * is 0, adjacency is a shared cell EDGE, the higher side owns it, and a cell
 * edge carries at most ONE cliff.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# L", "map: battlemap", "chartdown: 0.1", "grid: square 14x10", "scale: 5ft"];
const render = (section: string, ...lines: string[]): string =>
  renderSource([...HEAD, "", section, ...lines].join("\n"), { mode: "gm" }).svg;
const terrain = (...lines: string[]): string => render("[terrain]", ...lines);
/** Cliff RUNS — one per straight stretch of fall edge. */
const runs = (svg: string): number => (svg.match(/class="drop"/g) ?? []).length;

describe("the reported case", () => {
  it("a raised area is ledged, where it drew nothing", () => {
    expect(runs(terrain("terrace t : area D3..F6 elevation=15ft"))).toBe(4);
    expect(runs(terrain("terrace t : area D3..F6"))).toBe(0);
  });

  it("every spelling of the footprint, since the reporter tried all three", () => {
    const cells = ["D", "E", "F"].flatMap((c) => [3, 4, 5, 6].map((r) => `${c}${r}`)).join(" ");
    expect(runs(terrain(`terrace t : area ${cells} elevation=15ft`))).toBe(4);
    expect(runs(terrain("terrace t : area D3..E6 F3..F6 elevation=15ft"))).toBe(4);
  });
});

describe("a cell's elevation is the winning declaration (spec 06 §5, §3)", () => {
  it("ground laid first, the raised thing painted after", () => {
    // §5's own idiom, and the order that makes the rule come out right.
    expect(runs(terrain("earth g : area A1..N10", "terrace t : area D3..F6 elevation=15ft"))).toBe(4);
  });

  it("and a blanket laid AFTER flattens it — the cost of that rule, stated", () => {
    expect(runs(terrain("terrace t : area D3..F6 elevation=15ft", "earth g : area A1..N10"))).toBe(0);
  });
});

describe("undeclared ground is 0, including off the grid", () => {
  it("a raised area needs no plain declared about it", () => {
    // Otherwise a hill only gets an edge if the author traces its surroundings,
    // which is the cliff-tracing §5 says there is no grammar for.
    expect(runs(terrain("terrace t : area D3..F6 elevation=15ft"))).toBe(4);
  });

  it("an area against the map edge is still ledged there", () => {
    expect(runs(terrain("terrace t : area A1..C3 elevation=15ft"))).toBe(4);
  });

  it("flat ground everywhere draws nothing", () => {
    expect(runs(terrain("earth g : area A1..N10"))).toBe(0);
    expect(runs(terrain("earth g : area A1..N10 elevation=15ft"))).toBe(4); // raised as a whole, still an edge at the rim
  });
});

describe("the higher side owns the edge", () => {
  it("two raised areas at different heights share one cliff, not two", () => {
    // 15 beside 5: the shared edge belongs to the higher. The outer north and
    // south edges of the two are collinear and merge, so five runs, not seven.
    expect(runs(terrain("grass a : area D3..F6 elevation=15ft", "grass b : area G3..I6 elevation=5ft"))).toBe(5);
  });

  it("equal heights share no edge at all", () => {
    expect(runs(terrain("grass a : area D3..F6 elevation=15ft", "grass b : area G3..I6 elevation=15ft"))).toBe(4);
  });
});

describe("a cell edge carries at most one cliff", () => {
  it("`drop` and an elevation difference are two reasons for one mark", () => {
    const both = terrain("terrace t : area D3..F6 elevation=15ft drop");
    expect(runs(both)).toBe(4);
    expect(runs(both)).toBe(runs(terrain("terrace t : area D3..F6 drop")));
  });
});

describe("what sets a height, and what does not", () => {
  it("a chest standing on a terrace does not flatten it", () => {
    const withChest = renderSource([...HEAD, "", "[terrain]", "terrace t : area D3..F6 elevation=15ft",
      "", "[features]", "chest c : E4"].join("\n"), { mode: "gm" }).svg;
    expect(runs(withChest)).toBe(4);
  });

  it("and `drop` alone still works with no elevation anywhere", () => {
    expect(runs(terrain("terrace t : area D3..F6 drop"))).toBe(4);
  });
});
