// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mountChartdownBlock, type BlockIO } from "./block";

const SOURCE = [
  "# Test Map",
  "map: battlemap",
  "grid: square 6x6",
  "[structures]",
  'building shed "Shed" : B2..D4',
  "  door : C4.s",
  "[tokens]",
  'ogre "Gruk" : E5 hidden',
].join("\n");

interface Written {
  name: string;
  contents: string;
}

function makeIO(withRaster = false): { io: BlockIO; written: Written[]; notices: string[] } {
  const written: Written[] = [];
  const notices: string[] = [];
  const io: BlockIO = {
    writeFile: async (name, contents) => {
      written.push({ name, contents });
    },
    notify: (m) => notices.push(m),
    ...(withRaster
      ? {
          rasterize: async () => "FAKEPNGBASE64",
        }
      : {}),
  };
  return { io, written, notices };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("the per-map toolbar", () => {
  it("toggles GM view in place, re-rendering the map", () => {
    const el = document.createElement("div");
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", io: makeIO().io });
    const toggle = el.querySelector<HTMLButtonElement>(".chartdown-mode-toggle")!;
    expect(toggle.textContent).toBe("Player view");
    expect(el.innerHTML).not.toContain("Gruk");
    toggle.click();
    expect(toggle.textContent).toBe("GM view");
    expect(el.innerHTML).toContain("Gruk");
    toggle.click();
    expect(el.innerHTML).not.toContain("Gruk");
  });

  it("exports SVG next to the note, named by map and mode", async () => {
    const el = document.createElement("div");
    const { io, written, notices } = makeIO();
    mountChartdownBlock(SOURCE, el, { initialMode: "gm", baseName: "test-map", io });
    const buttons = [...el.querySelectorAll("button")];
    buttons.find((b) => b.textContent === "Export SVG")!.click();
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]!.name).toBe("test-map-gm.svg");
    expect(written[0]!.contents).toContain("<svg");
    expect(notices[0]).toContain("test-map-gm.svg");
  });

  it("exports UVTT with the rasterized image plugged in", async () => {
    const el = document.createElement("div");
    const { io, written } = makeIO(true);
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Export UVTT")!.click();
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]!.name).toBe("test-map.dd2vtt");
    const uvtt = JSON.parse(written[0]!.contents) as Record<string, unknown>;
    expect((uvtt["resolution"] as { map_size: { x: number } }).map_size.x).toBe(6);
    expect(uvtt["image"]).toBe("FAKEPNGBASE64");
    expect((uvtt["portals"] as unknown[]).length).toBe(1);
  });

  it("exports one UVTT file per level for multi-level maps", async () => {
    const multi = [
      "# Tower",
      "map: battlemap",
      "grid: square 6x6",
      "levels: top base",
      "level: base",
      "[structures]",
      'building tower "Tower" : B2..D4',
      "[terrain top]",
      "air : area A1..F6",
    ].join("\n");
    const el = document.createElement("div");
    const { io, written } = makeIO(true);
    mountChartdownBlock(multi, el, { initialMode: "player", baseName: "tower", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Export UVTT")!.click();
    await flush();
    expect(written.map((w) => w.name).sort()).toEqual(["tower-base.dd2vtt", "tower-top.dd2vtt"]);
  });

  it("refuses UVTT for non-battlemaps with a notice, writing nothing", async () => {
    const hex = ["map: hexcrawl", "grid: hex 3x3 pointy odd-row", "[hexes]", "A1 sea"].join("\n");
    const el = document.createElement("div");
    const { io, written, notices } = makeIO();
    mountChartdownBlock(hex, el, { initialMode: "player", baseName: "hexy", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Export UVTT")!.click();
    await flush();
    expect(written).toHaveLength(0);
    expect(notices.some((n) => n.includes("battlemap-only"))).toBe(true);
  });
});
