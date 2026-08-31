/**
 * No negative geometry attribute reaches the output (#375).
 *
 * A negative `stroke-width`, `r`, `width` or `height` is invalid SVG: a
 * consumer may drop the attribute, drop the element, or refuse the document.
 * `width=-2` produced `stroke-width="-54.4"` and `size=-2` produced
 * `r="-24.32"`, both with `check` reporting ok.
 *
 * The parser now refuses a negative pair value, so this asserts the PROPERTY
 * rather than that one route to it — a negative arriving from arithmetic
 * instead of from a document would be just as invalid, and nothing else was
 * watching for it.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSource } from "./index";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const NEGATIVE = /(stroke-width|width|height|\br|rx|ry)="-[0-9.]/;

describe("no render emits a negative geometry attribute", () => {
  const examples = readdirSync(join(root, "examples"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it("finds the corpus at all", () => {
    expect(examples.length).toBeGreaterThan(5); // guards the sweep below
  });

  it.each(examples)("%s, both modes, with and without its committed theme", (name) => {
    const dir = join(root, "examples", name);
    const src = readFileSync(join(dir, `${name}.cd`), "utf8");
    // THE THEMED ROUTE COUNTS (#375 review). This swept only the default theme,
    // while its own comment claimed to assert the property rather than one
    // route to it — and a theme is the other route a number reaches an
    // attribute. A malformed theme still gets there; that is its own issue.
    const themes = readdirSync(dir).filter((f) => f.endsWith(".theme.cd"));
    for (const theme of [undefined, ...themes]) {
      const opts = theme === undefined ? {} : { theme: readFileSync(join(dir, theme), "utf8") };
      for (const mode of ["gm", "player"] as const) {
        const svg = renderSource(src, { ...opts, mode }).svg;
        const hit = NEGATIVE.exec(svg);
        expect(hit?.[0], `${name} (${mode}${theme ? ", " + theme : ""}) emitted ${hit?.[0]}`).toBeUndefined();
      }
    }
  });


  it("a MALFORMED theme cannot reach the output either (#388)", () => {
    // The route the review found open: this test swept renders, and a theme is
    // the other way a number reaches an attribute. Theme values are now
    // validated and dropped at parse time, so the defaults apply — but the
    // property is asserted here rather than assumed from that.
    const bad = ["kind: theme", "", "[theme]",
      "building : stroke=#2e2217 width=-4",
      "light.dark : fill=#001122 opacity=80",
      "forest : fill=#2f4f2f dash=abc"].join("\n");
    const src = ["map: battlemap", "grid: square 12x10", "scale: 5ft", "light: dark", "",
      "[terrain]", "earth : area A1..L10", "forest : area A1..C3", "",
      "[structures]", "building room1 : B2..F6"].join("\n");
    for (const mode of ["gm", "player"] as const) {
      const svg = renderSource(src, { theme: bad, mode }).svg;
      expect(NEGATIVE.exec(svg)?.[0], `${mode} emitted a negative`).toBeUndefined();
      expect(svg, `${mode} emitted an out-of-range opacity`).not.toContain('opacity="80"');
      expect(svg, `${mode} emitted a non-numeric dash`).not.toContain('stroke-dasharray="abc"');
    }
  });

  it("and the check is not vacuous", () => {
    // Positive control: the pattern must actually match a negative attribute,
    // or the sweep above proves nothing.
    expect(NEGATIVE.test('<circle r="-24.32"/>')).toBe(true);
    expect(NEGATIVE.test('<polyline stroke-width="-54.4"/>')).toBe(true);
    expect(NEGATIVE.test('<circle r="24.32"/>')).toBe(false);
  });
});
