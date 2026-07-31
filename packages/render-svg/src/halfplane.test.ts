/**
 * A relational extent on a battlemap (spec 06 §6, ADR 0038, #231).
 *
 * The properties asserted here are the ones the ADR promises an author, not
 * incidental facts about the implementation: the form means on a grid what it
 * means on a region map, the ink reaches the reference's centerline, the cells
 * stop at their own centres, and ties go to the reference.
 *
 * The cell rule's witness is a real document. A user hand-tiled "the wood is
 * north of the brook" as four ranges before asking for this syntax, so the
 * ranges are what the derived cells are checked against — a rule that agreed
 * with the renderer and disagreed with the author would be the wrong rule.
 */
import { describe, expect, it } from "vitest";
import { parse, type EntityNode } from "@chartdown/core";
import { halfPlaneCells, halfPlaneContext, surfaceCells, CELL, MARGIN, type Cell } from "./grid";
import { renderSource } from "./index";

const BROOK = "river babbling-brook \"Babbling Brook\" : path A10 J10 L10 N9 N7 S4 T4 width=1";
const doc = (terrain: string): string =>
  ["map: battlemap", "grid: square 20x20", "scale: 5ft", "", "[terrain]", BROOK, terrain].join("\n");

const cellsOf = (src: string, which: number): Map<string, Cell> => {
  const { document } = parse(src);
  const entities = document.sections
    .flatMap((sec) => sec.entries)
    .filter((n): n is EntityNode => n.kind === "entity");
  return surfaceCells(entities[which]!, halfPlaneContext(document, entities));
};
const name = (k: string): string => {
  const [col, row] = k.split(":").map(Number);
  return `${String.fromCharCode(64 + col!)}${row}`;
};

describe("a relational extent covers the cells an author would have tiled", () => {
  // The author's own four ranges, from the document that asked for the syntax.
  const HAND_TILED = "forest dark-wood \"Dark Wood\" : A1..M9 N1..T4 N5..O6 P5..Q5";
  const RELATIONAL = "forest dark-wood \"Dark Wood\" : north of babbling-brook";

  it("matches the hand-tiling except at the reference's terminal cells", () => {
    const derived = new Set([...cellsOf(doc(RELATIONAL), 1).keys()].map(name));
    const declared = new Set([...cellsOf(doc(HAND_TILED), 1).keys()].map(name));
    const missing = [...declared].filter((k) => !derived.has(k)).sort();
    const extra = [...derived].filter((k) => !declared.has(k)).sort();

    // S4 and T4 are the brook's own terminal cells. The author swept them in
    // because `N1..T4` is one clean rectangle and excluding two corners would
    // have cost extra ranges — tiling convenience, not intent. Everything else
    // agrees, in both directions.
    expect(missing).toEqual(["S4", "T4"]);
    expect(extra).toEqual([]);
  });

  it("follows a diagonal instead of stepping around it", () => {
    const derived = new Set([...cellsOf(doc(RELATIONAL), 1).keys()].map(name));
    // Down the diagonal run from N7 to S4 the boundary falls between rows, and
    // the covered column heights descend one at a time — the staircase the four
    // ranges were approximating.
    expect(["O6", "P5", "Q5", "R4"].every((k) => derived.has(k))).toBe(true);
    expect(["O7", "P6", "Q6", "R5"].some((k) => derived.has(k))).toBe(false);
  });
});

describe("ties go to the reference, never to the fill", () => {
  it("excludes the cells the course itself runs through", () => {
    const derived = new Set([...cellsOf(doc("forest w : north of babbling-brook"), 1).keys()].map(name));
    // Along the axis-aligned run the course lies ON these centres, so they are
    // not strictly beyond it: the brook's bed is not the wood.
    for (const k of ["A10", "F10", "M10"]) expect(derived.has(k)).toBe(false);
    for (const k of ["A9", "F9", "M9"]) expect(derived.has(k)).toBe(true);
  });

  it("clears a run that is square to the fill, not just its ends", () => {
    // The brook turns north at N9 and runs to N7 before heading east. A column
    // holding a whole span of course must clear ALL of it — interpolating one
    // value at that column would put forest in the river.
    const derived = new Set([...cellsOf(doc("forest w : north of babbling-brook"), 1).keys()].map(name));
    for (const k of ["N7", "N8", "N9"]) expect(derived.has(k)).toBe(false);
    expect(derived.has("N6")).toBe(true);
  });
});

