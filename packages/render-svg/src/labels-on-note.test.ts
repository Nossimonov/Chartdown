/**
 * `labelsOn` matches `note` through the chain, not the literal word (#400).
 *
 * `note` is in spec 04 §2's load-bearing table, and ADR 0016 makes matching a
 * load-bearing word on its literal spelling non-conforming. `labelsOn` did
 * exactly that.
 *
 * NOTHING OBSERVES THE DIFFERENCE TODAY, and the honest framing matters here:
 * this is not a bug report, it is a dead literal. The only caller that passes
 * `e` is `region.ts`'s label pass, and the note branch there returns before
 * reaching this call, so the comparison never decided anything. It was worth
 * changing precisely because it is invisible — the next caller to pass `e`
 * would have inherited a silent non-conformance with nothing to catch it.
 *
 * That also dictates the shape of this test. There is no document whose render
 * changes, so asserting on rendered output would prove nothing and would look
 * like coverage. The function is exported and pure, so it is tested directly.
 *
 * Found by an independent review briefed to hunt #301's class.
 */
import { describe, expect, it } from "vitest";
import { parse } from "@chartdown/core";
import { buildModel, labelsOn } from "./model";
import { Theme } from "./theme";

const model = (labels: string, ...vocab: string[]) =>
  buildModel(parse([
    "# T", "map: battlemap", "grid: square 10x10", "scale: 5ft", `labels: ${labels}`,
    ...(vocab.length ? ["", "[vocab]", ...vocab] : []),
  ].join("\n")).document, "gm", new Theme(), []);

describe("under `labels: none`, free text still renders", () => {
  it("the stdlib word", () => {
    expect(labelsOn(model("none"), { typeWord: "note" })).toBe(true);
  });

  it("a DERIVED word — the point of the change", () => {
    // `waypoint : note` is free text, per spec 04 §2 and ADR 0016. The literal
    // comparison said no.
    expect(labelsOn(model("none", "waypoint : note"), { typeWord: "waypoint" })).toBe(true);
  });

  it("and a word derived at two removes", () => {
    expect(labelsOn(model("none", "waypoint : note", "marker : waypoint"), { typeWord: "marker" })).toBe(true);
  });
});

describe("what must not move", () => {
  it("an ordinary word is still silenced by `labels: none`", () => {
    expect(labelsOn(model("none"), { typeWord: "table" })).toBe(false);
    expect(labelsOn(model("none"), { typeWord: "building" })).toBe(false);
  });

  it("no entity at all is still silenced", () => {
    // The `e === undefined` call is the common one — most callers pass nothing.
    expect(labelsOn(model("none"))).toBe(false);
    expect(labelsOn(model("none"), {})).toBe(false);
    expect(labelsOn(model("none"), { typeWord: null })).toBe(false);
  });

  it("every word renders when labels are on", () => {
    for (const mode of ["names", "keyed"]) {
      expect(labelsOn(model(mode), { typeWord: "table" }), mode).toBe(true);
      expect(labelsOn(model(mode)), mode).toBe(true);
    }
  });
});
