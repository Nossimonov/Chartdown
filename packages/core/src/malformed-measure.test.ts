/**
 * A value that is plainly an attempted number, and is not one (#375).
 *
 * `measureToNumber` matches `^(\d+(?:\.\d+)?)` and returns 0 when nothing
 * matches, so a malformed measure was never refused — it became zero and the
 * feature silently disappeared, with `check` reporting `ok`.
 *
 * `.5mi` is the one that will actually happen: half a mile is a normal thing to
 * write, the leading zero is a normal thing to omit, and the river vanished.
 * `1e3` is worse in kind — it parsed `1`, discarded `e3`, and drew SOMETHING,
 * so nothing looked wrong at all.
 *
 * The negative is the one with a consumer-visible consequence: `width=-2` on a
 * battlemap emitted `stroke-width="-54.4"` and `size=-2` emitted `r="-24.32"`,
 * both invalid SVG.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const REGION = ["map: region", "extent: 20x14mi", "", "[water]"];
const river = (w: string): string => `river styx : from (0,12) to (20,13) width=${w}`;

const errorsOn = (line: string, head = REGION): string[] =>
  parse([...head, line].join("\n")).diagnostics
    .filter((d) => d.severity === "error").map((d) => d.message);

const refused = (line: string, head = REGION): boolean =>
  errorsOn(line, head).some((m) => m.includes("is not a measure"));

describe("an attempted number that is not one is refused", () => {
  it("a leading decimal point — the one that will actually happen", () => {
    const msg = errorsOn(river(".5mi")).join("\n");
    expect(msg).toContain("is not a measure");
    expect(msg).toContain("write it as '0.5mi'"); // the fix, not just the complaint
  });

  it("a signed or exponent form", () => {
    expect(errorsOn(river("+2")).join("\n")).toContain("drop the leading '+'");
    expect(errorsOn(river("1e3")).join("\n")).toContain("exponent notation");
  });

  it("a negative, which is what reached the SVG as an invalid attribute", () => {
    const battle = ["map: battlemap", "grid: square 20x15", "scale: 5ft", "", "[terrain]", "earth : area A1..T15"];
    expect(refused("road main : path A8 T8 width=-2", battle)).toBe(true);
    expect(refused("goblin g1 : C3 size=-2", [...battle, "", "[tokens]"])).toBe(true);
    expect(errorsOn(river("-2")).join("\n")).toContain("a magnitude cannot be negative");
  });
});

describe("what stays legal", () => {
  it("well-formed measures, with a unit and without", () => {
    expect(refused(river("1.5mi"))).toBe(false);
    expect(refused(river("1.5"))).toBe(false);
    expect(refused(river("2"))).toBe(false);
  });

  it("values that are words, or shapes that are not measures", () => {
    const battle = ["map: battlemap", "grid: square 20x15", "scale: 5ft", "", "[terrain]",
      "earth : area A1..T15", "", "[tokens]"];
    expect(refused("goblin g : C3 size=2x2", battle)).toBe(false);
    expect(refused("goblin g : C3 side=party", battle)).toBe(false);
  });

  it("a NEGATIVE POINT, which is legitimate and must not be caught", () => {
    // Shape offsets are negative by design — `area (-2,-40)` in spec 05 §4.
    // They are points inside a placement, never a `key=value` pair, which is
    // what makes refusing negative PAIR values safe without a parameter list.
    const doc = ["map: region", "extent: 200x160mi", "", "[water]",
      "coastline coast : from (0,3) to (200,3)", "", "[terrain]",
      'island i "I" : near coast at (40,100) area (-2,-40) (3,-30) (1,-20)'].join("\n");
    expect(parse(doc).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a bare word is NOT caught, and that is the stated limit", () => {
    // `width=abc` and `width=mi` still become 0. They are indistinguishable
    // from `facing=south` without a list of measure-valued parameters, and no
    // such list exists — inventing one would go stale the first time a facet
    // was added. #375 records this rather than pretending it is handled.
    expect(refused(river("abc"))).toBe(false);
    expect(refused(river("mi"))).toBe(false);
  });
});
