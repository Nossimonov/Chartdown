import { describe, expect, it } from "vitest";
import { runCheck, runRender, runUvtt } from "./tools";

const VALID = [
  "# Test Map",
  "map: battlemap",
  "grid: square 6x6",
  "[structures]",
  'building shed "Shed" : B2..D4',
  "  door : C4.s",
  "[tokens]",
  'ogre "Gruk" : E5 hidden',
].join("\n");

describe("MCP tool logic (issue #58)", () => {
  it("check: valid documents summarize; warnings surface without failing", () => {
    const ok = runCheck(VALID);
    expect(ok.isError).toBeUndefined();
    expect(ok.text).toContain("ok — valid battlemap");
    const warny = runCheck(
      ["map: battlemap", "grid: square 10x10", "scale: 5ft", "[terrain]", "river r1 : path A5 J5 width=1", "road r2 : path E1 E10"].join("\n"),
    );
    expect(warny.isError).toBeUndefined();
    expect(warny.text).toContain("no ford or bridge");
  });

  it("check: errors fail loud with line numbers and spec citations", () => {
    const bad = runCheck(VALID + "\n[features]\ntable : B2 to B4");
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("INVALID");
    expect(bad.text).toMatch(/line \d+/);
    expect(bad.text).toContain("spec");
  });

  it("render: player mode strips secrets; gm shows them; errors refuse", () => {
    expect(runRender(VALID).text).not.toContain("Gruk");
    expect(runRender(VALID, { mode: "gm" }).text).toContain("Gruk");
    const refused = runRender("map: battlemap\ngrid: square 4x4\n[features]\ntable : on ghost at B2");
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("render refused");
  });

  it("raster: SVG → PNG via wasm with the vendored font (no browser, no system fonts)", async () => {
    const { rasterizePng } = await import("./raster");
    const { text: svg } = runRender(VALID, { mode: "gm" });
    const png = await rasterizePng(svg);
    // PNG magic bytes: \x89 P N G
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.length).toBeGreaterThan(5000);
  });

  it("uvtt: exports geometry JSON, refuses non-battlemaps", () => {
    const out = runUvtt(VALID);
    const uvtt = JSON.parse(out.text) as Record<string, unknown>;
    expect((uvtt["portals"] as unknown[]).length).toBe(1);
    const hex = runUvtt(["map: hexcrawl", "grid: hex 3x3 pointy odd-row", "[hexes]", "A1 sea"].join("\n"));
    expect(hex.isError).toBe(true);
  });
});
