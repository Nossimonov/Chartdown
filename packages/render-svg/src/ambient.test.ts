/**
 * Ambient light washes (#263).
 *
 * `daylight` had no theme entry and drew a wash anyway: the base `light` fill
 * — which exists for emitter pools — answered the lookup, and the missing
 * opacity fell through to a default written for darkness. So the brightest
 * condition a map could declare rendered at 0.82, heavier than `dim` or
 * `moonlight`, and a campfire's pool became the brightest thing on a sunlit
 * map, since the pool is a hole cut in that wash.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";
import { Theme } from "./theme";

const map = (light?: string): string =>
  ["map: battlemap", "grid: square 14x9", "scale: 5ft", ...(light ? [`light: ${light}`] : []), "",
   "[structures]", 'building hall "The Hall" : C2..J7', "  door : F7.s", "",
   "[features]", "campfire c : H5"].join("\n");

const washOf = (svg: string): { fill: string; opacity: number } | null => {
  const m = /<rect[^>]*fill="(#[0-9a-f]{6})" opacity="([\d.]+)"[^>]*mask=/.exec(svg);
  return m ? { fill: m[1]!, opacity: Number(m[2]) } : null;
};

describe("every ambient state declares its own weight", () => {
  it("all four, so the next word added cannot inherit a darkness default", () => {
    const t = Theme.resolve(undefined, []);
    for (const state of ["dark", "dim", "daylight", "moonlight"]) {
      expect(t.prop(["light"], "fill", { state }), `light.${state} fill`).toBeDefined();
      expect(t.prop(["light"], "opacity", { state }), `light.${state} opacity`).toBeDefined();
    }
  });

  it("daylight is the lightest of them, not the heaviest", () => {
    const t = Theme.resolve(undefined, []);
    const weight = (state: string): number => Number(t.prop(["light"], "opacity", { state }));
    expect(weight("daylight")).toBeLessThan(weight("moonlight"));
    expect(weight("daylight")).toBeLessThan(weight("dim"));
    expect(weight("daylight")).toBeLessThan(weight("dark"));
  });
});

describe("what daylight draws", () => {
  it("is a cast, not a filter", () => {
    const wash = washOf(renderSource(map("daylight")).svg)!;
    expect(wash.fill).toBe("#ffd98a");
    expect(wash.opacity).toBeLessThanOrEqual(0.25);
  });

  it("leaves the map legible — the walls keep their ink", () => {
    // The complaint was "overpowering": at 0.82 the black walls washed brown.
    // Asserting the wash weight is the proxy the render actually depends on.
    const lit = renderSource(map("daylight")).svg;
    const plain = renderSource(map()).svg;
    expect(plain).not.toContain('mask=');       // no wash at all without the header
    expect(washOf(lit)!.opacity).toBeLessThan(0.5);
  });

  it("says nothing, because every state is declared", () => {
    const { diagnostics } = renderSource(map("daylight"));
    expect(diagnostics.filter((d) => /no opacity/.test(d.message))).toEqual([]);
  });
});

describe("a tone with no weight is reported", () => {
  it("warns, and still draws rather than silently disabling the theme", () => {
    const theme = ["kind: theme", "", "[theme]", "light.eclipse : fill=#2b2b3a"].join("\n");
    const src = ["map: battlemap", "grid: square 10x8", "scale: 5ft", "light: eclipse", "",
                 "[structures]", 'building hall "Hall" : C2..F6', "  door : D6.s"].join("\n");
    const { svg, diagnostics } = renderSource(src, { theme });
    expect(diagnostics.some((d) => d.severity === "warning" && /no opacity/.test(d.message))).toBe(true);
    expect(washOf(svg)).not.toBeNull(); // reported, not dropped
  });
});

/**
 * A pool that fills its field is REPORTED, not redrawn (#290, ADR 0050).
 *
 * The half ADR 0042 left open on purpose. Clipping bounded where a pool may be
 * drawn; inside the field the hole is still the pool's own shape at full
 * weight, so a lamp that out-ranges its room removes the wash entirely and a
 * `light: dark` map renders with no darkness on it.
 *
 * That render is faithful — a 60ft lantern does light a 15ft room — so nothing
 * about the drawing changes here. What changes is that the author is told.
 */
describe("a pool that fills its field is reported (#290)", () => {
  const filled = ["map: battlemap", "grid: square 3x3", "scale: 5ft", "light : dark", "",
                  "[features]", "lantern : B2 light=60ft"].join("\n");
  const reports = (src: string): string[] =>
    renderSource(src).diagnostics.filter((d) => /never shows/.test(d.message)).map((d) => `${d.line}: ${d.message}`);

  it("names the emitter and its declared range, on the emitter's own line", () => {
    const out = reports(filled);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'lantern' reaches 60ft");
    expect(out[0]).toContain("no part of the map renders dark");
    expect(out[0]).toMatch(/^7: /);            // the [features] line, not the header
  });

  it("changes NOTHING about the render, which is the whole point", () => {
    // If this ever fails the decision has been reversed, not refined: ADR 0050
    // rests on the pool and its cut-out being emitted exactly as before, and
    // the report being the only thing added.
    const { svg } = renderSource(filled);
    expect(svg).toContain('<circle cx="72" cy="72" r="384" fill="#000"/>');
    expect(svg).toContain('maskUnits="userSpaceOnUse" x="24" y="24" width="96" height="96"');
  });

  it("stays quiet when the wash survives", () => {
    const lit = filled.replace("light=60ft", "light=10ft");
    expect(reports(lit)).toEqual([]);
    expect(washOf(renderSource(lit).svg)).not.toBeNull();
  });

  it("stays quiet with no ambient declared — there is no wash to erase", () => {
    expect(reports(filled.replace("light : dark\n", ""))).toEqual([]);
  });

  it("stays quiet for a shadow the pool does not reach into", () => {
    // Measured: a 200ft lantern at C1 with one pillar in the middle lights all
    // FOUR field corners and still leaves 107 of 441 lattice points dark. A
    // corner test would report this map; the field is sampled because of it.
    const notch = ["map: battlemap", "grid: square 5x5", "scale: 5ft", "light : dark", "",
                   "[structures]", "building pillar: C3..C3", "    door : at A1.n", "",
                   "[features]", "lantern : C1 light=200ft"].join("\n");
    expect(reports(notch)).toEqual([]);
  });

  it("reports per panel — a lamp that fills the cellar says nothing about the floor above", () => {
    const levels = ["map: battlemap", "grid: square 3x3", "scale: 5ft", "levels: ground cellar",
                    "light : dark", "", "[features]", "lamp l1 : B2 level=cellar light=60ft"].join("\n");
    const out = reports(levels);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'l1' reaches 60ft");
  });
});
