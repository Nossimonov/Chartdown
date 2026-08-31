/**
 * A token's `size=` is a measure, like `width=` and `light=` before it (#387).
 *
 * #374's own commit message said "`light=` has always converted correctly
 * through `measureToCells`; only `width=` was left reading raw digits." That
 * was true of a THIRD sibling, and nobody looked: `size=` still called bare
 * `Number()`, so at `scale: 5ft` an ogre written `size=10ft` — which IS
 * `size=2` — drew one cell.
 *
 * What made it worse than an oversight is that #376 blesses the spelling on
 * the way past. `size=10mi` on that map errors with "this map is in ft", so the
 * unit check confirms `ft` is the map's own unit, waves `10ft` through, and the
 * reader then discards it. The author gets a wrong circle and a diagnostic
 * system that has just told them the unit was right.
 *
 * Found by an independent review briefed to hunt the defect's class rather than
 * audit the change in front of it.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const doc = (token: string, scale = "5ft"): string => [
  "map: battlemap", "grid: square 20x15", `scale: ${scale}`, "", "[terrain]",
  "earth : area A1..T15", "", "[tokens]", token,
].join("\n");

const render = (token: string, scale?: string): string =>
  renderSource(doc(token, scale), { mode: "gm" }).svg;

const radii = (svg: string): string[] =>
  [...svg.matchAll(/<circle[^>]*\br="([0-9.]+)"/g)].map((m) => m[1]!);

describe("a unit-suffixed size is the same size", () => {
  it("size=10ft at scale 5ft renders exactly as size=2", () => {
    // The whole claim, in the cheapest form: byte identity.
    expect(render("ogre a : C3 size=10ft")).toBe(render("ogre a : C3 size=2"));
  });

  it("and it is two cells, not one", () => {
    // Byte identity alone would also hold if BOTH collapsed to one cell, which
    // is exactly what the defect did. So the radius is asserted outright.
    const two = radii(render("ogre a : C3 size=2"))[0];
    const one = radii(render("ogre a : C3 size=1"))[0];
    expect(radii(render("ogre a : C3 size=10ft"))[0]).toBe(two);
    expect(Number(two)).toBeCloseTo(Number(one) * 2, 6);
  });

  it("the scale is honoured, not assumed", () => {
    // At 10ft cells, 20ft is two cells rather than four.
    expect(render("ogre a : C3 size=20ft", "10ft")).toBe(render("ogre a : C3 size=2", "10ft"));
  });
});

describe("what must not move", () => {
  it("a bare size still means cells — the corpus writes one", () => {
    // `redford-crossing` has `ogre "Gruk" : G9 size=2`. Running a bare number
    // through the measure conversion would make it 2/5 of a cell.
    expect(radii(render("ogre a : C3 size=2"))[0]).toBe(radii(render("ogre a : C3 size=10ft"))[0]);
    expect(render("ogre a : C3 size=2")).not.toBe(render("ogre a : C3 size=1"));
  });

  it("an absent size is one cell", () => {
    expect(render("ogre a : C3")).toBe(render("ogre a : C3 size=1"));
  });
});
