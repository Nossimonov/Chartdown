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
