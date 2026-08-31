/**
 * An explicit unit must be the map's own (#376).
 *
 * Spec 02 §1: "Explicit units (`70mi`, `20ft`) are always legal and MUST match
 * the map's unit dimension." `grammar.ebnf:235` says the same in a
 * parenthetical. Nothing implemented either: `measureToNumber` reads the digits
 * and discards the unit, so on a `20x14mi` map `width=60ft` drew a stroke
 * THREE TIMES the width of the map — a 5280x error, in silence — and
 * `width=1.5km` drew exactly what `width=1.5mi` drew.
 *
 * #367 made this reachable rather than causing it: before, a unit-suffixed
 * width was NaN and drew nothing. Loud garbage replaced quiet garbage, and this
 * replaces both.
 *
 * Refusing rather than converting is the owner's ruling. A closed unit table is
 * unavoidable either way — `furlongs` must be rejected regardless — and refusal
 * needs no table.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const REGION = ["map: region", "extent: 20x14mi", "", "[water]"];
const BATTLE = ["map: battlemap", "grid: square 20x15", "scale: 5ft", "", "[terrain]", "earth : area A1..T15"];

const errorsOn = (head: string[], line: string): string[] =>
  parse([...head, line].join("\n")).diagnostics
    .filter((d) => d.severity === "error").map((d) => d.message);

const refused = (head: string[], line: string): boolean =>
  errorsOn(head, line).some((m) => m.includes("an explicit unit must be the map's own"));

describe("a mismatched unit is refused", () => {
  it("feet on a map measured in miles", () => {
    const msg = errorsOn(REGION, "river styx : from (0,12) to (20,13) width=60ft").join("\n");
    expect(msg).toContain("is in ft, and this map is in mi");
    // Both ways out, because the author's next move is one or the other.
    expect(msg).toContain("Write it in mi");
    expect(msg).toContain("drop the unit");
    expect(msg).toContain("spec 02 §1");
  });

  it("miles on a map measured in feet", () => {
    expect(refused(BATTLE, "road main : path A8 T8 width=1mi")).toBe(true);
    expect(refused(BATTLE, "lantern l : C3 light=20mi")).toBe(true);
  });

  it("a unit the language never defined", () => {
    // The same check, from the other side: `furlongs` is not the map's unit,
    // so it needs no separate list of known units to be caught.
    expect(refused(REGION, "river styx : from (0,12) to (20,13) width=3furlongs")).toBe(true);
    expect(refused(REGION, "river styx : from (0,12) to (20,13) width=1.5km")).toBe(true);
  });
});

describe("what stays legal", () => {
  it("the map's own unit, on either map kind", () => {
    expect(refused(REGION, "river styx : from (0,12) to (20,13) width=1.5mi")).toBe(false);
    expect(refused(BATTLE, "road main : path A8 T8 width=15ft")).toBe(false);
    expect(refused(BATTLE, "lantern l : C3 light=20ft")).toBe(false);
  });

  it("a bare number, which means the map's unit by definition", () => {
    expect(refused(REGION, "river styx : from (0,12) to (20,13) width=1.5")).toBe(false);
    expect(refused(BATTLE, "road main : path A8 T8 width=3")).toBe(false);
  });

  it("a map that declares no unit has nothing to disagree with", () => {
    // `extent: 800x600` and `scale: 5` are both grammar-legal.
    const noUnit = ["map: region", "extent: 800x600", "", "[water]"];
    expect(refused(noUnit, "river styx : from (0,12) to (20,13) width=60ft")).toBe(false);
  });

  it("values that are not measures at all", () => {
    // Scoped by the VALUE's shape, so these must not be mistaken for one.
    expect(refused(BATTLE, "door d : on hall at C3.s facing=south")).toBe(false);
    expect(refused(BATTLE, "goblin g : C3 size=2x2")).toBe(false);
    expect(refused(BATTLE, "room r : A1..B2 detail=inner.cd detail-at=A1")).toBe(false);
  });
});
