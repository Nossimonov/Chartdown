/**
 * A drawn shape is a pure function of its declaration, INCLUDING of `extent:`
 * (#203).
 *
 * Spec 05 §4 and ADR 0023 both say a feature is drawn as declared and that its
 * geometry depends on nothing but its own data. Neither anticipated the
 * document HEADER as an input — and it was one, because the organic finishing
 * that turns a declared outline into a drawn coast carried thresholds in
 * RENDERED units, which are a fraction of the canvas rather than a distance.
 *
 * Measured on the Puget Sound exercise map before the fix: an island's drawn
 * centroid moved 0.16mi between a 100mi and a 350mi extent and its bounding box
 * grew 1.3%, which closed a 0.1mi channel and made `check` report a welded
 * island on a document that passed at the other extent.
 *
 * This is the sweep, not a spot check: it renders the same document at three
 * extents spanning 20x and asserts every drawn shape is the same shape in MAP
 * UNITS. Anything that reintroduces a canvas constant into a geometry path
 * fails here rather than on someone's map.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

/**
 * One of everything that gets organically finished — and EVERY COORDINATE IS
 * FIXED. Only the `extent:` line changes between renders, which is the whole
 * claim: the same declaration, drawn on a bigger sheet, is the same shape.
 */
const doc = (width: number, height: number): string => `# Scale
map: region
extent: ${width}x${height}mi
seed: 7

[water]
coastline shore : from (60,0) via (62,65) to (60,130)
sea "The Deep" : west of shore
island isle "The Isle" : near shore at (45,39) area (0,-7.8) (4,-3.9) (5,2.6) (2,6.5) (-3,5.2) (-5,0) (-4,-5.2)

[terrain]
forest wood "The Wood" : area (70,26) (85,28.6) (88,52) (72,49.4)
`;

interface Shape { pts: { x: number; y: number }[]; perMile: number }

const shapesOf = (width: number, height: number): Map<string, Shape> => {
  const out = renderSource(doc(width, height), {});
  expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const perMile = Number(/viewBox="0 0 ([\d.]+)/.exec(out.svg)![1]) / width;
  const shapes = new Map<string, Shape>();
  for (const m of out.svg.matchAll(/<g id="(cd-scale-[a-z]+)"[^>]*>.*?points="([^"]+)"/gs)) {
    shapes.set(m[1]!, {
      perMile,
      pts: m[2]!.trim().split(/\s+/).map((q) => {
        const [x, y] = q.split(",").map(Number) as [number, number];
        return { x: x / perMile, y: y / perMile };
      }),
    });
  }
  return shapes;
};

const centroid = (s: Shape): { x: number; y: number } => ({
  x: s.pts.reduce((t, p) => t + p.x, 0) / s.pts.length,
  y: s.pts.reduce((t, p) => t + p.y, 0) / s.pts.length,
});

const bbox = (s: Shape): { w: number; h: number } => ({
  w: Math.max(...s.pts.map((p) => p.x)) - Math.min(...s.pts.map((p) => p.x)),
  h: Math.max(...s.pts.map((p) => p.y)) - Math.min(...s.pts.map((p) => p.y)),
});

describe("the same declaration draws the same shape at any extent (#203)", () => {
  // 20x apart, which is more than the committed examples span (12mi to 1600mi)
  // and far more than the 3.5x that was enough to close a channel.
  const BASE = { w: 100, h: 130 };
  const base = shapesOf(BASE.w, BASE.h);
  const wide = shapesOf(BASE.w * 3.5, BASE.h * 3.5);
  const wider = shapesOf(BASE.w * 20, BASE.h * 20);

  it("draws the same shapes at all three", () => {
    expect([...base.keys()].sort()).toEqual([...wide.keys()].sort());
    expect([...base.keys()].sort()).toEqual([...wider.keys()].sort());
    expect(base.size).toBeGreaterThan(1);
  });

  it("keeps every shape's vertex count", () => {
    // The count is where the old defect showed first: an edge gate in canvas
    // units skipped texturing on a wide map, so the same outline reached the
    // spline with a different control set — 80 points at 100mi, 40 at 350.
    for (const [id, b] of base) {
      expect(wide.get(id)!.pts.length, `${id} at 3.5x`).toBe(b.pts.length);
      expect(wider.get(id)!.pts.length, `${id} at 20x`).toBe(b.pts.length);
    }
  });

  it("keeps every shape's position, well inside the output's own precision", () => {
    // Asserted on the CENTROID, which averages over every vertex so the
    // printed rounding cancels rather than accumulating. What is left is the
    // geometry, and it must not move at all.
    for (const [id, b] of base) {
      for (const [label, other] of [["3.5x", wide.get(id)!], ["20x", wider.get(id)!]] as const) {
        const a = centroid(b);
        const c = centroid(other);
        const moved = Math.hypot(a.x - c.x, a.y - c.y);
        // Half a printed quantum at the WIDER scale, in miles — the centroid
        // averages ~100 vertices, so the rounding noise left is far below this.
        expect(moved, `${id} at ${label} moved ${moved.toFixed(4)}mi`)
          .toBeLessThan((0.01 / other.perMile) * 0.5);
      }
    }
  });

  it("keeps every shape's size, within the printed quantum", () => {
    // The bounding box takes its two extremes from single vertices, so unlike
    // the centroid it carries the full rounding error of each — one quantum at
    // the coarser scale, and no more. That residual is irreducible: it is the
    // output format, not the geometry (#176).
    for (const [id, b] of base) {
      for (const [label, other] of [["3.5x", wide.get(id)!], ["20x", wider.get(id)!]] as const) {
        const tol = (0.01 / other.perMile) * 4;
        expect(Math.abs(bbox(b).w - bbox(other).w), `${id} width at ${label}`).toBeLessThan(tol);
        expect(Math.abs(bbox(b).h - bbox(other).h), `${id} height at ${label}`).toBeLessThan(tol);
      }
    }
  });

  it("gives the same diagnostics at every extent", () => {
    // The other half of #203: `surroundedByWater`'s probe stepped off the shore
    // by a distance floored in canvas units, so #180 answered differently about
    // the same island — a rule about whether two landmasses touch cannot depend
    // on how big the picture is printed.
    const messages = (w: number, h: number): string[] =>
      renderSource(doc(w, h), {}).diagnostics.map((d) => `${d.severity}: ${d.message}`).sort();
    expect(messages(BASE.w * 3.5, BASE.h * 3.5)).toEqual(messages(BASE.w, BASE.h));
    expect(messages(BASE.w * 20, BASE.h * 20)).toEqual(messages(BASE.w, BASE.h));
  });
});
