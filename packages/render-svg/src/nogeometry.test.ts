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
An outline of ONE or TWO points was deliberately left alone here and filed as
 * #343, with the old expectation pinned below as a tripwire so that fixing it
 * would fail loudly rather than pass unnoticed. It has since been fixed: the
 * plain outline route now warns by the same rule the framed route always used,
 * and draws nothing — so the tripwire has been replaced by an assertion of the
 * behaviour it was waiting for. The tripwire worked exactly as intended: it
 * went red on the fix, and it was the only test that did.
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

  it("draws nothing for a two-point outline, and says why (#343)", () => {
    // Was: `points="82,82 164,164"` — a LINE where the document asked for an
    // area, with no diagnostic anywhere.
    const { svg, diagnostics } = renderSource(region("forest w : area (100,100) (200,200)"));
    expect(svg).toBe(renderSource(region()).svg);
    // Exactly ONE. While writing this fix a failed edit left two copies of the
    // check in place and the warning fired twice; a `toContain` over the joined
    // messages was blind to it, and every test still passed.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("outline of 2 points — an outline needs at least three");
  });

  it("and the same for one point", () => {
    const { svg, diagnostics } = renderSource(region("forest w : area (100,100)"));
    expect(svg).toBe(renderSource(region()).svg);
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("outline of 1 point —");
  });

  it("but a three-point outline is untouched", () => {
    // The rule is "fewer than three", so three must still draw and stay quiet.
    const { svg, diagnostics } = renderSource(region("forest w : area (100,100) (200,200) (150,300)"));
    expect(svg).not.toBe(renderSource(region()).svg);
    expect(diagnostics.filter((d) => d.message.includes("needs at least three"))).toEqual([]);
  });
});
