/**
 * `dangling-connector` checks every landing of a ranged connector (#344).
 *
 * The lint skipped ranges outright — `if (to === undefined || to.includes(".."))
 * continue` — so a shaft declared `to=upper..cellar` could land in solid rock on
 * every floor it passed through and nothing said so, while the identical
 * document written as separate single-level connectors was checked normally.
 *
 * Deferred from #338, which fixed the same blind spot in `unreachable-room` and
 * named this as the sibling. It is a different class from #322: that was a
 * check firing wrongly, this is a check that never RAN. A false positive
 * announces itself; a missing check is found only when someone asks what it
 * covers.
 *
 * `through=` is excluded, per spec 06 §8 and the subtraction ADR 0048 already
 * makes when computing a flight's landings: a `through=` level declares no
 * landing, so a shaft boring through rock is the feature rather than the
 * defect.
 *
 * The corpus has no `to=` range at all (#333), so these tests carry this
 * entirely — there is no committed document that would have caught it.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

/** upper (a room) → ground (SOLID ROCK, no room) → cellar (a room). */
const shaft = (stair: string): string[] =>
  renderSource(["# Shaft", "map: battlemap", "grid: square 4x4", "scale: 5ft",
    "levels: upper ground cellar", "level: upper", "",
    "[structures upper]", "building u : A1..B2", "door : B2.s", stair, "",
    "[terrain ground]", "earth : area A1..D4", "",
    "[structures cellar]", "building c : A1..B2"].join("\n"), { mode: "gm" })
    .diagnostics.filter((d) => d.message.includes("cannot be stood on")).map((d) => d.message);

const levelsNamed = (msgs: string[]): string[] =>
  msgs.map((m) => /level '(\w+)'/.exec(m)?.[1] ?? "?");

describe("a ranged connector's interior landing is checked", () => {
  it("the case with no coverage today", () => {
    // A1 on `ground` is inside `earth : area A1..D4` and inside no room.
    expect(levelsNamed(shaft("stairs s : on u at A1 to=upper..cellar"))).toEqual(["ground"]);
  });

  it("and it agrees with the same document spelled as one connector", () => {
    // The whole complaint: two spellings of one fact, checked differently.
    expect(levelsNamed(shaft("stairs s : on u at A1 to=ground")))
      .toEqual(levelsNamed(shaft("stairs s : on u at A1 to=upper..cellar")));
  });

  it("the message names the LEVEL, not the range", () => {
    // It used to interpolate `to` directly, which for a range would print
    // `on level 'upper..cellar'` — naming no level at all.
    const msg = shaft("stairs s : on u at A1 to=upper..cellar").join("\n");
    expect(msg).toContain("on level 'ground'");
    expect(msg).not.toContain("upper..cellar");
  });
});

describe("`through=` declares no landing, so it does not dangle", () => {
  it("a shaft bored through the rock it passes", () => {
    // spec 06 §8: a `through=` level is occupied without being opened onto.
    // Reporting it would report the feature as the defect.
    expect(shaft("stairs s : on u at A1 to=upper..cellar through=ground")).toEqual([]);
  });

  it("but a level NOT named by `through=` still dangles", () => {
    // Calibration: the exclusion is scoped, not a blanket silencer. `through=`
    // naming a level with a real floor leaves `ground` reported as before.
    expect(levelsNamed(shaft("stairs s : on u at A1 to=upper..cellar through=cellar")))
      .toEqual(["ground"]);
  });
});

describe("what must not move", () => {
  it("an unranged connector behaves exactly as it did", () => {
    expect(levelsNamed(shaft("stairs s : on u at A1 to=ground"))).toEqual(["ground"]);
    expect(shaft("stairs s : on u at A1 to=cellar")).toEqual([]);
  });

  it("a landing in a room is a floor and never dangles", () => {
    // `cellar` has `building c : A1..B2`, so A1 is carved floor there.
    expect(shaft("stairs s : on u at A1 to=cellar")).toEqual([]);
  });

  it("a connector with no landing placement is skipped, not crashed", () => {
    expect(() => shaft("stairs s : on u to=upper..cellar")).not.toThrow();
  });
});
