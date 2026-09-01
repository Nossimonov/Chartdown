/**
 * `structure-unsupported` names an edit the author can actually make (#399).
 *
 * On a single-level document there is no level below, so the message
 * interpolated the literal string `(none)`:
 *
 *   this structure stands on 'air' with nothing beneath it on level '(none)'
 *
 * and the remedy it described — put a structure on the level underneath —
 * requires a `levels:` header the document does not have. That is #301's class
 * in a message rather than in a rule: a diagnostic describing a fix for a
 * different kind of document.
 *
 * The warning itself is RIGHT to fire. The author declared the ground unfloored
 * and built on it, and a remedy does exist on a single-level map — declare a
 * solid surface under the footprint. So this changes what the message says, not
 * when it fires.
 *
 * Found by an independent review briefed to hunt #301's class.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const warn = (doc: string): string[] =>
  renderSource(doc, { mode: "gm" }).diagnostics
    .filter((d) => d.message.includes("stands on")).map((d) => d.message);

const SINGLE = ["# T", "map: battlemap", "grid: square 20x15", "scale: 5ft", "",
  "[terrain]", "air : area A1..T15", "", "[structures]", "building hall : D4..H8"].join("\n");

const MULTI = ["# T", "map: battlemap", "grid: square 20x15", "scale: 5ft",
  "levels: upper ground", "", "[terrain upper]", "air : area A1..T15", "",
  "[structures upper]", "building loft : D4..H8"].join("\n");

describe("a single-level document", () => {
  it("still warns — the defect is real", () => {
    expect(warn(SINGLE)).toHaveLength(1);
  });

  it("never prints the placeholder", () => {
    expect(warn(SINGLE)[0]).not.toContain("(none)");
    expect(warn(SINGLE)[0]).not.toContain("undefined");
    expect(warn(SINGLE)[0]).not.toContain("null");
  });

  it("and names an edit that is possible here", () => {
    // Not "put something on the level below", which needs a `levels:` header.
    expect(warn(SINGLE)[0]).toContain("declare a surface beneath its footprint");
    expect(warn(SINGLE)[0]).not.toContain("on level");
  });

  it("the edit it names actually silences it", () => {
    // The strongest form of "the remedy is available": take the advice and
    // check. Terrain declared later wins as the surface word (spec 06 §5).
    const fixed = SINGLE.replace("[structures]", "terrace : area D4..H8\n\n[structures]");
    expect(warn(fixed)).toEqual([]);
  });
});

describe("a multi-level document is unchanged", () => {
  it("still names the level below", () => {
    expect(warn(MULTI)).toHaveLength(1);
    expect(warn(MULTI)[0]).toContain("on level 'ground'");
    expect(warn(MULTI)[0]).toContain("a building on open air");
  });
});

describe("what must not move", () => {
  it("solid ground does not warn at all", () => {
    const solid = SINGLE.replace("air : area A1..T15", "earth : area A1..T15");
    expect(warn(solid)).toEqual([]);
  });

  it("an `open` structure is still exempt — courtyards have sky by design", () => {
    expect(warn(SINGLE.replace("building hall : D4..H8", "building yard : D4..H8 open"))).toEqual([]);
  });
});
