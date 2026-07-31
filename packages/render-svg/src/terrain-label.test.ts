/**
 * A battlemap terrain entity's display name (spec 06 §7, #232).
 *
 * Spec 06 §7 reserves visible text for display names, token identifiers and
 * zones — the tooltip rule covers the fallback WORD of an unnamed entity, not
 * a name an author wrote. Terrain was the one kind that never labelled at all:
 * a river, a road, a wood and a marsh each rendered their geometry and nothing
 * else, while every other kind on the same map labelled correctly.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const map = (...lines: string[]): string =>
  ["map: battlemap", "grid: square 20x20", "scale: 5ft", "", "[terrain]", ...lines].join("\n");

const RIVER = 'river brook "Babbling Brook" : path A10 T10 width=1';
const WOOD = 'forest wood "Dark Wood" : A1..M9';

const offsetOf = (svg: string, label: string): number | null => {
  const re = new RegExp(`startOffset="(\\d+)%"[^>]*>(?:<tspan[^>]*>)?${label}`);
  const m = re.exec(svg);
  return m ? Number(m[1]) : null;
};

describe("a named terrain feature carries its name", () => {
  it("a line feature's name lies ON its course, not beside it", () => {
    const { svg } = renderSource(map(RIVER));
    expect(svg).toContain("Babbling Brook");
    // The name reads as the river's BECAUSE it lies along the river (spec 07
    // §5). Set beside the course it becomes a caption pointing at water.
    expect(/<textPath[^>]*>(?:<tspan[^>]*>)?Babbling Brook/.test(svg)).toBe(true);
  });

  it("anchors at the arc-length midpoint, never at an endpoint", () => {
    const { svg } = renderSource(map(RIVER));
    // A name at the end of a river reads as labelling the place it stops.
    expect(offsetOf(svg, "Babbling Brook")).toBe(50);
  });

  it("an area's name sits within its own footprint", () => {
    const { svg } = renderSource(map(WOOD));
    expect(svg).toContain("Dark Wood");
    const m = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>Dark Wood</.exec(svg);
    expect(m).not.toBeNull();
    const [x, y] = [Number(m![1]), Number(m![2])];
    // A1..M9 spans x 24..440, y 24..312 in canvas units.
    expect(x).toBeGreaterThan(24);
    expect(x).toBeLessThan(440);
    expect(y).toBeGreaterThan(24);
    expect(y).toBeLessThan(312);
  });

  it("labels terrain of every placement kind on one map", () => {
    const { svg } = renderSource(map(RIVER, WOOD, 'road lane "The Lane" : path A1 T1 width=1',
      'marsh mire "The Mire" : P15..T18'));
    for (const n of ["Babbling Brook", "Dark Wood", "The Lane", "The Mire"]) expect(svg).toContain(n);
  });
});

describe("a crowded course slides its name along itself", () => {
  it("moves off the midpoint rather than off the course", () => {
    // Two courses crossing at their midpoints: a river across, a road down.
    // Both find the middle clear on their own, and their names met over the
    // ford they cross at — because text on a path is drawn turned to follow
    // it, so a north-south name occupies a TALL box, not a wide one.
    const { svg } = renderSource(map(
      'river brook "Babbling Brook" : path A10 T10 width=1',
      'road lane "Old Toll Road" : path J1 J20 width=1',
    ));
    const river = offsetOf(svg, "Babbling Brook");
    const road = offsetOf(svg, "Old Toll Road");
    expect(river).toBe(50);
    // The second to claim gives way — and gives way ALONG its own course.
    expect(road).not.toBe(50);
    expect(Math.abs(road! - 50)).toBeLessThanOrEqual(16);
  });
});

describe("the opt-outs reach terrain like anything else", () => {
  it("`nolabel` drops the name and keeps the geometry", () => {
    const { svg } = renderSource(map('river brook "Babbling Brook" : path A10 T10 width=1 nolabel'));
    expect(svg).not.toContain("Babbling Brook");
    expect(svg).toContain("<polyline");
  });

  it("`labels: none` suppresses derived names", () => {
    const src = ["map: battlemap", "grid: square 20x20", "scale: 5ft", "labels: none", "", "[terrain]", RIVER, WOOD].join("\n");
    const { svg } = renderSource(src);
    expect(svg).not.toContain("Babbling Brook");
    expect(svg).not.toContain("Dark Wood");
  });

  it("`labels: keyed` numbers terrain with everything else", () => {
    const src = ["map: battlemap", "grid: square 20x20", "scale: 5ft", "labels: keyed", "", "[terrain]", RIVER, WOOD].join("\n");
    const { svg } = renderSource(src);
    // The MARK carries the number; the name moves to the generated key, which
    // is what "a map in key mode renumbers every display name" means (§3). So
    // the name is still in the document — in the legend, not on the river.
    const onCourse = /<textPath[^>]*>(?:<tspan[^>]*>)?([^<]*)/.exec(svg);
    expect(onCourse![1]).toMatch(/^\d+$/);
    expect(svg).toContain("Babbling Brook"); // in the key
    expect(svg).not.toMatch(/<textPath[^>]*>(?:<tspan[^>]*>)?Babbling Brook/);
  });

  it("an UNNAMED feature stays silent — the tooltip rule is not a licence to draw", () => {
    // spec 06 §7: at battle scale a fallback word-label is a tooltip, never
    // visible text. `forest : area …` labels nothing, and that is the common
    // case on a real map — redford-crossing's wood and marsh are both unnamed.
    const { svg } = renderSource(map("forest : area A1..M9", "river : path A10 T10 width=1"));
    expect(/<text[^>]*>forest</.test(svg)).toBe(false);
    expect(/<textPath[^>]*>(?:<tspan[^>]*>)?river/.test(svg)).toBe(false);
  });
});

describe("a relational extent labels over the cells it resolved to", () => {
  it("names a wood placed north of a brook", () => {
    const { svg } = renderSource(map(
      'river brook "Babbling Brook" : path A10 T10 width=1',
      'forest wood "Dark Wood" : north of brook',
    ));
    const m = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>Dark Wood</.exec(svg);
    expect(m).not.toBeNull();
    // North of row 10's centre (y = 328) — over its own ground, not adrift.
    expect(Number(m![2])).toBeLessThan(328);
  });
});
