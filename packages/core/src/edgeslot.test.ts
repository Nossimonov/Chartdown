/**
 * Where an edge token may be written, and what a corner means (#281, ADR 0043).
 *
 * Spec 02 §5 makes two forms addressable and gives one of them a job: "walls,
 * doors, and windows live on cell EDGES". Nothing consumes a corner, and
 * nothing said so — so the renderer answered by accident, silently, in two
 * directions at once. `edgeSegment` switched on n/s/w and returned the east
 * edge from `default:`, so `"e"` was served by the fallthrough and all four
 * corners rode along with it: a door at `C3.nw` opened on the far wall of its
 * room. Meanwhile a feature, token or terrain on an edge was never looked at
 * by any placement path, so the line rendered byte-identically to a document
 * that never had it.
 *
 * The legal consumers are pinned beside every refusal, because the risk in
 * closing a slot is closing it too far — a freestanding barrier taking edge
 * tokens is spec 02 §5's own worked example.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const doc = (section: string, ...lines: string[]): string =>
  ["map: battlemap", "grid: square 8x6", "scale: 5ft", "",
   "[terrain]", "earth rock : area A1..H3", "",
   `[${section}]`, ...lines].join("\n");

const errorsOf = (src: string): string[] =>
  parse(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("a corner is refused wherever it is written", () => {
  for (const [where, src] of [
    ["a feature", doc("features", "statue s1 : C3.nw")],
    ["a token", doc("tokens", "goblin g1 : C3.se")],
    ["a freestanding barrier", doc("structures", "wall w1 : C3.ne")],
    ["a structure detail", doc("structures", "building cellar : A1..B2", "  door : at A1.sw")],
    ["free text", doc("labels", 'note "x" : at C3.nw')],
  ] as const) {
    it(`${where} — reported`, () => {
      const found = errorsOf(src);
      expect(found.length).toBeGreaterThan(0);
      expect(found.join(" ")).toMatch(/names a corner/);
      expect(found.join(" ")).toMatch(/spec 02 §5/);
    });
  }

  it("names the four directions that do work", () => {
    // A refusal that does not say what to write instead is half a diagnostic.
    expect(errorsOf(doc("structures", "wall w1 : C3.nw"))[0]).toMatch(/n, e, s or w/);
  });

  it("catches all four corners, not just the one that was reported", () => {
    for (const dir of ["ne", "nw", "se", "sw"]) {
      expect(errorsOf(doc("structures", `wall w1 : C3.${dir}`)).join(" "), dir).toMatch(/names a corner/);
    }
  });
});

describe("an edge token places a wall, a door or a window", () => {
  it("a freestanding barrier takes edge tokens — spec 02 §5's own example", () => {
    expect(errorsOf(doc("structures", "wall w1 : C3.e C4.e"))).toEqual([]);
  });

  it("a barrier on a single edge is fine", () => {
    expect(errorsOf(doc("structures", "fence f1 : C3.n"))).toEqual([]);
  });

  it("an opening in unbuilt geometry keeps its edge (spec 06 §3)", () => {
    // No parent structure: the rock is the barrier and the opening perforates
    // it. Refusing edges by archetype must not take this with it.
    expect(errorsOf(doc("structures", "door adit : C3.s"))).toEqual([]);
  });

  it("a structure detail keeps its edge", () => {
    expect(errorsOf(doc("structures", "building cellar : A1..B2", "  door : at A1.n"))).toEqual([]);
  });
});

describe("an edge token on anything else is refused, not dropped", () => {
  for (const [where, src] of [
    ["a feature", doc("features", "statue s1 : C3.n")],
    ["a token", doc("tokens", "goblin g1 : C3.n")],
    ["terrain", doc("terrain", "pond p1 : C3.n")],
  ] as const) {
    it(`${where} — reported`, () => {
      const found = errorsOf(src);
      expect(found.length).toBeGreaterThan(0);
      expect(found.join(" ")).toMatch(/edge token places a wall, door or window/);
    });
  }

  it("names the cell to write instead", () => {
    // The author almost always meant the cell, so the message hands it to them.
    expect(errorsOf(doc("features", "statue s1 : C3.n"))[0]).toMatch(/place it on the cell instead: 'C3'/);
  });

  it("leaves the ordinary cell placement alone", () => {
    expect(errorsOf(doc("features", "statue s1 : C3"))).toEqual([]);
  });
});
