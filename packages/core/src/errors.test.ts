/**
 * Fail-loud coverage: every error rule specs 01–07 define gets a failing
 * input here (issue #21 done-state).
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const errorsOf = (src: string) =>
  parse(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const warningsOf = (src: string) =>
  parse(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

describe("document model (spec 01)", () => {
  it("map: must exist", () => {
    expect(errorsOf("[terrain]\nforest : area A1..B2\n").join()).toMatch(/missing required 'map:'/);
  });

  it("map: must be the first header line", () => {
    expect(errorsOf("scale: 5ft\nmap: battlemap\n").join()).toMatch(/must be the first header line/);
  });

  it("unknown map types error", () => {
    expect(errorsOf("map: dungeon\n").join()).toMatch(/unknown map type 'dungeon'/);
  });

  it("-beta map types are allowed", () => {
    expect(errorsOf("map: starmap-beta\n")).toEqual([]);
  });

  it("unknown header keys warn", () => {
    expect(warningsOf("map: battlemap\nflavor: spicy\n").join()).toMatch(/unknown header key 'flavor'/);
  });

  it("unknown sections warn and x- sections do not", () => {
    const src = "map: battlemap\ngrid: square 4x4\n[wibble]\nx : A1\n";
    expect(warningsOf(src).join()).toMatch(/unknown section \[wibble\]/);
    expect(warningsOf("map: battlemap\n[x-mytool]\nanything : A1\n")).toEqual([]);
  });

  it("a newer chartdown: version warns", () => {
    expect(warningsOf("map: battlemap\nchartdown: 9.9\n").join()).toMatch(/targets spec 9.9/);
  });
});

describe("coordinates and grids (spec 02)", () => {
  it("hex grids must declare orientation and parity", () => {
    expect(errorsOf("map: hexcrawl\ngrid: hex 8x9\n").join()).toMatch(/orientation .* offset parity/);
  });

  it("the relational grammar is closed — bare 'X to Y' without 'from' is rejected", () => {
    const src = 'map: region\nextent: 9x9mi\n[paths]\nroad "Sneaky" : "A" to "B"\n';
    expect(errorsOf(src).join()).toMatch(/misplaced relational keyword 'to'/);
  });

  it("forward references are errors", () => {
    const src = [
      "map: region",
      "extent: 100x100mi",
      "[settlements]",
      'village "Early" : 10mi north of latecomer',
      "[terrain]",
      'hills latecomer "The Late Hills" : blob (50,50) size=10mi',
    ].join("\n");
    expect(errorsOf(src).join()).toMatch(/unresolved reference 'latecomer'/);
  });
});

describe("identity and references (spec 03)", () => {
  it("explicit id collisions are parse-time errors", () => {
    const src = "map: battlemap\ngrid: square 9x9\n[features]\ncrates loot : A1\nchest loot : B2\n";
    expect(errorsOf(src).join()).toMatch(/duplicate explicit id 'loot'/);
  });

  it("anonymous entities are unreferenceable", () => {
    const src = "map: region\nextent: 9x9mi\n[water]\ncoastline : from (1,0) to (1,9)\nsea : west of coastline\n";
    expect(errorsOf(src).join()).toMatch(/unresolved reference 'coastline'/);
  });

  it("ambiguous display-name references are errors", () => {
    const src = [
      "map: region",
      "extent: 100x100mi",
      "[settlements]",
      'village "Edgewood" : (10,10)',
      'village "Edgewood" : (90,90)',
      'hamlet "Nearby" : 5mi north of "Edgewood"',
    ].join("\n");
    expect(errorsOf(src).join()).toMatch(/ambiguous reference "Edgewood"/);
  });

  it("gm attachments must not carry placements", () => {
    const src = "map: battlemap\ngrid: square 9x9\n[features]\ncrates loot : A1\n[gm]\nloot : B5 \"moved it\"\n";
    expect(errorsOf(src).join()).toMatch(/must not contain a placement/);
  });

  it("a [gm] line resolving nothing with no placement is an error (typo hole)", () => {
    const src = "map: battlemap\ngrid: square 9x9\n[features]\ncrates loot : A1\n[gm]\nloto : \"40 gp\"\n";
    expect(errorsOf(src).join()).toMatch(/resolves no existing entity and declares no placement/);
  });

  it("a [gm] line with a placement declares a new gm-only entity", () => {
    const src = "map: battlemap\ngrid: square 9x9\n[gm]\ntrigger ambush : B2..C3 \"springs\"\n";
    expect(errorsOf(src)).toEqual([]);
  });
});

describe("vocabulary (spec 04)", () => {
  it("derivation cycles are errors", () => {
    const src = "map: battlemap\n[vocab]\naa : terrain\nbb : cc\ncc : bb\n";
    expect(errorsOf(src).join()).toMatch(/vocabulary cycle|unknown word/);
  });

  it("self-derivation is a cycle", () => {
    const twoStep = "map: battlemap\n[vocab]\nbb : terrain\ncc : bb\nbb2 : cc\ncc2 : bb2\n";
    expect(errorsOf(twoStep)).toEqual([]);
    const cyclic = "map: battlemap\n[vocab]\nselfish : selfish\n";
    expect(errorsOf(cyclic).join()).toMatch(/derives .*from itself|unknown word/);
  });

  it("derivation bases must already exist", () => {
    expect(errorsOf("map: battlemap\n[vocab]\nglombus : flombus\n").join()).toMatch(/unknown word 'flombus'/);
  });

  it("missing use: libraries warn", () => {
    expect(warningsOf("map: region\nextent: 9x9mi\nuse: vocab/candy.cd\n").join()).toMatch(/library 'vocab\/candy.cd' not provided/);
  });
});

describe("battlemap primitives (spec 06)", () => {
  it("detail lines only attach beneath structures", () => {
    const src = "map: battlemap\ngrid: square 9x9\n[features]\nwagon : B2\n  door : B2.s\n";
    expect(errorsOf(src).join()).toMatch(/only defined beneath structure entities/);
  });
});

describe("labels (spec 07)", () => {
  it("unresolved label overrides are errors, not stray labels", () => {
    const src = 'map: region\nextent: 9x9mi\n[terrain]\nhills "The Downs" : blob (4,4) size=2mi\n[labels]\n"The Duwns" : north\n';
    expect(errorsOf(src).join()).toMatch(/unresolved reference "The Duwns"/);
  });

  it("free text requires the note type word", () => {
    const src = "map: region\nextent: 9x9mi\n[labels]\nnote \"Here be dragons\" : (7,1)\n";
    expect(errorsOf(src)).toEqual([]);
  });

  it("unknown hints are errors", () => {
    const src = 'map: region\nextent: 9x9mi\n[terrain]\nhills "The Downs" : blob (4,4) size=2mi\n[labels]\n"The Downs" : swirling\n';
    expect(errorsOf(src).join()).toMatch(/unknown label hint 'swirling'/);
  });
});
