/**
 * The facet decides whether a barrier occludes, and the word does not (#396).
 *
 * Spec 06 §3 says it outright — "The named barrier's own facets apply, so **the
 * facet decides and the word does not**" — and spec 04 §1 makes `sight=` the
 * thing that "decides whether an edge is a hole in `line_of_sight`".
 *
 * Two code paths answered it differently. The structure-detail path read the
 * facet; the freestanding path tested whether the chain contained the literal
 * word `fence`. So the SAME declaration exported opposite geometry depending on
 * which slot it was written in, and an honest `hedge : barrier sight=all` went
 * to a VTT as a sight-blocking wall. The reverse failed too: an explicit
 * `sight=none` on a fence-derived word was ignored because of its ancestry.
 *
 * Found by an independent review briefed to hunt #301's class.
 */
import { describe, expect, it } from "vitest";
import { exportUvttSource } from "./index";

const HEAD = ["# Probe", "map: battlemap", "chartdown: 0.1", "grid: square 20x15", "scale: 5ft"];

/** line_of_sight segment count for a freestanding barrier on three edges. */
const free = (vocab: string, word: string): number => {
  const doc = [...HEAD, "", ...(vocab ? ["[vocab]", vocab, ""] : []),
    "[structures]", `${word} h1 : D4.n E4.n F4.n`].join("\n");
  const u = (exportUvttSource(doc).uvtt ?? {}) as { line_of_sight?: unknown[] };
  return (u.line_of_sight ?? []).length;
};

/** The same word replacing a room's north side (spec 06 §3, #130). */
const asSide = (vocab: string, word: string): number => {
  const doc = [...HEAD, "", ...(vocab ? ["[vocab]", vocab, ""] : []),
    "[structures]", "building hall : D4..H8", `  ${word} : north`].join("\n");
  const u = (exportUvttSource(doc).uvtt ?? {}) as { line_of_sight?: unknown[] };
  return (u.line_of_sight ?? []).length;
};

describe("a barrier that passes sight does not occlude", () => {
  it("the reported case: a hedge declared with sight=all", () => {
    // Was 3 — the same as a wall.
    expect(free("hedge : barrier sight=all", "hedge")).toBe(0);
  });

  it("and it agrees with the same hedge replacing a room's side", () => {
    // The two paths must give the same answer for the same declaration. Stated
    // as the actual counts, since equality alone would also hold if both were
    // wrong: a plain D4..H8 room exports 20 segments, and a side that passes
    // sight drops that side's 5.
    expect(asSide("", "wall")).toBe(20);
    expect(asSide("hedge : barrier sight=all", "hedge")).toBe(15);
    expect(asSide("fence : barrier sight=all", "fence")).toBe(15);
  });
});

describe("the word is not consulted, in either direction", () => {
  it("an explicit sight=none on a fence-derived word occludes", () => {
    // The reverse of the reported bug: ancestry overrode an explicit facet.
    // A thicket you cannot see through is a normal thing to declare.
    expect(free("thicket : fence sight=none", "thicket")).toBe(3);
  });

  it("a word that is not a fence but passes sight does not occlude", () => {
    expect(free("rope-line : barrier sight=all", "rope-line")).toBe(0);
    expect(free("stakes : pillar sight=all", "stakes")).toBe(0);
  });
});

describe("what must not move", () => {
  it("the stdlib words keep their measured behaviour", () => {
    expect(free("", "wall")).toBe(3);
    expect(free("", "fence")).toBe(0);
    expect(free("", "pillar")).toBe(3);
  });

  it("a word deriving from fence still passes sight without restating it", () => {
    // Inheritance still carries the facet (spec 04 §2) — this must keep working
    // through the facet, not through the word.
    expect(free("palisade : fence", "palisade")).toBe(0);
  });

  it("a barrier that says nothing about sight still occludes", () => {
    // The default is the opposite of an opening's: silence means opaque.
    expect(free("cave-in : barrier", "cave-in")).toBe(3);
  });
});
