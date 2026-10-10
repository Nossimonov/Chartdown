/**
 * Crossing-hood is decided the same way everywhere (#408).
 *
 * ADR 0053 moved crossing-hood off the words `ford` and `bridge`, and #398
 * changed the two gates that were looked for. Two more were not, and both had
 * consequences:
 *
 *   1. The declared-crossing collect pass, written for #397 while crossing-hood
 *      was still word-keyed, so a `hidden` causeway re-opened the very defect
 *      #397 closed — clean in gm, warned in player, silenceable only by
 *      deleting `hidden`.
 *   2. The crossing-chooser arm, so `causeway : on redford at K9` was refused
 *      where the identical line spelled `ford` was allowed — removing the
 *      `at <cell>` disambiguator spec 06 §6 gives crossings.
 *
 * Both now use `declaresOver(model, e) || isCrossingShape(e)`, the same test
 * the render gate uses. The lesson is in the sweep rather than the fix: #407
 * claimed these words had stopped being load-bearing without grepping for
 * them.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# P", "map: battlemap", "chartdown: 0.1", "grid: square 20x15", "scale: 5ft"];
const BANDS = [
  'river redford "R" : path A9 F9 K9 P10 T10 width=2',
  'road tollroad "T" : path K1 K15',
];
const doc = (vocab: string, line: string): string =>
  [...HEAD, "", ...(vocab ? ["[vocab]", vocab, ""] : []), "[terrain]", ...BANDS, line].join("\n");

const crossingWarnings = (vocab: string, line: string, mode: "gm" | "player"): number =>
  renderSource(doc(vocab, line), { mode })
    .diagnostics.filter((d) => d.message.includes("with no crossing")).length;
const errors = (vocab: string, line: string): string[] =>
  renderSource(doc(vocab, line), { mode: "gm" })
    .diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("a hidden crossing is a declared crossing, whatever it is called", () => {
  for (const [name, vocab] of [
    ["a stdlib ford", ""],
    ["a causeway with the default over=", "causeway : feature"],
    ["a causeway that declares over=water", "causeway : feature over=water"],
    ["a derived word", "culvert : ford"],
  ] as const) {
    it(name, () => {
      const word = vocab ? vocab.split(" ")[0]! : "ford";
      const line = `${word} x1 "X" : on redford on tollroad hidden`;
      expect(crossingWarnings(vocab, line, "player")).toBe(0);
      expect(crossingWarnings(vocab, line, "gm")).toBe(0);
    });
  }

  it("and an uncrossed overlap still warns in both modes", () => {
    // Calibration: the warning still fires, so the zeros above mean the
    // crossing was counted rather than the check being switched off.
    const bare = [...HEAD, "", "[terrain]", ...BANDS].join("\n");
    for (const mode of ["gm", "player"] as const) {
      expect(renderSource(bare, { mode }).diagnostics
        .filter((d) => d.message.includes("with no crossing"))).toHaveLength(1);
    }
  });
});

describe("`on <path> at <cell>` chooses among intersections, for any crossing", () => {
  it("a stdlib ford, as before", () => {
    expect(errors("", 'ford f1 "F" : on redford at K9')).toEqual([]);
  });

  it("and a causeway, which was refused", () => {
    // Was: "'on redford at K9' needs a structure footprint to place against".
    expect(errors("causeway : feature over=path", 'causeway c1 "C" : on redford at K9')).toEqual([]);
  });

  it("the AMBIGUITY REMEDY works — spec 06 §6's `at <cell>` chooses", () => {
    // A regression #407 shipped to preview: `isCrossingShape` counted only
    // BARE `on` refs, and the disambiguator hangs `at` off the second one. So
    // the ambiguity error said "add 'at <cell>' to choose" and doing exactly
    // that produced a different error. Two intersections, one chosen:
    const twice = [...HEAD, "", "[vocab]", "causeway : feature", "", "[terrain]",
      'river redford "R" : path A9 T9 width=2',
      'road tollroad "T" : path C1 C12 H12 H1',
      'causeway c1 "C" : on redford on tollroad at C9'].join("\n");
    expect(renderSource(twice, { mode: "gm" }).diagnostics
      .filter((d) => d.severity === "error")).toEqual([]);
  });

  it("and it is still ambiguous WITHOUT the `at`", () => {
    // Calibration: the remedy above is answering a real ambiguity.
    const twice = [...HEAD, "", "[terrain]",
      'river redford "R" : path A9 T9 width=2',
      'road tollroad "T" : path C1 C12 H12 H1',
      'ford f1 "F" : on redford on tollroad'].join("\n");
    expect(renderSource(twice, { mode: "gm" }).diagnostics
      .map((d) => d.message).join("\n")).toContain("is ambiguous");
  });
});

describe("what must not move", () => {
  it("an ordinary feature on a path is still refused", () => {
    // The arm exists because a path's frame is the document grid for a
    // CROSSING. It must not become a general exemption.
    const msg = errors("statue : feature", 'statue s1 "S" : on redford at K9').join("\n");
    expect(msg).toContain("needs a structure footprint");
  });

  it("a hidden crossing still draws nothing for players", () => {
    // #397's load-bearing property: reasoning about a stripped entity must not
    // put it back on the page.
    const hidden = doc("causeway : feature", 'causeway c1 "C" : on redford on tollroad hidden');
    const absent = doc("causeway : feature", "");
    expect(renderSource(hidden, { mode: "player" }).svg).toBe(renderSource(absent, { mode: "player" }).svg);
    expect(renderSource(hidden, { mode: "gm" }).svg).not.toBe(renderSource(absent, { mode: "gm" }).svg);
  });
});
