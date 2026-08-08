/**
 * A theme can repaint the whole sheet, furniture included (#286).
 *
 * #150 wired the `ink` surface into entity drawing and stopped at the
 * entities. The document title, the level caption, the compass and the scale
 * bar kept the bare `INK` constant, and the coordinate letters carried a
 * literal `#8a8272` — not even the constant — so no lever of any kind reached
 * the letters a GM calls out in play. Spec 08 §2 lists `ink` in the closed
 * surface set and exempts no part of the sheet.
 *
 * The renderer reported this itself, which is the neatest confirmation
 * available: #116's dead-declaration lint said `'ink' is a surface, but 'fill'
 * is not read for it in this render`. It was right, and the gap was underneath
 * it — so that lint going quiet is one of the assertions here.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const THEME = ["kind: theme", "", "[theme]", "ink : fill=#c2185b"].join("\n");

const doc = (...extra: string[]): string =>
  ["# The Hidden Lab", "map: battlemap", "grid: square 4x3", "scale: 5ft",
   "numbers: on", "compass: on", ...extra].join("\n");

const themed = (src: string): { svg: string; diagnostics: { message: string }[] } =>
  renderSource(src, { theme: THEME });

describe("the ink surface reaches document furniture", () => {
  it("the title", () => {
    expect(themed(doc()).svg).toMatch(/fill="#c2185b"[^>]*>The Hidden Lab/);
  });

  it("the coordinate letters and numbers", () => {
    // The case the issue's title undersells: these never went through `INK`,
    // so routing furniture through the surface would not have fixed them.
    const marks = [...themed(doc()).svg.matchAll(/fill="#c2185b"[^>]*>([A-D1-3])</g)];
    expect(marks.length).toBe(7); // four columns, three rows
  });

  it("the compass", () => {
    expect(themed(doc()).svg).toMatch(/stroke="#c2185b"/);
    expect(themed(doc()).svg).toMatch(/fill="#c2185b"[^>]*>N</);
  });

  it("the level caption", () => {
    const src = ["# The Hidden Lab", "map: battlemap", "grid: square 4x3", "scale: 5ft",
      "levels: ground cellar", "", "[structures]", "building hall : A1..B2 level=ground", "  door : at A1.n"].join("\n");
    expect(themed(src).svg).toMatch(/fill="#c2185b"[^>]*>— ground —/);
  });

  it("and the dead-declaration lint goes quiet, which is how the gap was found", () => {
    const said = themed(doc()).diagnostics.map((d) => d.message).join(" ");
    expect(said).not.toMatch(/nothing written here will reach the map/);
  });
});

describe("a sheet nobody themed is left exactly as it was", () => {
  it("the coordinates stay subdued — as ink at an opacity, not as a literal", () => {
    // The old `#8a8272` is ink at 60% over paper (0.590/0.602/0.622 solved per
    // channel), so the quietness survives as a rendering choice while the
    // COLOUR comes from the surface. A fallback could not have done this: the
    // default theme declares `ink`, so a surface lookup never reaches one.
    const { svg } = renderSource(doc());
    expect(svg).toMatch(/fill="#3d3629"[^>]*opacity="0.6"[^>]*>A</);
    expect(svg).toMatch(/fill="#3d3629"[^>]*>The Hidden Lab/);
    expect(svg).not.toContain("#8a8272");
  });

  it("an unthemed sheet carries no themed colour at all", () => {
    // Named for what it checks: committed examples DO move here, by the
    // coordinate treatment above. What must not happen is a theme colour
    // reaching a render nobody themed.
    const { svg } = renderSource(doc());
    expect(svg).not.toContain("#c2185b");
  });
});
