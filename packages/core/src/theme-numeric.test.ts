/**
 * A theme's numeric properties are checked (#388).
 *
 * Spec 08 §3's `THEME_PROPS` is a closed set of nine, and only `bank=` was ever
 * validated against its own values. The rest were stored verbatim and read
 * later with `Number(...) || <default>`, or pasted straight into an SVG
 * attribute — so a theme could produce output no consumer can render, with
 * `check` reporting `ok`.
 *
 *   opacity=80   -> opacity="80", clamped to 1 by consumers: the darkness wash
 *                   blacks the whole sheet out. This is the one a themer will
 *                   actually write, reaching for a percentage.
 *   width=-4     -> stroke-width="-4", invalid SVG
 *   width=abc    -> silently the default; the line the themer wrote did nothing
 *   dash=abc     -> stroke-dasharray="abc", invalid SVG
 *
 * Unlike a document's `key=value` pairs (#375), there is no list to invent
 * here: the set is closed by design, which is why this could be done at all.
 *
 * WARN AND DROP, matching `bank=`. A theme is presentation, and refusing a map
 * over a stroke width would be the wrong trade — the value is discarded so the
 * default applies and the map still renders.
 */
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "./diagnostics";
import { parseThemeDocument } from "./theme";

const theme = (line: string): { warnings: string[]; stored: Record<string, string> } => {
  const diagnostics: Diagnostic[] = [];
  const doc = parseThemeDocument(["kind: theme", "", "[theme]", line].join("\n"), diagnostics);
  return {
    warnings: diagnostics.map((d) => d.message),
    stored: doc.entries[0]?.pairs ?? {},
  };
};

describe("a malformed numeric property is reported and dropped", () => {
  it("opacity=80, the percentage a themer means", () => {
    const { warnings, stored } = theme("light.dark : fill=#001122 opacity=80");
    expect(warnings.join("\n")).toContain("80% is '0.8', not '80'");
    expect(stored.opacity).toBeUndefined(); // dropped, so the default applies
    expect(stored.fill).toBe("#001122");    // and the rest of the line survives
  });

  it("a negative width, which reached the output as invalid SVG", () => {
    const { warnings, stored } = theme("building : stroke=#2e2217 width=-4");
    expect(warnings.join("\n")).toContain("'width=-4' is not a number");
    expect(stored.width).toBeUndefined();
    expect(stored.stroke).toBe("#2e2217");
  });

  it("values that are not numbers at all", () => {
    for (const [line, want] of [
      ["building : width=abc", "width=abc"],
      ["building : width=2px", "width=2px"],
      ["building : edge=wide", "edge=wide"],
      ["forest : dash=abc", "dash=abc"],
    ] as const) {
      expect(theme(line).warnings.join("\n"), line).toContain(want);
    }
  });
});

describe("what stays legal", () => {
  it("every numeric value the committed themes actually write", () => {
    // Measured from `examples/*/*.theme.cd`: these are the real spellings, and
    // a check that refused any of them would be worse than no check.
    for (const line of [
      "building : width=2", "building : width=2.5", "building : width=1.4",
      "border : edge=6", "border : edge=3",
      "road : dash=3,3", "road : dash=7,4", "road : dash=2,4",
    ]) {
      expect(theme(line).warnings, line).toEqual([]);
    }
  });

  it("opacity across its whole legal range, and zero width", () => {
    for (const v of ["0", "0.5", "1"]) expect(theme(`x : opacity=${v}`).warnings, v).toEqual([]);
    // A zero stroke is a deliberate "draw no line", not a malformed number.
    expect(theme("x : width=0").warnings).toEqual([]);
  });

  it("bank= is still checked its own way", () => {
    // The precedent this follows must keep working.
    expect(theme("coast : bank=sideways").warnings.join("\n")).toContain("bank=sideways");
    expect(theme("coast : bank=water").warnings).toEqual([]);
  });

  it("a non-numeric property is not caught by a numeric rule", () => {
    expect(theme("forest : fill=#2f4f2f").warnings).toEqual([]);
    expect(theme("tree : glyph=conifer").warnings).toEqual([]);
  });
});
