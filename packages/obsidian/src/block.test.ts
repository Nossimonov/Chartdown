// @vitest-environment happy-dom
import { parse } from "@chartdown/core";
import { describe, expect, it } from "vitest";
import { chartdownFromClipboard, mountChartdownBlock, type BlockIO } from "./block";

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

function makeIO(withRaster = false, clipboard = ""): { io: BlockIO; written: Written[]; notices: string[]; revealed: string[]; copied: string[]; replaced: string[] } {
  const written: Written[] = [];
  const notices: string[] = [];
  const revealed: string[] = [];
  const copied: string[] = [];
  const replaced: string[] = [];
  const io: BlockIO = {
    writeFile: async (name, contents) => {
      written.push({ name, contents });
    },
    notify: (m) => notices.push(m),
    copy: async (text) => {
      copied.push(text);
    },
    readClipboard: async () => clipboard,
    clipboardHasText: async () => clipboard.length > 0 || copied.length > 0,
    replaceSource: async (s) => {
      replaced.push(s);
    },
    reveal: (name) => revealed.push(name),
    ...(withRaster
      ? {
          rasterize: async () => "FAKEPNGBASE64",
        }
      : {}),
  };
  return { io, written, notices, revealed, copied, replaced };
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

  it("copies the map source headed by the reference breadcrumb — a valid document either way (#88)", async () => {
    const el = document.createElement("div");
    const { io, copied, notices } = makeIO();
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", folderLabel: "", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Copy Chartdown")!.click();
    await flush();
    expect(copied).toHaveLength(1);
    const text = copied[0]!;
    expect(text.startsWith("; Chartdown map")).toBe(true); // the breadcrumb leads
    expect(text).toContain("llms-full.txt"); // …and points at the language reference
    expect(text).toContain('building shed "Shed" : B2..D4');
    expect(parse(text).diagnostics.filter((d) => d.severity === "error")).toEqual([]); // breadcrumb is comment lines — still a valid document
    expect(notices[0]).toContain("clipboard");
  });

  it("pastes a valid map from the clipboard into the source — LLM fence wrappers and our breadcrumb stripped (#88)", async () => {
    const reply = "Here you go!\n\n```chartdown\n; Chartdown map (plain-text TTRPG map language)\n; language reference: https://nossimonov.github.io/Chartdown/llms-full.txt\n" + SOURCE + "\n```\n";
    const el = document.createElement("div");
    const { io, replaced, notices } = makeIO(false, reply);
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", folderLabel: "", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Paste Chartdown")!.click();
    await flush();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.startsWith("# Test Map")).toBe(true); // fence and breadcrumb gone
    expect(replaced[0]).toContain('ogre "Gruk" : E5 hidden');
    expect(notices[0]).toContain("replaced");
  });

  it("refuses to paste an invalid document — the note is never left broken", async () => {
    const el = document.createElement("div");
    const { io, replaced, notices } = makeIO(false, "map: dungeon\n");
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", folderLabel: "", io });
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Paste Chartdown")!.click();
    await flush();
    expect(replaced).toHaveLength(0);
    expect(notices[0]).toContain("nothing changed");
    expect(notices[0]).toMatch(/line \d+/); // the diagnostic names the line
  });

  it("grays Paste Chartdown while the clipboard is empty — format metadata only, and copying re-enables it", async () => {
    const el = document.createElement("div");
    const { io } = makeIO(false, ""); // empty clipboard, nothing copied yet
    mountChartdownBlock(SOURCE, el, { initialMode: "player", baseName: "test-map", folderLabel: "", io });
    await flush();
    const paste = [...el.querySelectorAll("button")].find((b) => b.textContent === "Paste Chartdown")!;
    expect(paste.disabled).toBe(true);
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Copy Chartdown")!.click();
    await flush();
    expect(paste.disabled).toBe(false); // our own copy is a known clipboard change
  });

  it("chartdownFromClipboard handles bare source, CRLF, and empty clipboards", () => {
    expect(chartdownFromClipboard(SOURCE)).toBe(SOURCE);
    expect(chartdownFromClipboard("map: battlemap\r\ngrid: square 4x4\r\n")).toBe("map: battlemap\ngrid: square 4x4");
    expect(chartdownFromClipboard("")).toBe("");
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
