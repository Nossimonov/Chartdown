/**
 * An edge- or corner-placed connector is still a connector (#326).
 *
 * `A1.n` is on `A1` — the cell is right there in the token. Two lints read
 * placements and both saw only `address` placements, with opposite symptoms
 * from one cause:
 *
 *   unreachable-room    stopped counting the stair, so the room on the far
 *                       level was reported as unreachable — a warning about a
 *                       room, caused by a token on the line above it.
 *   dangling-connector  skipped the entity outright (`if (!landing) continue`),
 *                       so the check never ran at all.
 *
 * The sting is which spelling breaks. Spec 06 §5 calls stairs "traversable
 * connections, **placed spanning a boundary**" — so the edge spelling is the
 * one the spec's own language leads an author to write, and the advice the
 * warning then gave was to add a door to a room already reached by a stair.
 *
 * Counting it was chosen over refusing it, which #326 offered as the
 * alternative: refusing would make the spec's own description of a transition
 * an error, and ADR 0052 had just established that a stair is a way in.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const UNREACHABLE = "nothing can reach it";
const DANGLING = "cannot be stood on";

/** Two levels; the lower room's only way in is the stair, whose token varies. */
const twoLevel = (token: string, form: "placement" | "pair" = "placement"): string[] =>
  renderSource(["# EdgeStair", "map: battlemap", "grid: square 3x3", "scale: 5ft",
    "levels: up dn", "level: up", "", "[structures]", "building r: A1..B2", "door : B2.s",
    form === "placement" ? `stairs s : on r at ${token} to=dn` : `stairs s : A1 at=${token} to=dn`,
    "", "[structures dn]", "building c: A1..B2"].join("\n"), { mode: "gm" })
    .diagnostics.filter((d) => d.message.includes(UNREACHABLE)).map((d) => d.message);

/** The far level is open air, so a connector landing there is dangling. */
const ontoAir = (token: string): string[] =>
  renderSource(["# D", "map: battlemap", "grid: square 4x4", "scale: 5ft",
    "levels: up dn", "level: up", "", "[structures]", "building r: A1..B2", "door : B2.s",
    `stairs s : on r at ${token} to=dn`, "", "[terrain dn]", "air : area A1..D4"].join("\n"),
    { mode: "gm" }).diagnostics.filter((d) => d.message.includes(DANGLING)).map((d) => d.message);

describe("unreachable-room counts an edge-placed connector", () => {
  it("the reported case: one token changed, nothing else", () => {
    expect(twoLevel("A1")).toEqual([]);   // always worked
    expect(twoLevel("A1.n")).toEqual([]); // warned
    expect(twoLevel("A1.nw")).toEqual([]); // warned
  });

  it("every side and corner, since the token is what varied", () => {
    for (const dir of ["n", "e", "s", "w", "ne", "nw", "se", "sw"]) {
      expect(twoLevel(`A1.${dir}`), dir).toEqual([]);
    }
  });

  it("and the `at=` pair form too", () => {
    // Found while fixing the placement form. Leaving one silent failure in the
    // function being repaired is how #408 happened.
    expect(twoLevel("A1", "pair")).toEqual([]);
    expect(twoLevel("A1.n", "pair")).toEqual([]);
    expect(twoLevel("A1.sw", "pair")).toEqual([]);
  });
});

describe("dangling-connector now checks them, having skipped them entirely", () => {
  it("a stair landing on air warns, however it is placed", () => {
    expect(ontoAir("A1")).toHaveLength(1);   // the only one ever checked
    expect(ontoAir("A1.n")).toHaveLength(1); // never ran
    expect(ontoAir("A1.nw")).toHaveLength(1);
  });
});

describe("what must not move", () => {
  it("a connector OUTSIDE the room still leaves it unreachable", () => {
    // The cell in the token is used, not ignored — so a stair somewhere else
    // must not silence the warning. C3 is outside `A1..B2`.
    expect(twoLevel("C3").join("\n")).toContain(UNREACHABLE);
    expect(twoLevel("C3.n").join("\n")).toContain(UNREACHABLE);
  });

  it("a sealed room with no connector at all still warns", () => {
    const sealed = renderSource(["# S", "map: battlemap", "grid: square 3x3", "scale: 5ft",
      "", "[structures]", "building c: A1..B2"].join("\n"), { mode: "gm" })
      .diagnostics.filter((d) => d.message.includes(UNREACHABLE));
    expect(sealed).toHaveLength(1);
  });

  it("a connector landing on solid ground does not dangle", () => {
    const solid = renderSource(["# D", "map: battlemap", "grid: square 4x4", "scale: 5ft",
      "levels: up dn", "level: up", "", "[structures]", "building r: A1..B2", "door : B2.s",
      "stairs s : on r at A1.n to=dn", "", "[terrain dn]", "earth : area A1..D4",
      "", "[structures dn]", "building c: A1..B2"].join("\n"), { mode: "gm" })
      .diagnostics.filter((d) => d.message.includes(DANGLING));
    expect(solid).toEqual([]);
  });
});
