/**
 * A field's regional override draws its state (#305, spec 04 §5).
 *
 * §5 promises each affordance takes its fill "from the theme's `<field>` /
 * `<field>.<state>` entry". The state half was never asked for: every region
 * entity resolved through `terrainFill(chain)` with no context, so a patch
 * written `dark` and a patch written `daylight` emitted the identical polygon
 * — the base `light` fill, fully opaque, with the theme's declared weights
 * reaching nothing. A lightless stretch and a sunlit one were one mark.
 *
 * This matters more since #287, which documents an ambient baseline as a
 * battlemap concern and sends region authors here instead. The affordance the
 * warning recommends has to be able to tell sunlight from pitch dark.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const patch = (state: string): string =>
  ["map: region", "extent: 400x300mi", "", "[terrain]",
   "forest wood : blob at (200,150) size=120mi",
   `light "Patch" : blob at (100,100) size=60mi ${state}`].join("\n");

/** The override's own polygon, read by walking its group to the matching close. */
const polygonOf = (svg: string, id: string): string => {
  const at = svg.indexOf(id);
  expect(at, `no group ${id}`).toBeGreaterThan(-1);
  const from = svg.lastIndexOf("<g", at);
  let depth = 0;
  let end = svg.length;
  for (const m of svg.slice(from).matchAll(/<g\b|<\/g>/g)) {
    depth += m[0] === "<g" ? 1 : -1;
    if (depth === 0) { end = from + m.index! + m[0].length; break; }
  }
  // Scoped to the group on purpose: reading the first `opacity=` within a
  // window of the id is what produced a wrong figure in the issue this fixes.
  return /<polygon[^>]*>/.exec(svg.slice(from, end))?.[0] ?? "";
};

const attr = (el: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(el)?.[1] ?? null;

describe("each state draws as the theme declares it", () => {
  const EXPECTED = [
    ["daylight", "#ffd98a", "0.20"],
    ["dark", "#10131a", "0.86"],
    ["dim", "#1b2029", "0.55"],
    ["moonlight", "#1d2740", "0.45"],
  ] as const;

  for (const [state, fill, opacity] of EXPECTED) {
    it(`${state} — fill ${fill} at ${opacity}`, () => {
      const poly = polygonOf(renderSource(patch(state)).svg, "cd-document-patch");
      expect(attr(poly, "fill")).toBe(fill);
      expect(attr(poly, "opacity")).toBe(opacity);
    });
  }

  it("two states are not the same mark, which is the property that failed", () => {
    const dark = polygonOf(renderSource(patch("dark")).svg, "cd-document-patch");
    const day = polygonOf(renderSource(patch("daylight")).svg, "cd-document-patch");
    expect(dark).not.toBe(day);
  });
});

describe("what stays as it was", () => {
  it("a field override with no state still draws, on the base entry", () => {
    const src = ["map: region", "extent: 400x300mi", "", "[terrain]",
      "forest wood : blob at (200,150) size=120mi",
      'light "Patch" : blob at (100,100) size=60mi'].join("\n");
    const poly = polygonOf(renderSource(src).svg, "cd-document-patch");
    expect(attr(poly, "fill")).toBe("#ffd98a");
    expect(attr(poly, "opacity")).toBeNull(); // no state, so no declared weight
  });

  it("a NON-field entity carrying a state is untouched", () => {
    // Scoped to fields deliberately: the same lookup serves every region
    // entity, and widening it would change how any state on any word draws.
    // That is #206's question, not this one — so a marsh stays a marsh.
    const src = ["map: region", "extent: 400x300mi", "", "[terrain]",
      "marsh bog : blob at (200,150) size=120mi difficult"].join("\n");
    const poly = polygonOf(renderSource(src).svg, "cd-document-bog");
    expect(attr(poly, "opacity")).toBeNull();
  });
});
