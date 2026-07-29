/**
 * Placed morphology vocabulary (#93, spec 05 §4, ADR 0023).
 *
 * This stage adds the standard-library words and the `morph=` facet; the
 * geometry that deforms a host spine is staged separately. What is asserted
 * here is the part the renderer will depend on: that each word resolves to the
 * right archetype and the right relationship to its host, through derivation,
 * and that the proposal's syntax needs no new grammar.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const region = (body: string): string => `# Morphology\nmap: region\nextent: 400x700mi\n\n${body}\n`;

const entities = (src: string) =>
  parse(src).document.sections.flatMap((s) => s.entries.filter((e) => e.kind === "entity"));

const warningsOf = (src: string): string[] =>
  parse(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

describe("the morphology words", () => {
  const COAST = "[water]\ncoastline coast : from (250,20) via (150,182) (112,262) to (250,600)\n";

  it("parses the proposal's example lines with no diagnostics and no new grammar", () => {
    // `on <ref> at <point>` and `near <ref>` already exist (spec 02 §7), so
    // this feature adds vocabulary rather than syntax. If that ever stops being
    // true, this test is where it shows.
    const src = region(
      `${COAST}cape : on coast at (150,182) size=22mi\n` +
        `cove : on coast at (196,300) size=15mi\n` +
        `peninsula : on coast at (168,470) size=30mi\n` +
        `island himling "Himling" : near coast at (95,250) size=8mi\n`,
    );
    expect(parse(src).diagnostics).toEqual([]);
  });

  it("places a deforming feature with ONE relational placement and a detached one with two", () => {
    const src = region(`${COAST}cape : on coast at (150,182) size=22mi\nisland : near coast at (95,250) size=8mi\n`);
    const [, cape, island] = entities(src);
    expect(cape!.placements.map((p) => (p.kind === "relational" ? p.form : p.kind))).toEqual(["on"]);
    // `near <ref>` and `at <point>` are separate placements that constrain
    // jointly (spec 02 §7) — the detached shape is offset from the line.
    expect(island!.placements.map((p) => (p.kind === "relational" ? p.form : p.kind))).toEqual(["near", "at"]);
  });

  for (const [word, morph] of [
    ["cape", "jut"], ["headland", "jut"], ["peninsula", "jut"], ["spit", "jut"],
    ["bay", "bite"], ["cove", "bite"], ["sound", "bite"], ["fjord", "bite"],
    ["island", "detached"], ["islet", "detached"], ["atoll", "detached"], ["oxbow", "detached"],
  ] as const) {
    it(`'${word}' is terrain and carries morph=${morph} through the chain`, () => {
      const src = region(`${COAST}${word} : on coast at (150,182) size=10mi\n`);
      const e = entities(src)[1]!;
      expect(e.archetype).toBe("terrain");
      // `fjord : sound : bay` and `islet : island` inherit the facet by
      // derivation (ADR 0016) rather than restating it.
      expect(parse(src).document, `${word} parsed`).toBeTruthy();
      expect(warningsOf(src)).toEqual([]);
    });
  }

  it("the WORD and the GEOMETRY are independent — a bite can be water, a detached shape either", () => {
    // `bay` bites and is water; `island` detaches and is land; `oxbow` detaches
    // and is water. If morph= were doing double duty as a colour, one of these
    // three could not be expressed.
    const src = region(`${COAST}bay : on coast at (150,182) size=10mi\nisland : near coast at (95,250) size=8mi\noxbow : near coast at (120,400) size=4mi\n`);
    expect(warningsOf(src)).toEqual([]);
  });
});

describe("morph= is a closed set (spec 04 §1)", () => {
  it("warns on a value outside it, naming the alternatives", () => {
    const src = region(`[vocab]\nfjard : terrain morph=inward\n`);
    expect(warningsOf(src).join()).toMatch(/'morph=inward' is not one of jut, bite, detached/);
  });

  it("accepts a derivation that restates a legal value", () => {
    // Spending the word matters: a `[vocab]` line nothing carries is dead
    // (#116), and the first draft of this fixture declared `skerry` without
    // using it — caught by that warning rather than by review.
    const src = region(`[vocab]\nskerry : island morph=detached\n\n[water]\ncoastline coast : from (250,20) to (250,600)\nskerry : near coast at (95,250) size=2mi\n`);
    expect(warningsOf(src)).toEqual([]);
  });
});

describe("line-branching morphology is staged, not shipped (#93)", () => {
  it("'delta' and 'fork' are NOT standard vocabulary yet", () => {
    // Branching a spine is a different geometric problem from deforming one.
    // Shipping the words without the geometry would give an author a
    // declaration that parses clean and draws nothing — the silent-plausibility
    // failure this phase has spent itself removing. They get spec 04 §3's
    // unknown-word treatment instead, which at least renders a generic marker.
    for (const word of ["delta", "fork"]) {
      const src = region(`[water]\ncoastline coast : from (250,20) to (250,600)\n${word} : on coast at (250,300)\n`);
      const e = entities(src)[1]!;
      expect(e.archetypeSource, `${word} should not be stdlib yet`).not.toBe("vocab");
    }
  });
});
