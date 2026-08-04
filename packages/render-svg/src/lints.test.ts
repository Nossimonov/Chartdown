/**
 * Coherence lints (#123). Each lint gets a POSITIVE — a document that means the
 * defect — and a NEGATIVE that is a legitimate reading of nearly the same
 * geometry. The negatives are the point: every one of them is a false positive
 * this lint actually produced against work already shipped, and the pairs exist
 * so that tightening one lint cannot quietly re-break the reading beside it.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const warnings = (src: string): string[] =>
  renderSource(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

const has = (src: string, needle: string): boolean => warnings(src).some((m) => m.includes(needle));

const map = (body: string): string => `# Lint fixture\n\nmap: battlemap\ngrid: square 20x20\nscale: 5ft\n\n${body}\n`;

describe("1 — door-onto-void", () => {
  const VOID = "leads out onto ground that cannot be walked on";

  it("warns when a door opens onto declared air", () => {
    expect(has(map(`[terrain]\nair : area A1..T20\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s`), VOID)).toBe(true);
  });

  it("is silent for a door between two rooms over the same air", () => {
    // The blanket `air` is spec 06 §5's idiom for an upper storey; the room on
    // the far side is the floor, and no one had to declare its ceiling.
    expect(has(map(`[terrain]\nair : area A1..T20\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s\nbuilding solar : C7..F10`), VOID)).toBe(false);
  });

  it("is silent for a window, whose job is to face open air", () => {
    expect(has(map(`[terrain]\nair : area A1..T20\n\n[structures]\nbuilding hall : C3..F6\n  window : D6.s`), VOID)).toBe(false);
  });

  it("warns when a door in a room leads into solid rock", () => {
    expect(has(map(`[terrain]\nearth : area A1..T20\n\n[structures]\nbuilding hall : C3..F6\n  door : F4.e`), VOID)).toBe(true);
  });

  it("is silent for an unparented opening — a cave mouth is rock one side, floor the other (#113)", () => {
    // Spec 06 §3: an opening MAY have no parent where its edge separates a
    // passable cell from declared impassable rock. The rock IS the barrier and
    // the opening perforates it, so "far side" has nothing to mean here —
    // checking it reported the language's newest feature as a defect. Note the
    // ONLY difference from the case above is the parent structure.
    expect(has(map(`[terrain]\nearth : area A1..T20\nfloor : area C3..F6\n\n[structures]\nopening mouth : F4.e`), VOID)).toBe(false);
  });
});

describe("2 — structure-unsupported", () => {
  const AIR = "with nothing beneath it on level";
  const stack = (body: string): string =>
    `# Lint fixture\n\nmap: battlemap\ngrid: square 20x20\nscale: 5ft\nlevels: upper ground\nlevel: ground\n\n${body}\n`;

  it("warns for an upper room with nothing under it", () => {
    expect(has(stack(`[structures]\nbuilding hall : C3..F6\n\n[terrain upper]\nair : area A1..T20\n\n[structures upper]\nbuilding tower : M12..P15`), AIR)).toBe(true);
  });

  it("is silent for an upper room sitting squarely on the room below", () => {
    // The manor's Lord's Chambers, which stand on the Great Hall. Reading the
    // surface word alone called this a building floating in the sky.
    expect(has(stack(`[structures]\nbuilding hall : C3..F6\n\n[terrain upper]\nair : area A1..T20\n\n[structures upper]\nbuilding chambers : C3..F6`), AIR)).toBe(false);
  });

  it("still warns for a wing that overhangs the room below", () => {
    expect(has(stack(`[structures]\nbuilding hall : C3..F6\n\n[terrain upper]\nair : area A1..T20\n\n[structures upper]\nbuilding chambers : C3..J6`), AIR)).toBe(true);
  });
});

describe("3 — unreachable-room", () => {
  const SEALED = "no opening and no connector inside it";

  it("warns for a room with a full perimeter and no way in", () => {
    // The Gilded Tankard's Snug shipped exactly like this.
    expect(has(map(`[structures]\nbuilding inn : B2..H8\n  door : E8.s\nbuilding snug : F2..H4`), SEALED)).toBe(true);
  });

  it("is silent once that room has a door onto the common room", () => {
    expect(has(map(`[structures]\nbuilding inn : B2..H8\n  door : E8.s\nbuilding snug : F2..H4\n  door : G4.s`), SEALED)).toBe(false);
  });

  it("is silent when the only way in is a stair declared on the floor above", () => {
    // The manor's undercroft. A connector is written on ONE level and spec 06
    // §8's reciprocal landing puts it on the other, so reading same-level
    // entities alone reported a cellar as sealed with its ladder five lines up.
    const src = `# Lint fixture\n\nmap: battlemap\ngrid: square 20x20\nscale: 5ft\nlevels: ground cellar\nlevel: ground\n\n[structures]\nbuilding kitchen : D7..H10\n  door : D7.w\n\n[structures cellar]\nbuilding undercroft : E7..K10\n\n[features]\nstairs : F9 to=cellar\n`;
    expect(has(src, SEALED)).toBe(false);
  });

  it("is silent when that stair is placed in the room's local frame (spec 02 §7)", () => {
    const src = `# Lint fixture\n\nmap: battlemap\ngrid: square 20x20\nscale: 5ft\nlevels: ground cellar\nlevel: ground\n\n[structures]\nbuilding kitchen : D7..H10\n  door : D7.w\n\n[structures cellar]\nbuilding undercroft : E7..K10\n\n[features]\nstairs : on kitchen at C3 to=cellar\n`;
    expect(has(src, SEALED)).toBe(false);
  });
});

describe("4 — dangling-connector", () => {
  const LANDS = "which cannot be stood on";
  const stack = (body: string): string =>
    `# Lint fixture\n\nmap: battlemap\ngrid: square 20x20\nscale: 5ft\nlevels: ground cellar\nlevel: ground\n\n${body}\n`;

  it("warns when the stair lands in solid earth", () => {
    expect(has(stack(`[structures]\nbuilding hall : C3..F6\n  door : D6.s\n\n[terrain cellar]\nearth : area A1..T20\n\n[features]\nstairs : D4 to=cellar`), LANDS)).toBe(true);
  });

  it("is silent when it lands in a cellar room carved out of that earth", () => {
    // A cellar is `earth` painted across the level with rooms cut into it, so
    // the room the author drew is what says there is a floor at the bottom.
    expect(has(stack(`[structures]\nbuilding hall : C3..F6\n  door : D6.s\n\n[terrain cellar]\nearth : area A1..T20\n\n[structures cellar]\nbuilding undercroft : C3..F6\n\n[features]\nstairs : D4 to=cellar`), LANDS)).toBe(false);
  });
});

describe("5 — overlapping-structures", () => {
  const SHARED = "share cells";

  it("warns when two rooms clip each other's corners", () => {
    expect(has(map(`[structures]\nbuilding hall : C3..F6\nbuilding solar : E5..H8`), SHARED)).toBe(true);
  });

  it("is silent for a room wholly inside another — a snug in an inn", () => {
    // Containment is not overlap: those are real interior walls, not a
    // duplicated perimeter. Same shape as the flooded-room exemption in 6.
    expect(has(map(`[structures]\nbuilding inn : B2..H8\n  door : E8.s\nbuilding snug : F2..H4\n  door : G4.s`), SHARED)).toBe(false);
  });
});

describe("6 — terrain-crosses-wall", () => {
  const BAND = "runs both inside and outside";

  it("warns when a river runs through a wall with no way through", () => {
    expect(has(map(`[terrain]\nriver : path A5 T5\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s`), BAND)).toBe(true);
  });

  // #234: the warning used to name neither the structure it crossed nor where.
  // Several crossings arrived as byte-identical lines at one line number, and
  // ADR 0038 leans on this warning being actionable — it is the audit path for
  // a relational extent when someone edits the reference.
  it("names the structure, its line, and where the terrain leaves it", () => {
    const msg = warnings(map(
      `[terrain]
river : path A5 T5

[structures]
building hall "The Long Hall" : C3..F6
  door : D6.s`,
    )).find((m) => m.includes(BAND))!;
    expect(msg).toContain("The Long Hall");
    expect(msg).toMatch(/line \d+/);
    expect(msg).toMatch(/[A-Z]\d+\.[nsew]/);
  });

  it("two structures crossed by one terrain produce DISTINGUISHABLE messages", () => {
    // The property that makes the report usable at all: previously these were
    // identical strings, so a reader could not tell which building was which.
    const msgs = warnings(map(
      `[terrain]
river : path A5 T5

[structures]
building a "North Barn" : C3..F6
  door : D6.s
building b "South Barn" : J3..M6
  door : K6.s`,
    )).filter((m) => m.includes(BAND));
    expect(msgs.length).toBe(2);
    expect(msgs[0]).not.toBe(msgs[1]);
    expect(msgs.join(" ")).toContain("North Barn");
    expect(msgs.join(" ")).toContain("South Barn");
  });

  it("is silent when the whole footprint is covered — a flooded room", () => {
    expect(has(map(`[terrain]\nwater : area C3..F6\n\n[structures]\nbuilding hall : C3..F6\n  door : D6.s`), BAND)).toBe(false);
  });

  it("is silent for a pool WHOLLY INSIDE a room, covering part of its floor (#146)", () => {
    // The ordinary case, and the one the first predicate got backwards: a pool
    // in a hall, a dais on a chamber floor, a rubble heap in one corner. Terrain
    // that touches no wall cannot be crossing one. Sixteen of seventeen
    // warnings on a real map were this shape.
    expect(has(map(`[terrain]\nearth : area A1..T20\nwater pool : area E4..F5 difficult\n\n[structures]\nbuilding hall : C3..H8\n  door : D8.s`), BAND)).toBe(false);
  });

  it("is silent for a single cell of rubble inside a hall (#146)", () => {
    expect(has(map(`[terrain]\nearth : area A1..T20\nrubble : E5\n\n[structures]\nbuilding hall : C3..H8\n  door : D8.s`), BAND)).toBe(false);
  });

  it("still warns for the same pool once it runs out through the east wall (#146)", () => {
    // The ONLY difference from the pool above is that this one escapes.
    expect(has(map(`[terrain]\nearth : area A1..T20\nwater pool : area E4..R5\n\n[structures]\nbuilding hall : C3..H8\n  door : D8.s`), BAND)).toBe(true);
  });

  it("is silent for a road that enters a gatehouse through its gate", () => {
    // The manor's King's Road, which meets the gatehouse at a door. A road
    // through a gate is not a road through a wall — what makes the band a
    // defect is crossing the perimeter where there is no way through.
    expect(has(map(`[terrain]\nroad : path M20 M12\n\n[structures]\nbuilding gatehouse : L11..N12\n  door : M12.s\n  door : M11.n`), BAND)).toBe(false);
  });

  it("counts the cells a path RUNS THROUGH, not just its corners", () => {
    // `path M20 M12` names two cells and covers nine. Counting corners made a
    // road look like it never entered the room it ran the length of.
    expect(has(map(`[terrain]\nroad : path M20 M12\n\n[structures]\nbuilding hall : L14..N16`), BAND)).toBe(true);
  });
});

describe("a path is its BAND, not its centreline (#147)", () => {
  const VOID = "leads out onto ground that cannot be walked on";

  it("a door onto a road is not a door onto nothing", () => {
    // The road is painted over `earth`, and spec 06 §6 layers area terrain
    // beneath path bands — so the road is what that cell has on it. Reading
    // only `terrain` made a shop fronting onto a street open onto bedrock.
    expect(has(map(`[terrain]\nearth : area A1..T20\nroad highstreet : path A8 T8 width=3\n\n[structures]\nbuilding shop : D2..H6\n  door : F6.s`), VOID)).toBe(false);
  });

  it("still warns for a door onto genuine rock beside that road", () => {
    expect(has(map(`[terrain]\nearth : area A1..T20\nroad highstreet : path A18 T18 width=3\n\n[structures]\nbuilding shop : D2..H6\n  door : F6.s`), VOID)).toBe(true);
  });

  it("counts the band's WIDTH — a door two cells off the centreline of a width=3 road", () => {
    // `width=3` reaches one cell either side of A8..T8, so F7 is road. With the
    // centreline alone this cell is bedrock and the door warns.
    expect(has(map(`[terrain]\nearth : area A1..T20\nroad : path A8 T8 width=3\n\n[structures]\nbuilding shop : D2..H6\n  door : F6.s`), VOID)).toBe(false);
  });

  it("a bridge band counts as walkable too", () => {
    expect(has(map(`[terrain]\nearth : area A1..T20\nbridge span : path A8 T8 width=3\n\n[structures]\nbuilding shop : D2..H6\n  door : F6.s`), VOID)).toBe(false);
  });
});
