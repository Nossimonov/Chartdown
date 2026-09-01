/**
 * No space-separated colour function reaches the output (#370).
 *
 * `render-svg` emitted CSS Color 4's `hsl(338 32% 55%)`. Browsers parse it;
 * older SVG rasterizers do not — cairosvg and friends drop the fill, and a
 * reporter's realm overlays arrived **opaque black**. The document was valid,
 * the render was valid, and the output was unusable in their pipeline with no
 * error anywhere.
 *
 * The audience for these files is VTT importers and map pipelines: exactly the
 * long tail of SVG consumers least likely to track CSS Color 4. The project
 * already accepts this kind of constraint — ADR 0014's provenance marker and
 * the UVTT export both exist because something downstream has to read this —
 * and the space form buys nothing a map author can perceive.
 *
 * This test is the part that outlives the fix. One call site was wrong; the
 * risk is the *next* colour surface, so the assertion is over rendered output
 * rather than over `wordTint`, and it covers every CSS Color 4 function rather
 * than only the one that broke.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderSource } from "./index";

/**
 * A colour function whose arguments are space-separated rather than comma-
 * separated — the CSS Color 4 form. Also catches `lab`/`lch`/`oklab`/`oklch`/
 * `color()`, which have no comma form at all and so must not appear either.
 */
const SPACE_FORM = /\b(?:hsla?|rgba?)\([^),]*\)|\b(?:lab|lch|oklab|oklch|color)\(/g;

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const cdFiles = (): string[] =>
  walk("examples").filter((p) => p.endsWith(".cd") && !p.includes(".theme"));

describe("the instrument detects the form it is looking for", () => {
  it("matches what the renderer used to emit, and not the fix", () => {
    // Without this, a regex that matched nothing would pass every test below.
    expect("fill=\"hsl(338 32% 55%)\"".match(SPACE_FORM)).not.toBeNull();
    expect("fill=\"hsl(338, 32%, 55%)\"".match(SPACE_FORM)).toBeNull();
    expect("fill=\"rgb(1 2 3)\"".match(SPACE_FORM)).not.toBeNull();
    expect("fill=\"oklch(70% 0.1 200)\"".match(SPACE_FORM)).not.toBeNull();
    expect("fill=\"#ffd98a\"".match(SPACE_FORM)).toBeNull();
  });
});

describe("rendered output", () => {
  it("uses no space-separated colour function, in either mode", () => {
    const files = cdFiles();
    expect(files.length).toBeGreaterThan(0); // a silent empty corpus proves nothing
    for (const p of files) {
      const src = readFileSync(p, "utf8");
      for (const mode of ["gm", "player"] as const) {
        const found = renderSource(src, { mode }).svg.match(SPACE_FORM);
        expect(found, `${p} (${mode})`).toBeNull();
      }
    }
  });

  it("and the corpus does emit colours, so the check has something to see", () => {
    // Calibration for the null above: `wordTint` is reached by these documents.
    const anyHsl = cdFiles().some((p) => renderSource(readFileSync(p, "utf8"), { mode: "gm" }).svg.includes("hsl("));
    expect(anyHsl).toBe(true);
  });
});

describe("committed SVGs", () => {
  it("carry the same form, so a stale regeneration is caught", () => {
    const svgs = walk("examples").filter((p) => p.endsWith(".svg"));
    expect(svgs.length).toBeGreaterThan(0);
    for (const p of svgs) {
      expect(readFileSync(p, "utf8").match(SPACE_FORM), p).toBeNull();
    }
  });

  it("and still carry ADR 0014's provenance marker", () => {
    // The colour fix was applied as a surgical edit rather than a regeneration
    // precisely to keep this: the CLI omits the marker (#349), so regenerating
    // these locally would have stripped it.
    //
    // Scoped to the files that carry a colour — which is exactly the set the
    // edit touched. Asserting it of EVERY committed SVG fails on
    // `gumdrop-vale-candy.svg`, a themed variant that has no marker and no
    // `hsl()`, and which this change never opened. That is #349's symptom
    // sitting in the corpus, not a consequence of this fix, and turning it into
    // this PR's failure would be the wrong place to report it.
    const touched = walk("examples")
      .filter((f) => f.endsWith(".svg") && readFileSync(f, "utf8").includes("hsl("));
    expect(touched.length).toBe(14);
    for (const p of touched) {
      expect(readFileSync(p, "utf8"), p).toContain("data-chartdown-output=");
    }
  });
});
