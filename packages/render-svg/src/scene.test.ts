/**
 * The scene export (#355, ADR 0051). Determinism is asserted rather than
 * asserted-about, and the map-unit claim is tested where it is falsifiable.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "@chartdown/core";
import { resolveScene, type SceneFeature, type SceneResult } from "./index";

const examplesDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "examples");
const example = (name: string): string => readFileSync(join(examplesDir, name, `${name}.cd`), "utf8");
const sceneOf = (name: string, detail?: string): SceneResult => {
  const src = detail ? example(name).replace(/^(map\s*:.*)$/m, `$1\ndetail: ${detail}`) : example(name);
  return resolveScene(parse(src).document, { mode: "gm" });
};

describe("one map of each kind resolves to a stable scene", () => {
  // gumdrop-vale over vessany for the region: same code path, a snapshot small
  // enough that a reviewer can read the diff. vessany's half-plane is asserted
  // directly below instead.
  for (const name of ["gumdrop-vale", "redford-crossing", "brenmark"]) {
    it(`${name} scene snapshot is stable`, () => {
      expect(JSON.stringify(sceneOf(name), null, 2)).toMatchSnapshot();
    });
  }
});

describe("determinism (spec 02 §8.2)", () => {
  it("same document, same scene", () => {
    expect(JSON.stringify(sceneOf("vessany"))).toBe(JSON.stringify(sceneOf("vessany")));
  });
});

describe("geometry is in map units (ADR 0037), not canvas units", () => {
  it("a region's field is its own extent, whatever the canvas is", () => {
    const sc = sceneOf("vessany");
    expect(sc.unit).toBe("mi");
    expect(sc.extent).toEqual({ w: 900, h: 600 });
    for (const f of sc.features) {
      const g = f.geometry;
      if (!g) continue;
      const pts = "at" in g ? [g.at] : "cells" in g ? g.cells : g.points;
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.y).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(sc.extent.w + 1);
        expect(p.y).toBeLessThanOrEqual(sc.extent.h + 1);
      }
    }
  });

  /**
   * `detail:` doubles the region canvas (ADR 0020: 820 → 1640). A GRID map has
   * no such knob — its canvas is `CELL`-based — so its scene must not move at
   * all, and this asserts that.
   *
   * A REGION's scene DOES move, and it is not asserted invariant because it
   * is not. Organic finishing runs in canvas space (`organicOutline` skips an
   * edge shorter than `QUANTUM`, which is 0.01 of a canvas PIXEL), so a larger
   * canvas grows texture: `examples/vessany`'s coast has 400 vertices at
   * `overview` and 665 at `reference`. The dependence then PROPAGATES through
   * relational placement — a settlement sited against that coast moves with it,
   * so 4 of vessany's 7 points shift, by up to 0.17 mi, and outlines by up to
   * 20 mi. That is the cost of exporting what is DRAWN rather than what was
   * declared, which this export chooses deliberately, and it is why `detail:`
   * is named as an input to the determinism contract rather than hoped away.
   *
   * (Comparing whole scenes across this edit would mislead anyway: inserting a
   * header shifts every later source line, so `line` and every `@anon-<line>`
   * anchor shift with it. Compare geometry positionally.)
   */
  for (const name of ["redford-crossing", "brenmark"]) {
    it(`${name} — a grid map's geometry is untouched by detail:`, () => {
      const a = sceneOf(name);
      const b = sceneOf(name, "reference");
      expect(b.extent).toEqual(a.extent);
      expect(b.features.length).toBe(a.features.length);
      for (let i = 0; i < a.features.length; i++) {
        const ga = a.features[i]!.geometry;
        const gb = b.features[i]!.geometry;
        expect(JSON.stringify(gb)).toBe(JSON.stringify(ga));
      }
    });
  }

  it("a region's own extent and unit are untouched by detail:", () => {
    const a = sceneOf("vessany");
    const b = sceneOf("vessany", "reference");
    expect(b.unit).toBe(a.unit);
    expect(b.extent).toEqual(a.extent);
  });
});

describe("a half-plane resolves, with the reason it has that shape", () => {
  it("`sea : west of coast` is a clipped polygon that says what it was cut against", () => {
    const sea = sceneOf("vessany").features.find((f) => f.anchor === "the-argen-sea");
    expect(sea).toBeDefined();
    const g = sea!.geometry as { kind: string; points: unknown[]; from?: { halfPlane: string; of?: string } };
    expect(g.kind).toBe("polygon");
    // Not a ten-point dot: the failure a re-deriving host produced for this
    // exact line, and the evidence in #355.
    expect(g.points.length).toBeGreaterThan(100);
    expect(g.from).toEqual({ halfPlane: "west", of: "coast" });
  });
});

describe("a grid map's geometry is cells, and it carries its levels", () => {
  it("a battlemap resolves in cell coordinates with a derived perimeter", () => {
    const sc = sceneOf("redford-crossing");
    expect(sc.unit).toBe("cell");
    expect(sc.extent).toEqual({ w: 20, h: 15 });
    const withCells = sc.features.filter((f) => f.geometry?.kind === "cells");
    expect(withCells.length).toBeGreaterThan(0);
    for (const f of withCells) expect(f.perimeter!.length).toBeGreaterThan(0);
    expect(sc.walls!.blockers.length).toBeGreaterThan(0);
  });

  it("a multi-level battlemap is ONE scene carrying every level", () => {
    const sc = sceneOf("fairwater-manor");
    expect(sc.levels).toEqual(["upper", "ground", "cellar"]);
    expect(new Set(sc.features.map((f) => f.level)).size).toBeGreaterThan(1);
  });

  it("options.level narrows it, the way render does", () => {
    const one = resolveScene(parse(example("fairwater-manor")).document, { mode: "gm", level: "cellar" });
    expect(one.features.length).toBeGreaterThan(0);
    expect([...new Set(one.features.map((f) => f.level))]).toEqual(["cellar"]);
  });

  it("a hexcrawl resolves in hex coordinates, hex lines included", () => {
    const sc = sceneOf("brenmark");
    expect(sc.unit).toBe("hex");
    expect(sc.features.some((f) => f.section === "hexes")).toBe(true);
  });
});

describe("a redaction is not the document (ADR 0045)", () => {
  it("the scene is produced per mode, so a host does not filter one itself", () => {
    const doc = parse(example("fairwater-manor")).document;
    const player = resolveScene(doc, { mode: "player" });
    const gm = resolveScene(doc, { mode: "gm" });
    expect(player.mode).toBe("player");
    expect(gm.features.length).toBeGreaterThan(player.features.length);
  });
});

describe("the scene carries no ink (ADR 0037's split is the membership test)", () => {
  it("no stroke, fill, font or opacity reaches a consumer", () => {
    const json = JSON.stringify(sceneOf("redford-crossing")) + JSON.stringify(sceneOf("vessany"));
    for (const inkish of ["stroke", "fill", "font", "opacity", "#"]) {
      expect(json.toLowerCase()).not.toContain(inkish);
    }
  });
});

/**
 * The committed `examples/` scene is a worked example for a consuming host, so
 * it has to still be what the renderer produces. A generated artifact nobody
 * checks is a document that quietly starts lying.
 */
describe("the examples/ scene artifact is current", () => {
  it("gumdrop-vale.scene.json matches resolveScene", () => {
    const onDisk = readFileSync(join(examplesDir, "gumdrop-vale", "gumdrop-vale.scene.json"), "utf8");
    expect(onDisk).toBe(JSON.stringify(sceneOf("gumdrop-vale"), null, 2) + "\n");
  });
});
