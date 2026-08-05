/**
 * Dead `[vocab]` declarations (#116, ADR 0022). Spec 04 §3's "unknown words
 * never fail" protects an author who never promised anything; it was being read
 * as covering an author who promised something and got nothing, which is a
 * different thing. Each positive is paired with the near-identical document
 * where the word IS spent, since the value of the warning is entirely in
 * telling those two apart.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const dead = (src: string): string[] =>
  parse(src).diagnostics
    .filter((d) => d.severity === "warning" && d.message.includes("declared here and never used"))
    .map((d) => d.message);

const map = (body: string): string => `# Dead vocab\n\nmap: battlemap\ngrid: square 12x10\nscale: 5ft\n\n${body}\n`;

describe("a word declared and never spent", () => {
  it("warns, naming the word", () => {
    expect(dead(map(`[vocab]\nportcullis : barrier\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s`)).join()).toMatch(/'portcullis' is declared here and never used/);
  });

  it("is silent when an entity carries it", () => {
    expect(dead(map(`[vocab]\nportcullis : barrier\n\n[structures]\nbuilding hall : C3..F6\n  portcullis : east`))).toEqual([]);
  });

  it("is silent when another word derives from it", () => {
    // Spending a word by BUILDING ON IT is spending it. A base declared only to
    // be derived from is the ordinary shape of a two-step vocabulary.
    expect(dead(map(`[vocab]\nportcullis : barrier\niron-portcullis : portcullis\n\n[structures]\nbuilding hall : C3..F6\n  iron-portcullis : east`))).toEqual([]);
  });

  it("still warns for the derived word when nothing carries it", () => {
    const out = dead(map(`[vocab]\nportcullis : barrier\niron-portcullis : portcullis\n\n[structures]\nbuilding hall : C3..F6\n  portcullis : east`));
    expect(out.join()).toMatch(/'iron-portcullis'/);
    expect(out.join()).not.toMatch(/'portcullis' is/);
  });

  it("is silent when a detail line carries it", () => {
    expect(dead(map(`[vocab]\nhatch : opening\n\n[structures]\nbuilding hall : C3..F6\n  hatch : D6.s`))).toEqual([]);
  });

  it("is silent for a field word spent by a header", () => {
    // `light : field` is spent by `light: dim` in the header, not by any
    // entity — an ambient is declared once and set once (spec 04 §5).
    const src = `# Dead vocab\n\nmap: battlemap\ngrid: square 12x10\nscale: 5ft\nlight: dim\n\n[vocab]\nlight : field states=dim,dark\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s\n`;
    expect(dead(src)).toEqual([]);
  });

  it("is silent for a field word spent by an EMITTER (#268)", () => {
    // The other half of the case above, and the affordance the archetype exists
    // for. Only the ambient was credited, so a field used exactly as spec 04 §5
    // says to use it was reported dead — and the advice was unfollowable, since
    // the only way to stop carrying the word was to delete the declaration that
    // makes the emitter mean anything.
    expect(dead(map(`[vocab]\nsilence : field\n\n[features]\nbell b1 : D4 silence=30ft`))).toEqual([]);
  });

  it("is silent for a DERIVED field spent by an emitter", () => {
    // Derivation carries the archetype (spec 04 §2), so `hush` is a field and
    // its name is a parameter too.
    expect(dead(map(`[vocab]\nsilence : field\nhush : silence\n\n[features]\nchime c1 : E4 silence=5ft hush=10ft`))).toEqual([]);
  });

  it("still warns on a field declared and never emitted or set", () => {
    expect(dead(map(`[vocab]\nsilence : field\n\n[features]\nbell b1 : D4`)).join())
      .toMatch(/'silence' is declared here and never used/);
  });

  it("does not credit a pair key that merely collides with a declared word", () => {
    // Restricted to fields on purpose: `size=` is a reserved parameter on every
    // token, and a document declaring the word `size` has not thereby used it.
    expect(dead(map(`[vocab]\nsize : feature\n\n[tokens]\ngoblin g1 : D4 size=2`)).join())
      .toMatch(/'size' is declared here and never used/);
  });

  it("counts an emitter on a structure DETAIL line", () => {
    expect(dead(map(`[vocab]\nsilence : field\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s silence=5ft`))).toEqual([]);
  });
});

describe("scope (ADR 0022)", () => {
  it("says nothing about a vocabulary DOCUMENT's own words — they are its product", () => {
    const library = `kind: vocabulary\n\n[vocab]\nportcullis : barrier\nmurder-hole : opening\n`;
    expect(dead(library)).toEqual([]);
  });

  it("says nothing about words a use:-imported library declares and this map does not spend", () => {
    // A library exists to offer more words than any one map spends, which is
    // the same reason an inherited theme is exempt on the theme side.
    const library = `kind: vocabulary\n\n[vocab]\nportcullis : barrier\nmurder-hole : opening\n`;
    const src = `# Dead vocab\n\nmap: battlemap\ngrid: square 12x10\nscale: 5ft\nuse: keep\n\n[structures]\nbuilding hall : C3..F6\n  portcullis : east\n`;
    const result = parse(src, { libraries: { keep: library } });
    // Guard the guard: without the library actually landing this asserts nothing.
    expect(result.document.importedVocab.map((v) => v.word)).toEqual(["portcullis", "murder-hole"]);
    expect(result.diagnostics.filter((d) => d.message.includes("never used"))).toEqual([]);
  });
});
