/**
 * A battlemap `width=` is a measure too, and the ground must agree with the ink
 * (#374).
 *
 * #367 fixed `Number(<measure>)` on region geometry and claimed the corpus had
 * no other exposure. It did: two battlemap river paths, and the same read in
 * two places here. `Number("15ft")` is NaN, so the ink went NaN — and in
 * `surfaceCells` it fell through `|| 1` to a ONE-CELL band.
 *
 * That second half is the one that mattered. `surfaceCells` exists so "the
 * lints, the wall collector and the UVTT exporter cannot disagree about what
 * ground a cell has on it", and they did: three cells to the author, NaN to the
 * ink, one cell to everything reasoning about ground. A door opening onto a
 * `width=15ft` road reported `door-onto-void`, and a UVTT export carried the
 * same disagreement in silence.
 *
 * The conversion is UNIT-AWARE and has to be: a bare `width=2` already means
 * two cells and must keep meaning that, or both corpus rivers move.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const doc = (width: string, scale = "5ft"): string => [
  "map: battlemap", "grid: square 20x15", `scale: ${scale}`, "", "[terrain]",
  "earth : area A1..T15", `road main : path A8 T8 width=${width}`, "",
  "[structures]", "building hall : F4..J6", "  door : H6.s",
].join("\n");

const warnings = (src: string): string[] =>
  renderSource(src, { mode: "gm" }).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

describe("a unit-suffixed width is the same width", () => {
  it("width=15ft at scale 5ft renders exactly as width=3", () => {
    // The whole claim, and the cheapest possible statement of it.
    expect(renderSource(doc("15ft"), { mode: "gm" }).svg).toBe(renderSource(doc("3"), { mode: "gm" }).svg);
  });

  it("no NaN reaches the output", () => {
    for (const w of ["15ft", "10ft", "2", "1"]) {
      expect(renderSource(doc(w), { mode: "gm" }).svg, w).not.toContain("NaN");
    }
  });

  it("the scale is honoured, not assumed", () => {
    // At 10ft cells, 20ft is two cells rather than four.
    expect(renderSource(doc("20ft", "10ft"), { mode: "gm" }).svg)
      .toBe(renderSource(doc("2", "10ft"), { mode: "gm" }).svg);
  });
});

describe("the ground agrees with the ink", () => {
  it("a door onto a wide road is not door-onto-void, however the width is spelled", () => {
    // The lint reads `surfaceCells`; the render reads its own width. This is
    // the disagreement, and the spelling is what used to decide it.
    expect(warnings(doc("3")).join("\n")).not.toContain("door");
    expect(warnings(doc("15ft")).join("\n")).not.toContain("door");
  });

  it("and a road that genuinely misses the door still says so", () => {
    // The control. Without it the test above passes on a lint that never fires.
    expect(warnings(doc("1")).join("\n")).toContain("door");
  });
});

describe("what must not move", () => {
  it("a bare width still means cells — both corpus rivers depend on it", () => {
    // `fairwater-manor` and `redford-crossing` both declare `width=2`. If a
    // bare number were run through the measure conversion it would become
    // 2/5 = 0.4 cells and every committed battlemap render would move.
    const two = renderSource(doc("2"), { mode: "gm" }).svg;
    const ten = renderSource(doc("10ft"), { mode: "gm" }).svg;
    expect(two).toBe(ten);
    expect(two).not.toBe(renderSource(doc("1"), { mode: "gm" }).svg);
  });
});
