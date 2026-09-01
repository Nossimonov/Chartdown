/**
 * A hidden ford still satisfies the implied-crossing warning (#397).
 *
 * Spec 06 §6 warns when a road crosses water with no ford or bridge, because
 * the render implies one. It read the DRAWN model, so `hidden` stripped the
 * crossing and the warning fired about a crossing the author had declared on
 * the line above. The only edit that silenced it deleted `hidden` and destroyed
 * the secret, and `render` defaults to player mode, so it arrived by default.
 *
 * That is verbatim the shape ADR 0045 fixed for spec 06 §10's six coherence
 * lints — "linting the redaction reported every secret entrance as
 * unreachable-room, unsilenceable, arriving by default, and the one edit that
 * cleared it destroyed the secret." This is the same defect in a §6 warning the
 * ADR's letter did not reach, so the rule is now stated for every diagnostic.
 *
 * The redaction stays fail-closed: nothing here puts a stripped entity on a
 * player's sheet, which the byte-identity test below is what actually proves.
 *
 * Found by an independent review briefed to hunt #301's class.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# Probe", "map: battlemap", "chartdown: 0.1", "grid: square 20x15", "scale: 5ft"];
const BANDS = [
  'river redford "The Redford" : path A9 F9 K9 P10 T10 width=2',
  'road tollroad "Old Toll Road" : path K1 K15',
];
const doc = (...extra: string[]): string => [...HEAD, "", "[terrain]", ...BANDS, ...extra].join("\n");

const NONE = doc();
const HIDDEN = doc('ford f "The Secret Ford" : on redford on tollroad hidden');
const VISIBLE = doc('ford f "The Ford" : on redford on tollroad');

const warnings = (d: string, mode: "gm" | "player"): string[] =>
  renderSource(d, { mode }).diagnostics
    .filter((x) => x.message.includes("with no ford or bridge")).map((x) => x.message);
const svg = (d: string, mode: "gm" | "player"): string => renderSource(d, { mode }).svg;

describe("the declared crossing counts, in either mode", () => {
  it("a hidden ford does not warn — the reported case", () => {
    // Was: clean in gm, warned in player, which is the default.
    expect(warnings(HIDDEN, "player")).toEqual([]);
    expect(warnings(HIDDEN, "gm")).toEqual([]);
  });

  it("and the two modes agree, which is ADR 0045's actual rule", () => {
    for (const d of [NONE, HIDDEN, VISIBLE]) {
      expect(warnings(d, "player")).toEqual(warnings(d, "gm"));
    }
  });
});

describe("the redaction is still fail-closed", () => {
  it("the hidden ford draws NOTHING on the player sheet", () => {
    // The load-bearing assertion: reasoning about a stripped entity must not
    // put it back on the page. Byte identity against a document that never had
    // a ford is the only form of this claim that cannot be fooled.
    expect(svg(HIDDEN, "player")).toBe(svg(NONE, "player"));
  });

  it("while the GM still sees it", () => {
    // Calibration for the assertion above: a ford DOES change the sheet, so
    // the identity test is detecting absence rather than failing to look.
    expect(svg(HIDDEN, "gm")).not.toBe(svg(NONE, "gm"));
    expect(svg(VISIBLE, "player")).not.toBe(svg(NONE, "player"));
  });
});

describe("what must not move", () => {
  it("a genuine missing crossing still warns, in both modes", () => {
    expect(warnings(NONE, "player").join("\n")).toContain("with no ford or bridge");
    expect(warnings(NONE, "gm").join("\n")).toContain("with no ford or bridge");
  });

  it("a visible crossing still silences it", () => {
    expect(warnings(VISIBLE, "player")).toEqual([]);
  });

  it("a VISIBLE crossing is not processed twice", () => {
    // The declared pass must skip what the drawn pass already handled, or a
    // visible crossing is reasoned about once per pass. An ambiguous crossing
    // is where that shows: it reports an error, and reporting it twice in
    // player mode would break the same gm/player agreement this fix restores.
    const ambiguous = [...HEAD, "", "[terrain]",
      'river redford "The Redford" : path A9 T9 width=2',
      'road tollroad "Old Toll Road" : path C1 C12 H12 H1',
      'ford f "The Ford" : on redford on tollroad'].join("\n");
    const errs = (mode: "gm" | "player"): string[] => renderSource(ambiguous, { mode })
      .diagnostics.filter((d) => d.message.includes("is ambiguous")).map((d) => d.message);
    expect(errs("player")).toHaveLength(1);
    expect(errs("player")).toEqual(errs("gm"));
  });

  it("a crossing elsewhere on the river does not silence this one", () => {
    // The suppression is per cell, not per document: a ford at another
    // intersection must not excuse an uncrossed one. Two roads, one forded.
    const twoRoads = [...HEAD, "", "[terrain]", ...BANDS,
      'road byway "The Byway" : path P1 P15',
      'ford f "The Secret Ford" : on redford on tollroad hidden'].join("\n");
    expect(warnings(twoRoads, "player").join("\n")).toContain("The Byway");
    expect(warnings(twoRoads, "player").join("\n")).not.toContain("Old Toll Road");
  });
});