describe("the ink and the cells answer different questions (#145's split)", () => {
  const src = doc("forest dark-wood \"Dark Wood\" : north of babbling-brook");

  it("fills to the reference's centerline, so no paper shows at the water's edge", () => {
    const { svg } = renderSource(src);
    const poly = /<polygon points="([^"]*)" fill="#a9c79c"/.exec(svg);
    expect(poly).not.toBeNull();
    const ys = poly![1]!.split(" ").map((p) => Number(p.split(",")[1]));
    // Row 10's centre. The cells stop a half-cell short of this, deliberately:
    // the band inks 85% of its cell, so a fill stopping where its cells stop
    // would leave a hairline of paper down the brook's whole length.
    const row10Centre = MARGIN + 9 * CELL + CELL / 2;
    expect(ys).toContain(row10Centre);
  });

  it("is bounded by the grid, never the margin", () => {
    const { svg } = renderSource(src);
    const poly = /<polygon points="([^"]*)" fill="#a9c79c"/.exec(svg);
    const pts = poly![1]!.split(" ").map((p) => p.split(",").map(Number));
    const right = MARGIN + 20 * CELL;
    const bottom = MARGIN + 20 * CELL;
    // The margin is the coordinate gutter. Terrain drawn there is terrain on
    // no cell — an ink/coverage disagreement the cell rule cannot answer for.
    for (const [x, y] of pts) {
      expect(x!).toBeGreaterThanOrEqual(MARGIN);
      expect(x!).toBeLessThanOrEqual(right);
      expect(y!).toBeGreaterThanOrEqual(MARGIN);
      expect(y!).toBeLessThanOrEqual(bottom);
    }
  });
});

describe("a relational extent is ground like any other", () => {
  it("is NOT exempt from terrain-crosses-wall — that report is what makes it auditable", () => {
    const src = [
      "map: battlemap", "grid: square 20x20", "scale: 5ft", "",
      "[terrain]", BROOK,
      "forest dark-wood \"Dark Wood\" : north of babbling-brook",
      "[structures]",
      "building lodge \"The Lodge\" : G7..I12",
      "  door : H12.s",
    ].join("\n");
    const { diagnostics } = renderSource(src);
    expect(diagnostics.some((d) => /crossing its wall/.test(d.message))).toBe(true);
  });

  it("declaration order is not significant", () => {
    const after = doc("forest w : north of babbling-brook");
    const before = ["map: battlemap", "grid: square 20x20", "scale: 5ft", "", "[terrain]",
      "forest w : north of babbling-brook", BROOK].join("\n");
    const poly = (s: string): string => /<polygon points="([^"]*)" fill="#a9c79c"/.exec(renderSource(s).svg)![1]!;
    expect(poly(before)).toBe(poly(after));
  });

  it("a reference with no course is reported, not silently dropped", () => {
    const src = [
      "map: battlemap", "grid: square 20x20", "scale: 5ft", "",
      "[terrain]", "forest w : north of nowhere",
    ].join("\n");
    const { svg, diagnostics } = renderSource(src);
    expect(diagnostics.some((d) => /declares no course to take a side of/.test(d.message))).toBe(true);
    expect(svg).not.toContain("#a9c79c");
  });
});

describe("the half-plane covers the whole grid beyond its frontier", () => {
  it("claims the corners past the course's own span", () => {
    // A frontier drawn across the middle still freezes the corners — the same
    // reading spec 05 §2 gives it on a region map.
    const course: Cell[] = [{ col: 5, row: 10 }, { col: 15, row: 10 }];
    const cells = halfPlaneCells("n", course, 20, 20);
    for (const k of ["1:1", "20:1", "1:9", "20:9"]) expect(cells.has(k)).toBe(true);
    expect(cells.has("1:10")).toBe(false);
    expect(cells.has("20:11")).toBe(false);
  });

  it("reads every compass direction the grammar allows", () => {
    const course: Cell[] = [{ col: 10, row: 1 }, { col: 10, row: 20 }];
    expect(halfPlaneCells("w", course, 20, 20).has("9:5")).toBe(true);
    expect(halfPlaneCells("w", course, 20, 20).has("11:5")).toBe(false);
    expect(halfPlaneCells("e", course, 20, 20).has("11:5")).toBe(true);
    expect(halfPlaneCells("e", course, 20, 20).has("10:5")).toBe(false);
  });
});
