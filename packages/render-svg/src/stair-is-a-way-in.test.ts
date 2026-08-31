/**
 * A stair is a way in, with or without `to=` (#301, ADR 0052).
 *
 * `unreachable-room` counted a connector only if the entity carried `to=`, and
 * the stdlib gave `stairs` no standing of its own. On a SINGLE-LEVEL map there
 * is no level to point `to=` at, so a cellar reached by a stair was reported as
 * a room nothing can reach, and the two ways to silence it were to invent a
 * door the map does not have or to invent a second level to connect to. Both
 * change the map to satisfy the linter, which is the wrong direction.
 *
 * The fix is a language fact rather than a lint tweak, which is what #301 asked
 * to have decided: `stairs` and `ramp` join spec 04 §2's load-bearing table, so
 * they are inherited (`ladder : stairs` counts) exactly as `earth` and `note`
 * are. That is how this project has answered this class before — #266 refused a
 * word rather than inferring one, and ADR 0016 exists precisely because
 * matching behaviour to a literal word is what derivation has to carry.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const UNREACHABLE = "nothing can reach it";

/** One level, one windowless cellar, and whatever is written inside it. */
const single = (...features: string[]): string[] =>
  renderSource(["# The Undercroft", "map: battlemap", "grid: square 10x8", "scale: 5ft", "",
    "[structures]", 'building cellar "The Cellar" : B2..F6',
    ...(features.length ? ["", "[features]", ...features] : [])].join("\n"), { mode: "gm" })
    .diagnostics.filter((d) => d.severity === "warning" && d.message.includes(UNREACHABLE))
    .map((d) => d.message);

describe("the reported case", () => {
  it("a cellar whose only entrance is a stair does not warn", () => {
    expect(single("stairs up : on cellar at A1")).toEqual([]);
  });

  it("and the same cellar with nothing in it still does", () => {
    // The warning is worth keeping; it was firing on the wrong document.
    expect(single().join("\n")).toContain(UNREACHABLE);
  });
});

describe("what counts, and why", () => {
  it("a ramp, the other stdlib word for a change of floor", () => {
    expect(single("ramp r : on cellar at A1")).toEqual([]);
  });

  it("a DERIVED word counts, which is the point of putting it in the table", () => {
    // ADR 0016: word-keyed behaviour is inherited. A renderer matching the
    // literal word would report this cellar as unreachable.
    const doc = ["# The Undercroft", "map: battlemap", "grid: square 10x8", "scale: 5ft", "",
      "[vocab]", "ladder : stairs", "", "[structures]", 'building cellar "The Cellar" : B2..F6',
      "", "[features]", "ladder l : on cellar at A1"].join("\n");
    const warnings = renderSource(doc, { mode: "gm" }).diagnostics
      .filter((d) => d.message.includes(UNREACHABLE));
    expect(warnings).toEqual([]);
  });

  it("`slope` does NOT count, deliberately", () => {
    // Spec 06 §5 names three traversable connections, and this rule takes two.
    // A slope is a graded surface within one level (`slope : terrain`), so
    // walking up one does not arrive from a storey the map never drew — which
    // is the entire reason the other two are a way in.
    expect(single("slope s : on cellar at A1").join("\n")).toContain(UNREACHABLE);
  });

  it("an ordinary feature is not a way in", () => {
    // The lint must not have been softened into "anything inside the room".
    expect(single("table t : on cellar at A1").join("\n")).toContain(UNREACHABLE);
    expect(single("barrel b : on cellar at A1").join("\n")).toContain(UNREACHABLE);
  });
});

describe("the stair has to be IN the room", () => {
  it("a stair framed against the room resolves into it", () => {
    // `on cellar at A1` is A1 OF THE CELLAR — absolute B2, inside the
    // footprint. The renderer says so in the title it emits; the lint reads
    // the same resolved address rather than the written one.
    expect(single("stairs up : on cellar at A1")).toEqual([]);
    expect(single("stairs up : at B2")).toEqual([]);
  });

  it("a stair on the sheet outside the footprint does not silence it", () => {
    expect(single("stairs up : at A1").join("\n")).toContain(UNREACHABLE);
    expect(single("stairs up : at H7").join("\n")).toContain(UNREACHABLE);
  });

  it("a stair on ANOTHER level, saying nothing about this one, does not either", () => {
    // Without `to=` it connects nothing, so it cannot be this room's entrance.
    // The level-connection rule is unchanged; this is only about the word.
    const doc = ["# T", "map: battlemap", "grid: square 10x8", "scale: 5ft",
      "levels: ground cellar", "", "[structures cellar]", 'building cellar "The Cellar" : B2..F6',
      "", "[features ground]", "stairs up : at B2"].join("\n");
    expect(renderSource(doc, { mode: "gm" }).diagnostics
      .filter((d) => d.message.includes(UNREACHABLE)).map((d) => d.message).join("\n"))
      .toContain(UNREACHABLE);
  });
});

describe("what must not move", () => {
  const multi = (feature: string): string[] =>
    renderSource(["# T", "map: battlemap", "grid: square 10x8", "scale: 5ft",
      "levels: ground cellar", "", "[structures cellar]", 'building cellar "The Cellar" : B2..F6',
      "", "[features cellar]", feature].join("\n"), { mode: "gm" })
      .diagnostics.filter((d) => d.message.includes(UNREACHABLE)).map((d) => d.message);

  it("the `to=` route still works, on either spelling of the landing", () => {
    expect(multi("stairs up : on cellar at A1 to=ground")).toEqual([]);
    expect(multi("stairs up : at B2 to=ground")).toEqual([]);
  });

  it("a `to=` connector that is not a stair still counts", () => {
    // Spec 06 §8: *any* feature carrying `to=` connects levels. That sentence
    // is untouched — this decision is about reachability, not connection.
    expect(multi("trapdoor t : at B2 to=ground")).toEqual([]);
  });

  it("a door on the perimeter still counts", () => {
    expect(single("door d : D6.s")).toEqual([]);
  });
});
