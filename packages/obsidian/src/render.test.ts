// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderChartdownBlock } from "./render";

const SOURCE = [
  "map: battlemap",
  "grid: square 6x6",
  "[tokens]",
  'ogre "Gruk" : C3 size=2 hidden',
  "hero : B2",
].join("\n");

describe("obsidian block rendering", () => {
  it("renders an SVG that scales to the note (no fixed width/height)", () => {
    const el = document.createElement("div");
    renderChartdownBlock(SOURCE, el, "player");
    const svg = el.querySelector("svg.chartdown-map");
    expect(svg).toBeTruthy();
    expect(svg!.hasAttribute("viewBox")).toBe(true);
    expect(svg!.hasAttribute("width")).toBe(false);
    expect(svg!.hasAttribute("height")).toBe(false);
  });

  it("player mode strips secrets; gm mode shows them (fail-closed default)", () => {
    const player = document.createElement("div");
    renderChartdownBlock(SOURCE, player, "player");
    expect(player.innerHTML).not.toContain("Gruk");
    const gm = document.createElement("div");
    renderChartdownBlock(SOURCE, gm, "gm");
    expect(gm.innerHTML).toContain("Gruk");
  });

  it("errors surface beneath the map instead of vanishing", () => {
    const el = document.createElement("div");
    renderChartdownBlock("map: battlemap\ngrid: square 4x4\n[features]\ntable : on ghost at B2", el, "player");
    const box = el.querySelector(".chartdown-diagnostics");
    expect(box).toBeTruthy();
    expect(box!.textContent).toContain("line");
  });
});
