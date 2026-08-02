// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mountChartdownFile } from "./filepane";
import type { BlockIO } from "./block";

const SOURCE = [
  "# Sunless Hollow",
  "map: battlemap",
  "grid: square 8x6",
  "scale: 5ft",
  "[structures]",
  'building shrine "Shrine" : B2..D4',
  "  door : C4.s",
].join("\n");

const io = (): BlockIO => ({
  writeFile: async () => {},
  notify: () => {},
});

const mount = (source = SOURCE) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onChange = vi.fn();
  const pane = mountChartdownFile(host, {
    initialSource: source,
    initialMode: "player",
    baseName: "sunless-hollow",
    folderLabel: "",
    io: io(),
    onChange,
  });
  return { host, pane, onChange };
};

const textarea = (host: HTMLElement): HTMLTextAreaElement =>
  host.querySelector("textarea") as HTMLTextAreaElement;

describe("a .cd file opens to its map", () => {
  it("renders the map, not the source", () => {
    const { host, pane } = mount();
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(pane.editing()).toBe(false);
  });

  it("the toggle swaps to the source and back", () => {
    const { host, pane } = mount();
    pane.toggle();
    expect(pane.editing()).toBe(true);
    expect(textarea(host).value).toBe(SOURCE);
    expect(host.querySelector("svg")).toBeNull();

    pane.toggle();
    expect(pane.editing()).toBe(false);
    expect(host.querySelector("svg")).not.toBeNull();
  });
});

describe("what gets saved is what was typed", () => {
  // The view writes whatever `source()` returns, and a save can land between
  // keystrokes. A pane answering with its last render would write the previous
  // text over the edit being saved — silently, and only for fast typists.
  it("source() follows the editor while editing", () => {
    const { host, pane } = mount();
    pane.toggle();
    const edited = SOURCE.replace("Shrine", "Drowned Shrine");
    textarea(host).value = edited;
    textarea(host).dispatchEvent(new Event("input"));
    expect(pane.source()).toBe(edited);
  });

  it("reports every edit, so the host can request a save", () => {
    const { host, pane, onChange } = mount();
    pane.toggle();
    textarea(host).value = "map: battlemap";
    textarea(host).dispatchEvent(new Event("input"));
    expect(onChange).toHaveBeenCalledWith("map: battlemap");
  });

  it("carries a pending edit across the toggle rather than reverting it", () => {
    const { host, pane } = mount();
    pane.toggle();
    const edited = SOURCE.replace("square 8x6", "square 10x8");
    textarea(host).value = edited;
    // No input event: the text sits in the textarea unreported, which is the
    // state a toggle can catch it in.
    pane.toggle();
    expect(pane.source()).toBe(edited);
    pane.toggle();
    expect(textarea(host).value).toBe(edited);
  });

  it("re-renders from the edited source, not the source it opened with", () => {
    const { host, pane } = mount();
    pane.toggle();
    textarea(host).value = SOURCE.replace("square 8x6", "square 20x20");
    textarea(host).dispatchEvent(new Event("input"));
    pane.toggle();
    const svg = host.querySelector("svg")!;
    // The mounted map carries its size as a viewBox — the block strips the
    // width/height and sizes it with CSS. 20 columns at 32px plus margins.
    const width = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    expect(width).toBeGreaterThan(600);
  });
});

describe("a file that does not parse still says so", () => {
  it("shows diagnostics rather than an empty view", () => {
    const { host } = mount("map: battlemap\ngrid: square 6x6\n[structures]\nbuilding : \n");
    expect(host.textContent).not.toBe("");
  });
});

describe("the source is replaceable from outside", () => {
  it("setSource redraws from the new text", () => {
    const { host, pane } = mount();
    pane.setSource("map: battlemap\ngrid: square 4x4\nscale: 5ft\n");
    expect(pane.source()).toContain("square 4x4");
    expect(host.querySelector("svg")).not.toBeNull();
  });
});
