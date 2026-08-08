/**
 * What an indented line under a structure may say (#293, #294, spec 06 §3).
 *
 * The slot is a closed set — a wall state, an opening, or a barrier word, with
 * side words or edge tokens for a predicate — and both halves were unenforced.
 * A cell predicate hit a bare `continue` and rendered byte-identically to its
 * own absence, doors included (#293). A subject outside the three drew a line
 * in the wall's own ink at the wall's own weight, invisible on top of the wall
 * it sat on (#294) — the else-branch #103 fixed the routing into and left
 * live. A barrier subject drew there AND on its own themed run, so a `fence`
 * edge came out twice at two different weights.
 *
 * Each refusal is checked against a legal control on the same shape, because
 * the risk in closing a slot is closing it too far.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const doc = (...details: string[]): string =>
  ["map: battlemap", "grid: square 8x6", "scale: 5ft", "",
   "[structures]", "building cellar : A1..B2", ...details.map((d) => `  ${d}`)].join("\n");

const errors = (src: string): string[] =>
  renderSource(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

const svgOf = (src: string): string => renderSource(src).svg;

describe("a detail the slot cannot take is refused, not swallowed (#293)", () => {
  for (const line of ["stairs : at A1", "stairs : B2", "lantern : at A1", "door : at A1"]) {
    it(`${line} — reported`, () => {
      const found = errors(doc(line));
      expect(found.length).toBeGreaterThan(0);
      expect(found.join(" ")).toMatch(/spec 06 §3/);
    });
  }

  it("names the edge spelling for an OPENING, not a relocation", () => {
    // A door on a cell means the author has not said which wall. Telling them
    // to move the door out of the room answers a question they did not ask.
    expect(errors(doc("door : at A1"))[0]).toMatch(/name the edge it sits on/);
  });

  it("names its own line for something that belongs IN the room", () => {
    const msg = errors(doc("stairs : at A1"))[0]!;
    expect(msg).toMatch(/stairs : on cellar at A1/);
  });

  it("the spelling the message recommends actually works", () => {
    // A message naming a fix that does not parse is worse than no message.
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "",
      "[structures]", "building cellar : B2..C3", "  door : at A1.w", "",
      "[features]", "stairs : on cellar at A1"].join("\n");
    expect(errors(src)).toEqual([]);
  });
});

describe("a subject outside the three is refused, not drawn in wall ink (#294)", () => {
  it("stairs on an edge no longer draws the wall's own stroke", () => {
    const { svg, diagnostics } = renderSource(doc("stairs : at A1.n"));
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
    // The old output was `stroke="#3d3629" stroke-width="3"` on the north edge
    // of A1 — INK at the perimeter weight, the same stroke the wall drew.
    expect(svg).not.toMatch(/<line x1="24" y1="24" x2="56" y2="24"[^>]*stroke="#3d3629"[^>]*stroke-width="3"/);
  });

  it("an opening on an edge still draws as an opening", () => {
    const svg = svgOf(doc("door : at A1.n"));
    expect(svg).toMatch(/<line x1="24" y1="24" x2="56" y2="24"[^>]*stroke="#a8763e"/);
    expect(errors(doc("door : at A1.n"))).toEqual([]);
  });

  it("a barrier edge is drawn ONCE, at its own weight", () => {
    // It used to draw twice: its themed run at width 2, and the else-branch
    // line at width 3 over the top.
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "",
      "[structures]", "building hall : A1..C3", "  door : at A1.w", "  fence : at C1.e"].join("\n");
    expect(errors(src)).toEqual([]);
    const onThatEdge = [...svgOf(src).matchAll(/<line x1="120" y1="24" x2="120" y2="56"[^>]*>/g)];
    expect(onThatEdge).toHaveLength(1);
    expect(onThatEdge[0]![0]).toContain('stroke-width="2"');
  });
});

describe("the three legal kinds are untouched", () => {
  for (const [name, line] of [
    ["an opening on an edge", "door : at A1.n"],
    ["a wall state by side word", "ruined : north"],
    ["a wall state on an edge", "ruined : at A1.n"],
    ["a barrier on an edge", "fence : at A1.n"],
  ] as const) {
    it(name, () => {
      expect(errors(doc("door : at A1.w", line))).toEqual([]);
    });
  }

  it("a wall state is recognised by the PARENT's declared states, not a literal", () => {
    // `ruined` resolves to no archetype — it is a state of the structure's own
    // word. Matching the literal string is the trap #103 named, so this asks
    // the vocabulary instead, and a state declared on a derived structure word
    // has to work the same way.
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "",
      "[vocab]", "bunker : building", "",
      "[structures]", "bunker b1 : A1..B2", "  door : at A1.w", "  ruined : north"].join("\n");
    expect(errors(src)).toEqual([]);
  });
});
