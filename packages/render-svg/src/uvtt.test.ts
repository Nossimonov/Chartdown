import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportUvttSource } from "./index";

const example = (name: string): string =>
  readFileSync(
    join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "examples", name, `${name}.cd`),
    "utf8",
  );

describe("UVTT export (spec 06 §9)", () => {
  it("maps grid+scale to resolution and walls to line_of_sight in grid units", () => {
    const { uvtt, svg, imageRegion, diagnostics } = exportUvttSource(example("redford-crossing"), {});
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(uvtt).toBeTruthy();
    const res = uvtt!["resolution"] as { map_size: { x: number; y: number }; pixels_per_grid: number };
    expect(res.map_size).toEqual({ x: 20, y: 15 });
    expect(res.pixels_per_grid).toBe(70);
    // Ruined Toll House N3..Q6: 16 perimeter edges, minus north+east ruined (8),
    // minus the door and window edges (2) = 6 los walls; portals own their edges.
    const los = uvtt!["line_of_sight"] as unknown[];
    expect(los).toHaveLength(6);
    // every coordinate is inside the grid, in grid units
    for (const seg of los as { x: number; y: number }[][]) {
      for (const p of seg) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(20);
        expect(p.y).toBeLessThanOrEqual(15);
      }
    }
    expect(svg).toContain("<svg");
    expect(imageRegion).toEqual({ x: 24, y: 24, w: 640, h: 480 });
  });

  it("openings become portals: closed doors, and windows as los holes with shut portals", () => {
    const { uvtt } = exportUvttSource(example("redford-crossing"), {});
    const portals = uvtt!["portals"] as { position: { x: number; y: number }; closed: boolean }[];
    expect(portals).toHaveLength(2); // door O6.s + window N4.w
    expect(portals.every((p) => p.closed)).toBe(true);
    const door = portals.find((p) => p.position.y === 6)!; // O6.s: south edge of row 6
    expect(door.position.x).toBe(14.5); // middle of column O
  });

  it("light= entities become lights with ranges in grid units", () => {
    const { uvtt } = exportUvttSource(example("redford-crossing"), {});
    const lights = uvtt!["lights"] as { position: { x: number; y: number }; range: number }[];
    expect(lights).toHaveLength(1); // the campfire
    expect(lights[0]!.position).toEqual({ x: 14.5, y: 6.5 }); // O7 center
    expect(lights[0]!.range).toBe(4); // 20ft at 5ft scale
  });

  it("multi-level docs export one level at a time, defaulting to level:", () => {
    const ground = exportUvttSource(example("fairwater-manor"), {});
    const groundPortals = ground.uvtt!["portals"] as unknown[];
    expect(groundPortals).toHaveLength(14); // 9 doors + 5 windows on the ground floor
    const cellar = exportUvttSource(example("fairwater-manor"), { level: "cellar" });
    expect(cellar.uvtt!["portals"]).toHaveLength(0); // the undercroft has no declared openings
    expect((cellar.uvtt!["line_of_sight"] as unknown[]).length).toBeGreaterThan(0);
    const bogus = exportUvttSource(example("fairwater-manor"), { level: "attic" });
    expect(bogus.uvtt).toBeNull();
    expect(bogus.diagnostics.some((d) => d.message.includes("attic"))).toBe(true);
  });

  it("is battlemap-only, fail-loud", () => {
    const { uvtt, diagnostics } = exportUvttSource(example("brenmark"), {});
    expect(uvtt).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error" && d.message.includes("battlemap-only"))).toBe(true);
  });
});
