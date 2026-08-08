/**
 * Where courses meet, they merge (ADR 0044, #314, #315).
 *
 * Two failures in one picture. A joining course was pushed out to its terminal
 * cell's face — right for a free end that should fill the cell it stops in
 * (#145), wrong for a `join`, where the cell belongs to the trunk, so the
 * course came out the far side exactly `CELL / 2` past the centreline. And
 * every course drew its bank and then its water, per entity, in document
 * order — so each course laid its bank across the water of everything drawn
 * before it, and moving a line in the file changed the junction.
 *
 * The order test is the one that matters most: it asserts the PROPERTY rather
 * than the picture, and it is the claim the old behaviour could not make.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";
import { CELL, MARGIN } from "./grid";

/** Column D's centre — the trunk runs down it, and the join meets it there. */
const TRUNK_X = MARGIN + 3 * CELL + CELL / 2;

const BASE = ["map: battlemap", "grid: square 10x12", "scale: 5ft", "", "[terrain]",
  "pond fountain : D2", "pond sinkhole : D11", "pond spring : H4"];

const doc = (...courses: string[]): string => [...BASE, ...courses].join("\n");

const TRUNK = "stream runnel : from fountain to sinkhole";
const BRANCH = "stream seep : from spring join runnel";

const courseOf = (svg: string, id: string): { x: number; y: number }[] => {
  const at = svg.indexOf(`-${id}"`);
  expect(at, `no group for ${id}`).toBeGreaterThan(-1);
  const from = svg.lastIndexOf("<g", at);
  const pts = /points="([^"]*)"/.exec(svg.slice(from))?.[1] ?? "";
  return pts.split(" ").filter(Boolean).map((p) => {
    const [x, y] = p.split(",").map(Number);
    return { x: x!, y: y! };
  });
};

describe("a joining course stops in the trunk, not past it", () => {
  it("ends on the trunk's centreline", () => {
    // It used to end at TRUNK_X - CELL/2: through the trunk and out the far
    // side, with a squared cap standing in open floor.
    const end = courseOf(renderSource(doc(TRUNK, BRANCH)).svg, "seep").at(-1)!;
    expect(end.x).toBeCloseTo(TRUNK_X, 6);
  });

  it("a FREE end still fills its terminal cell (#145)", () => {
    // The narrowest reading of the fix: only a joining end changes. A course
    // running into a pond must still reach it rather than stopping half a cell
    // short, so the trunk's own ends are pushed out as before.
    const trunk = courseOf(renderSource(doc(TRUNK)).svg, "runnel");
    const first = trunk[0]!;
    const last = trunk.at(-1)!;
    const centreOfD2 = MARGIN + CELL + CELL / 2;
    expect(first.y).toBeLessThan(centreOfD2); // reached out past the centre
    expect(last.y - first.y).toBeGreaterThan(9 * CELL);
  });
});

describe("no bank is drawn over any water", () => {
  const THEME = ["kind: theme", "", "[theme]",
    "river : stroke=#e88ab0", "river.edge : stroke=#c9628f edge=3"].join("\n");

  const bands = (svg: string): string[] =>
    [...svg.matchAll(/<polyline[^>]*stroke="(#c9628f|#b9d3e6)"[^>]*>/g)]
      .map((m) => (m[1] === "#c9628f" ? "bank" : "water"));

  it("every bank precedes every water", () => {
    const order = bands(renderSource(doc(TRUNK, BRANCH), { theme: THEME }).svg);
    expect(order).toEqual(["bank", "bank", "water", "water"]);
    // Stated as the property too, so a third course cannot slip through.
    expect(order.lastIndexOf("bank")).toBeLessThan(order.indexOf("water"));
  });

  it("holds in either order two INDEPENDENT courses can be written", () => {
    // The deeper defect: line order was a drawing decision, and which bank cut
    // which water depended on where a line sat in the file.
    //
    // A joining pair cannot demonstrate that — `join runnel` requires `runnel`
    // declared earlier, because resolution is order-bounded and fail-loud
    // (ADR 0003), so the swap is not a legal document. A river and a road that
    // merely cross reference nothing, so they can be written either way, and
    // they are the case #315 was actually about.
    const RIVER = "stream brook : from fountain to sinkhole";
    const ROAD = "road lane : path A6 J6";
    for (const order of [[RIVER, ROAD], [ROAD, RIVER]] as const) {
      const svg = renderSource(doc(...order), { theme: THEME }).svg;
      const got = bands(svg);
      expect(got.lastIndexOf("bank"), order.join(" then ")).toBeLessThan(got.indexOf("water"));
    }
  });

  it("an unthemed course is a single stroke, and is left alone", () => {
    // No `edge=` means no bank to misplace — which is why this hid until
    // somebody themed a river.
    const order = bands(renderSource(doc(TRUNK, BRANCH)).svg);
    expect(order.filter((b) => b === "bank")).toEqual([]);
  });
});
