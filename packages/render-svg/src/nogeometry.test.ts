/**
 * An entity that resolves to no geometry contributes no element (#325, ADR 0049).
 *
 * `area C4..D5` on a gridless map filtered its arguments down to the points
 * among them, found none, and assigned the empty list anyway — so
 * `<polygon points=""/>` reached the output, an element nothing can draw.
 *
 * The refusal in the parser does not remove it on its own: `render`
 * deliberately proceeds past errors, writing the file and exiting 1. So this
 * is asserted at the render, not at the diagnostic.
 *
 * The BYTE COMPARISON is the assertion that matters. A presence check passes
 * on the broken renderer — the element is there, it is just undrawable — which
 * is the methodological lesson this folder produced: vary the payload, not the
 * presence.
 *
 * An outline of ONE or TWO points is deliberately untouched. `area (100,100)
 * (200,200)` still checks clean and still draws a two-vertex polygon; that is
 * a live silent defect reachable with points alone, and it is filed separately
 * rather than folded into this change.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const region = (...lines: string[]): string =>
  ["# G", "map: region", "extent: 1000x1000", "", "[terrain]", ...lines].join("\n");

describe("no geometry means no element", () => {
  it("emits no degenerate polygon for an area that resolved to nothing", () => {
    const svg = renderSource(region("forest w : area C4..D5")).svg;
    expect(svg).not.toContain('points=""');
  });

  it("renders byte-identically to the same document without the line", () => {
    const withIt = renderSource(region("forest w : area C4..D5")).svg;
    const without = renderSource(region()).svg;
    expect(withIt).toBe(without);
  });

  it("still says so — the render is silent about nothing", () => {
    const errors = renderSource(region("forest w : area C4..D5")).diagnostics
      .filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
  });

  it("leaves a two-point outline exactly as it was (filed separately, not fixed here)", () => {
    const svg = renderSource(region("forest w : area (100,100) (200,200)")).svg;
    expect(svg).toContain('points="82,82 164,164"');
  });
});
