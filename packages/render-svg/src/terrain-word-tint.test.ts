/**
 * An unknown terrain word takes a deterministic tint (#427).
 *
 * Every known terrain word is in the built-in theme, so the neutral fallback
 * was reached only by a word the language has never seen — and those all came
 * out the same grey. An author sketching a settlement writes `houses`,
 * `garden`, `plaza`, `graveyard` and got four identical rectangles, in the case
 * where telling them apart matters most.
 *
 * Unknown FEATURE words have always taken `wordTint`, and so have realms.
 * Terrain was the one archetype that did not. Spec 04 §3 promises an unknown
 * word works; four indistinguishable blocks is working the way an empty page is
 * working. Filed as a question because no spec sentence promised otherwise, and
 * the maintainer ruled for consistency.
 *
 * Found by a dogfooding pass, which hedged it correctly — "that may be intended
 * for underived words, though."
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# T", "map: battlemap", "chartdown: 0.1", "grid: square 20x8", "scale: 5ft"];
const svg = (...lines: string[]): string =>
  renderSource([...HEAD, "", "[terrain]", ...lines].join("\n"), { mode: "gm" }).svg;
const fillsOf = (s: string): string[] =>
  [...s.matchAll(/fill="(hsl\([^)]*\)|#[0-9a-f]{6})"/g)].map((m) => m[1]!);

const SETTLEMENT = ["houses h : area B2..D4", "garden g : area F2..H4", "plaza p : area J2..L4", "graveyard y : area N2..P4"];

describe("the reported case", () => {
  it("four unknown words get four different tints, not one grey", () => {
    const tints = fillsOf(svg(...SETTLEMENT)).filter((f) => f.startsWith("hsl("));
    expect(tints).toHaveLength(4);
    expect(new Set(tints).size).toBe(4);
  });

  it("and none of them is the old neutral", () => {
    expect(svg(...SETTLEMENT)).not.toContain("#d8d3c5");
  });
});

describe("the tint behaves as it does for features and realms", () => {
  it("same word, same colour, every time", () => {
    const twice = svg("houses a : area B2..D4", "houses b : area F2..H4");
    const tints = fillsOf(twice).filter((f) => f.startsWith("hsl("));
    expect(tints).toHaveLength(2);
    expect(tints[0]).toBe(tints[1]);
  });

  it("a derived family shares its base's tint", () => {
    // `wordTint` hashes the chain's BASE word, so a setting can derive freely.
    // The base must already exist (spec 04 §2), so it is declared here — and
    // being declared does not make it themed, so both still tint.
    const derived = renderSource([...HEAD, "", "[vocab]", "houses : terrain", "almshouses : houses", "",
      "[terrain]", "houses a : area B2..D4", "almshouses b : area F2..H4"].join("\n"), { mode: "gm" }).svg;
    const tints = fillsOf(derived).filter((f) => f.startsWith("hsl("));
    expect(tints).toHaveLength(2);
    expect(tints[0]).toBe(tints[1]);
  });
});

describe("what must not move", () => {
  it("a known terrain word keeps its theme fill", () => {
    const known = svg("grass g : area B2..D4", "mud m : area F2..H4");
    expect(known).toContain("#dde5b8"); // grass
    expect(known).toContain("#c8b294"); // mud
    expect(fillsOf(known).filter((f) => f.startsWith("hsl("))).toEqual([]);
  });

  it("a theme still wins over the tint", () => {
    const themed = renderSource([...HEAD, "", "[terrain]", "houses h : area B2..D4"].join("\n"),
      { mode: "gm", theme: ["kind: theme", "", "[theme]", "houses : fill=#112233"].join("\n") }).svg;
    expect(themed).toContain("#112233");
    expect(fillsOf(themed).filter((f) => f.startsWith("hsl("))).toEqual([]);
  });

  it("a BORDER state does not take a terrain tint", () => {
    // `region.ts` asked `terrainFill([state])` for "theme, else neutral" — a
    // borrowed fallback that would have given every unstyled border state a
    // hash hue. A political boundary's default is deliberate.
    const region = ["# R", "map: region", "extent: 800x600mi", "",
      "[water]", "coastline coast : from (210,0) to (140,600)", "",
      "[terrain]", 'mountains "Spine" : ridge (700,60) (690,530) width=60mi', "",
      "[realms]", 'realm a "A" : west of "Spine"', 'realm b "B" : east of "Spine"',
      "border : a b contested"].join("\n");
    const out = renderSource(region, { mode: "gm" }).svg;
    expect(out).toContain("#d8d3c5");
  });
});
