/**
 * An `at` that frames nothing is refused (#368).
 *
 * `chartdown frame` turns a traced outline into offsets and prints
 * `at (10,8) area (-6,-3.5) …`. Spec 05 §4's worked line is
 * `island whidbey : near shore at (40,100) area (…)`, and it is the RELATION
 * that gives `at` a frame for those offsets to be measured in. Pasted bare, as
 * the CLI's own output invites, the offsets are read as absolute coordinates —
 * so a negative one lands off-canvas at -246,-143.5 and `check` says nothing.
 *
 * The reporter found this drafting a real map, followed the CLI's output
 * exactly, and lost a marsh into the north-west corner.
 *
 * What is NOT refused matters as much as what is: the first version of this
 * check also rejected `blob at (200,150) size=120mi`, and the existing suite
 * caught it. A sized blob has no points of its own (ADR 0025 — "a blob declares
 * an extent, not an outline"), so there the `at` is the placement and is doing
 * the entire job.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const REGION = ["map: region", "extent: 200x160mi", "", "[water]",
  "coastline coast : from (0,3) to (200,3)", "", "[terrain]"];

const errorsOn = (line: string): string[] =>
  parse([...REGION, line].join("\n")).diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.message);

const framesNothing = (line: string): boolean =>
  errorsOn(line).some((m) => m.includes("frames nothing"));

describe("an anchor with no frame is refused", () => {
  it("the CLI's own fragment, pasted bare", () => {
    const msg = errorsOn('marsh m1 "Blob" : at (10,8) area (-6,-3.5) (3,-3.8) (6,3) (-5.5,3)');
    expect(msg.join("\n")).toContain("frames nothing");
    // The diagnostic has to say both ways out, because the author's next move
    // is either "add the relation I forgot" or "these were absolute all along".
    expect(msg.join("\n")).toContain("near <ref> at (x,y)");
    expect(msg.join("\n")).toContain("absolute points");
    expect(msg.join("\n")).toContain("spec 05 §4");
  });

  it("every shape kind that carries points", () => {
    for (const shape of ["area", "path", "ridge"]) {
      expect(framesNothing(`marsh m2 "B" : at (10,8) ${shape} (-6,-3.5) (3,-3.8) (6,3)`), shape).toBe(true);
    }
  });
});

describe("the forms the spec defines are untouched", () => {
  it("spec 05 §4's own worked line", () => {
    expect(framesNothing('island whidbey "Whidbey Island" : near coast at (40,100) area (-2,-40) (3,-30) (1,-20)')).toBe(false);
  });

  it("a referent frame via `on`", () => {
    expect(framesNothing('island i2 "J" : on coast at (40,100) area (-2,-40) (3,-30) (1,-20)')).toBe(false);
  });

  it("a SIZED blob, which has no points and needs its at (ADR 0025)", () => {
    // The case the first version of this check wrongly refused.
    expect(framesNothing("forest wood : blob at (200,150) size=120mi")).toBe(false);
  });

  it("a shape with absolute points and no anchor at all", () => {
    expect(framesNothing('marsh m3 "C" : area (4,4) (13,4) (16,11)')).toBe(false);
  });

  it("a bare `at` placing something with no shape", () => {
    expect(framesNothing('city c1 "C" : at (10,8)')).toBe(false);
  });
});
