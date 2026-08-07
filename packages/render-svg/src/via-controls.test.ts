/**
 * A course's shape on a grid (#258, #259).
 *
 * #238 made `from … to …` resolve in cell space, using the two endpoint refs
 * and dropping everything else — the `via` controls and each endpoint's `at`
 * refinement — with a code comment where a diagnostic belonged. The map drew a
 * straight line the document had not asked for, and the whole SVG was
 * byte-identical whatever shape was written. That is #239's failure one level
 * down: the placement resolves, and its payload vanishes.
 *
 * #258 is the other half: a grid writes every position as `D8`, so `via` had
 * no spelling a grid map could use, let alone one it honoured.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const map = (course: string): string =>
  ["map: battlemap", "grid: square 20x15", "scale: 5ft", "",
   "[terrain]", "pond fountain : B1", "pond sink-hole : B15", course].join("\n");

const courseOf = (svg: string): string => /<polyline points="([^"]*)"/.exec(svg)?.[1] ?? "";
const errorsOf = (src: string): string[] =>
  renderSource(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("a `via` cell shapes the course", () => {
  it("bends it, where the payload used to be dropped", () => {
    const straight = courseOf(renderSource(map("stream s : from fountain to sink-hole")).svg);
    const bent = courseOf(renderSource(map("stream s : from fountain via D8 to sink-hole")).svg);
    expect(bent).not.toBe(straight);
  });

  it("renders identically to the `path` spelling through the same cells", () => {
    // The workaround the old code's own comment recommended. If these differ,
    // `via` means something other than "go through here", which is not what
    // spec 02 §7 says it means.
    const viaForm = courseOf(renderSource(map("stream s : from fountain via D8 to sink-hole")).svg);
    const pathForm = courseOf(renderSource(map("stream s : path B1 D8 B15")).svg);
    expect(viaForm).toBe(pathForm);
  });

  it("takes more than one control, in order", () => {
    const one = courseOf(renderSource(map("stream s : from fountain via D8 to sink-hole")).svg);
    const two = courseOf(renderSource(map("stream s : from fountain via D8 R4 to sink-hole")).svg);
    expect(two.split(" ")).toHaveLength(4);
    expect(two).not.toBe(one);
  });

  it("still resolves the endpoints from what they name", () => {
    const near = courseOf(renderSource(map("stream s : from fountain via D8 to sink-hole")).svg);
    const moved = courseOf(renderSource(
      ["map: battlemap", "grid: square 20x15", "scale: 5ft", "",
       "[terrain]", "pond fountain : B1", "pond sink-hole : R15",
       "stream s : from fountain via D8 to sink-hole"].join("\n"),
    ).svg);
    expect(moved).not.toBe(near); // live anchors survive the shape controls
  });
});

describe("what a grid cannot site, it reports", () => {
  it("a gridless `via` point is an error, not a silent straight line", () => {
    const errors = errorsOf(map("stream s : from fountain via (60,40) to sink-hole"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/spec 02 §7/);
  });

  it("an endpoint's `at <point>` refinement is an error too", () => {
    // The other half of what vanished: `from fountain at (10,10) to …`.
    expect(errorsOf(map("stream s : from fountain at (10,10) to sink-hole")).length).toBeGreaterThan(0);
  });

  it("is not rounded to a cell", () => {
    // Cell size follows `scale:`, so rounding would make the same (60,40)
    // name a different square after a scale edit — the number in the document
    // would stop being the shape on the map.
    const { svg } = renderSource(map("stream s : from fountain via (60,40) to sink-hole"));
    const straight = courseOf(renderSource(map("stream s : from fountain to sink-hole")).svg);
    expect(courseOf(svg)).toBe(straight);
  });
});

describe("a region map is unaffected, and refuses a cell", () => {
  const region = (course: string): string =>
    ["map: region", "extent: 800x600mi", "",
     "[terrain]", 'mountains spine "The Spine" : ridge (40,40) (60,150)',
     'hills far "The Far Hills" : blob (700,500) size=60mi', course].join("\n");

  it("still bends on world points", () => {
    const a = renderSource(region('river r : from spine via (300,200) to far')).svg;
    const b = renderSource(region('river r : from spine via (500,400) to far')).svg;
    expect(a).not.toBe(b);
    expect(renderSource(region('river r : from spine via (300,200) to far')).diagnostics
      .filter((d) => d.severity === "error")).toEqual([]);
  });

  it("reports a cell, which names nothing without a grid", () => {
    const errors = renderSource(region('river r : from spine via D8 to far')).diagnostics
      .filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
  });
});
