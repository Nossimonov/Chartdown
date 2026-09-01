/**
 * A crossing takes its colours from its own chain, and never from its
 * archetype (#409).
 *
 * The last site that decided anything about a crossing by naming `ford` or
 * `bridge` was a slice on the theme chain:
 *
 *   const stop = chain.findIndex((w) => w === "ford" || w === "bridge");
 *   const xingChain = stop >= 0 ? chain.slice(0, stop + 1) : chain;
 *
 * Its stated purpose was real — walking down to `feature` once repainted every
 * ford from the water colour to the generic tint — but it had stopped doing
 * anything. `VocabTable.chain` stops BEFORE the archetype, so a chain holds
 * only vocabulary words, and a crossing word is always last in its own chain
 * (nothing derives from an archetype-based word and then continues past it).
 * The slice therefore always kept the whole chain. Measured: removing it left
 * all nine corpus documents byte-identical and 1227 tests passing.
 *
 * So this file does not test the slice. It tests the INVARIANT that made the
 * slice unnecessary, because if `chain` ever grows an archetype the repaint
 * comes back and nothing else would notice.
 */
import { describe, expect, it } from "vitest";
import { parse } from "@chartdown/core";
import { renderSource } from "./index";
import { buildModel } from "./model";
import { Theme } from "./theme";

const HEAD = ["# P", "map: battlemap", "chartdown: 0.1", "grid: square 20x15", "scale: 5ft"];
const BANDS = [
  'river redford "R" : path A9 F9 K9 P10 T10 width=2',
  'road tollroad "T" : path K1 K15',
];
const THEME = ["kind: theme", "", "[theme]", "ford : fill=#8b5a2b"].join("\n");

const svg = (vocab: string, word: string, theme?: string): string =>
  renderSource([...HEAD, "", ...(vocab ? ["[vocab]", vocab, ""] : []), "[terrain]", ...BANDS,
    `${word} x1 "X" : on redford on tollroad`].join("\n"), { mode: "gm", ...(theme ? { theme } : {}) }).svg;

describe("the invariant the removal rests on", () => {
  it("a derivation chain never contains an archetype", () => {
    // This is the guard. `Theme.prop` walks exactly the chain it is handed,
    // with no archetype fallback, so a chain that stops short of the archetype
    // is what keeps `feature`'s generic tint away from a ford.
    const model = buildModel(parse([...HEAD, "", "[vocab]",
      "stepping-stones : ford", "planks : stepping-stones", "causeway : feature over=path",
    ].join("\n")).document, "gm", new Theme(), []);
    const ARCHETYPES = ["terrain", "path", "feature", "structure", "barrier", "opening", "token", "zone", "field"];
    for (const word of ["ford", "bridge", "stepping-stones", "planks", "causeway", "river", "wall"]) {
      const chain = model.chainOf(word);
      expect(chain, word).not.toHaveLength(0);
      for (const a of ARCHETYPES) expect(chain, `${word} -> ${chain.join(",")}`).not.toContain(a);
    }
  });

  it("and a crossing word is last in its own chain", () => {
    // The other half of why the slice kept everything: `slice(0, stop + 1)`
    // with `stop` at the end is the whole array.
    const model = buildModel(parse([...HEAD, "", "[vocab]",
      "stepping-stones : ford", "planks : stepping-stones",
    ].join("\n")).document, "gm", new Theme(), []);
    for (const word of ["ford", "stepping-stones", "planks"]) {
      expect(model.chainOf(word).at(-1), word).toBe("ford");
    }
  });
});

describe("theming still resolves the way ADR 0016 requires", () => {
  it("a themed `ford` entry reaches a ford", () => {
    expect(svg("", "ford", THEME)).toContain("#8b5a2b");
  });

  it("and reaches a word derived from it, at any depth", () => {
    expect(svg("stepping-stones : ford", "stepping-stones", THEME)).toContain("#8b5a2b");
    expect(svg("stepping-stones : ford\nplanks : stepping-stones", "planks", THEME)).toContain("#8b5a2b");
  });

  it("but not an unrelated crossing word", () => {
    // `causeway` is a crossing by `over=`, not by deriving from `ford`, so a
    // `ford` theme entry is none of its business.
    expect(svg("causeway : feature over=water", "causeway", THEME)).not.toContain("#8b5a2b");
  });
});

describe("what must not move", () => {
  it("an unthemed ford keeps the colour it has", () => {
    // Pinned rather than reasoned about. The removed comment warned that
    // walking to the archetype "repainted every existing ford ... to #cfd4b8",
    // but #cfd4b8 is what a ford renders TODAY — so that sentence describes a
    // default that has since changed, and asserting against it would have been
    // testing the comment rather than the code. What matters is that removing
    // the slice moved nothing, which the corpus comparison showed directly;
    // this pins the colour so a future change to it is deliberate.
    expect(svg("", "ford")).toContain("#cfd4b8");
    expect(svg("", "ford")).not.toContain("#a8763e"); // and it is not a deck
  });

  it("a bridge still draws its deck", () => {
    expect(svg("", "bridge")).toContain("#a8763e");
  });
});
