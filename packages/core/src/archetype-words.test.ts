/**
 * An archetype name is grammar, not a type word (#266, ADR 0039).
 *
 * The nine archetype names were never vocabulary ENTRIES — only ever the target
 * of a binding — so `archetypeOf` returned `null` for them and the word fell
 * through to spec 04 §3's inference as though it were undefined. In a structure
 * detail that inverted the line: `opening : at A1.w` drew a WALL where the
 * document asked for a hole in one, and `check` said nothing.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./parse";
import { ARCHETYPES } from "./vocab";

const errors = (src: string): string[] =>
  parse(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

/** Errors AND warnings: most of what a refused parent used to swallow was a warning. */
const diagnostics = (src: string): string[] => parse(src).diagnostics.map((d) => d.message);

const battlemap = (body: string): string => `map: battlemap
grid: square 30x20

${body}
`;

describe("an archetype name is refused where a type word goes", () => {
  it("refuses the detail line that used to draw the inverse of itself", () => {
    // The #266 report: `arch : at A1.w` cut the wall, `opening : at A1.w` added
    // one, and the two lines name the same archetype at the same edge.
    const [msg] = errors(battlemap(`[structures]
cellar "Cellar" : M14
  opening : at A1.w sight=all`));
    expect(msg).toMatch(/'opening' is an archetype, not a type word/);
  });

  it("names a fix the author can paste", () => {
    const [msg] = errors(battlemap(`[structures]
cellar "Cellar" : M14
  opening : at A1.w`));
    expect(msg).toContain("[vocab] arch : opening");
    expect(msg).toContain("spec 04 §2");
  });

  it("refuses every archetype, on an entity line", () => {
    // Not an `opening` quirk: each of the nine was inert in its own way, and
    // the document below used to check clean.
    for (const word of ARCHETYPES) {
      const [msg] = errors(battlemap(`[features]\n${word} : D4`));
      expect(msg, word).toMatch(new RegExp(`'${word}' is an archetype`));
    }
  });

  it("refuses a [vocab] entry that would shadow an archetype name", () => {
    // The way around the rule: shadowing puts the name back in the entries
    // table, which is the one place `archetypeOf` looks.
    const [msg] = errors(battlemap(`[vocab]
opening : opening

[structures]
cellar "Cellar" : M14
  opening : at A1.w`));
    expect(msg).toMatch(/'opening' is an archetype, not a type word/);
  });

  it("reports one cause once — a refused parent does not also orphan its details", () => {
    // Dropping the entity used to leave the details reporting "no parent
    // entity", which is a second error for a parent that was reported, not
    // missing.
    const msgs = errors(battlemap(`[structures]
structure "Hall" : F4..H6
  door : G6.s
  window : F5.w`));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/'structure' is an archetype/);
  });

  it("still reports a detail line with no entity line above it at all", () => {
    expect(errors(battlemap(`[structures]\n  door : A1.w`)))
      .toEqual(["detail line has no parent entity"]);
  });
});

/**
 * Suppressing the cascade must not suppress the DOCUMENT. A refused parent
 * hides exactly one message — "detail line has no parent entity" — because that
 * one is a consequence of the refusal. Everything a detail line says about its
 * own text is independent of its parent, and hiding it costs the author a
 * second round trip: fix the parent, run again, learn about the child.
 */
describe("a refused parent hides its own cascade and nothing else", () => {
  // Same detail line under a refused parent and a good one. The refused
  // document must report everything the good one does, plus the parent's error.
  const refused = (detail: string): string[] =>
    diagnostics(battlemap(`[structures]\nstructure "Hall" : C3..F6\n  ${detail}`));
  const good = (detail: string): string[] =>
    diagnostics(battlemap(`[structures]\nhall "Hall" : C3..F6\n  ${detail}`));

  it.each([
    ["an out-of-set facet value", "door : C3.s sight=bogus"],
    ["an undeclared state", "door : C3.s wobbly"],
    ["a pair key the word cannot use", "door : C3.s zorp=3"],
    ["a missing colon", "door C3.s"],
    ["a second archetype word", "opening : C3.s"],
  ])("reports %s beneath a refused parent", (_label, detail) => {
    const control = good(detail);
    expect(control.length, "the control must actually diagnose something").toBeGreaterThan(0);
    // The parent's own error, then everything the good parent reported.
    expect(refused(detail)).toEqual([
      expect.stringMatching(/'structure' is an archetype/),
      ...control,
    ]);
  });

  it("suppresses the cascade for a refusal that is not about archetypes", () => {
    // `parseEntityLine` returns null from two places. A missing colon on the
    // entity line is the other one, and its details were silenced too.
    expect(diagnostics(battlemap(`[structures]\nhall "Hall" C3..F6\n  door : C3.s wobbly`))).toEqual([
      "expected 'subject : predicate'",
      expect.stringMatching(/'wobbly' is not a declared state/),
    ]);
  });

  it("does not register an orphaned detail's id", () => {
    // The refused parent's ids never reached the symbol table; the child's must
    // not either, or a later reference resolves to something that never renders.
    const doc = (parent: string): string => battlemap(`[structures]
${parent} : C3..F6
  door d1 : C3.s

[labels]
d1 : at C3`);
    expect(diagnostics(doc(`structure "Hall"`))).toEqual([
      expect.stringMatching(/'structure' is an archetype/),
      "unresolved reference 'd1' — no earlier entity has this id",
    ]);
    // The control: beneath a parent that stands, the id registers as always.
    expect(diagnostics(doc(`hall "Hall"`))).toEqual([]);
  });

  it("stops suppressing at the next entity line", () => {
    expect(diagnostics(battlemap(`[structures]
structure "Hall" : C3..F6
  door : C3.s wobbly
hall2 "Hall Two" : H3..K6
  door : H3.s wobbly`))).toHaveLength(3);
  });
});

describe("what the rule does NOT touch", () => {
  it("leaves an archetype legal on the right of a binding", () => {
    expect(errors(battlemap(`[vocab]
arch : opening sight=all

[structures]
cellar "Cellar" : M14
  arch : at A1.w`))).toEqual([]);
  });

  it("leaves the standard library — ninety words bound to archetypes — alone", () => {
    expect(errors(battlemap(`[structures]
building hall "Hall" : F4..H6
  door : G6.s`))).toEqual([]);
  });

  it("keeps spec 04 §3's promise for words the language has no opinion about", () => {
    // "Unknown words never fail" was never about the nine words the language is
    // made of, and still holds for everything else.
    expect(errors(battlemap(`[features]\nzorbleflax : D4`))).toEqual([]);
  });

  it("does not reach into other namespaces that reuse the spelling", () => {
    // `light` is an archetype-adjacent trap: it is a stdlib FIELD word, and
    // `field` is the archetype. A header key and a field emitter both keep it.
    expect(errors(`map: battlemap
grid: square 30x20
light: dark

[features]
torch : D4 light=20ft
`)).toEqual([]);
  });
});
