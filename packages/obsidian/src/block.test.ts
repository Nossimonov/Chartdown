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

function makeIO(withRaster = false): { io: BlockIO; written: Written[]; notices: string[]; revealed: string[] } {
  const written: Written[] = [];
  const notices: string[] = [];
  const revealed: string[] = [];
  const io: BlockIO = {
    writeFile: async (name, contents) => {
      written.push({ name, contents });
    },
    notify: (m) => notices.push(m),
    reveal: (name) => revealed.push(name),
    ...(withRaster
      ? {
          rasterize: async () => "FAKEPNGBASE64",
        }
      : {}),
  };
  return { io, written, notices, revealed };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("the per-map toolbar", () => {
  it("toggles GM view in place, re-rendering the map", () => {
    const el = document.createElement("div");
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", folderLabel: "", io: makeIO().io });
    const toggle = el.querySelector<HTMLButtonElement>(".chartdown-mode-toggle")!;
    expect(toggle.textContent).toBe("Player view");
    expect(el.innerHTML).not.toContain("Gruk");
    toggle.click();
    expect(toggle.textContent).toBe("GM view");
    expect(el.innerHTML).toContain("Gruk");
    toggle.click();
    expect(el.innerHTML).not.toContain("Gruk");
  });

  it("exports SVG next to the note, says where, and reveals the file", async () => {
    const el = document.createElement("div");
    const { io, written, notices, revealed } = makeIO();
    mountChartdownBlock(SOURCE, el, { initialMode: "gm", baseName: "test-map", folderLabel: "Maps/", io });
    const buttons = [...el.querySelectorAll("button")];
    buttons.find((b) => b.textContent === "Export SVG")!.click();
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]!.name).toBe("test-map-gm.svg");
    expect(written[0]!.contents).toContain("<svg");
    expect(notices[0]).toContain("Maps/test-map-gm.svg"); // the notice names the vault path
    expect(revealed).toEqual(["test-map-gm.svg"]); // and the file opens in the system explorer
  });

  it("exports UVTT with the rasterized image plugged in", async () => {
    const el = document.createElement("div");
    const { io, written, revealed, notices } = makeIO(true);
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", folderLabel: "", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Export UVTT")!.click();
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]!.name).toBe("test-map.dd2vtt");
    const uvtt = JSON.parse(written[0]!.contents) as Record<string, unknown>;
    expect((uvtt["resolution"] as { map_size: { x: number } }).map_size.x).toBe(6);
    expect(uvtt["image"]).toBe("FAKEPNGBASE64");
    expect((uvtt["portals"] as unknown[]).length).toBe(1);
    expect(revealed).toEqual(["test-map.dd2vtt"]);
    expect(notices[0]).toContain("hidden in Obsidian's explorer"); // .dd2vtt is an unknown extension in-app
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
    mountChartdownBlock(multi, el, { initialMode: "player", baseName: "tower", folderLabel: "", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Export UVTT")!.click();
    await flush();
    expect(written.map((w) => w.name).sort()).toEqual(["tower-base.dd2vtt", "tower-top.dd2vtt"]);
  });

  it("refuses UVTT for non-battlemaps with a notice, writing nothing", async () => {
    const hex = ["map: hexcrawl", "grid: hex 3x3 pointy odd-row", "[hexes]", "A1 sea"].join("\n");
    const el = document.createElement("div");
    const { io, written, notices } = makeIO();
    mountChartdownBlock(hex, el, { initialMode: "player", baseName: "hexy", folderLabel: "", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Export UVTT")!.click();
    await flush();
    expect(written).toHaveLength(0);
    expect(notices.some((n) => n.includes("battlemap-only"))).toBe(true);
  });
});
