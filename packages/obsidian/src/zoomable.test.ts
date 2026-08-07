// @vitest-environment happy-dom
/**
 * A map you can get closer to, in a note (#186).
 *
 * The plugin drew a map once at the note's column width and offered no way to
 * look closer — inline SVG does not get Obsidian's image zoom, so nothing else
 * was going to. These assert the viewBox, because that is the operation that
 * makes detail emerge: scaling the element magnifies geometry and stroke
 * together and reveals nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { makeZoomable } from "./zoomable";
import { parseViewBox } from "@chartdown/render-svg";

const HOME = "0 0 800 600";

const mount = (viewBox = HOME) => {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><rect width="10" height="10"/></svg>`;
  document.body.appendChild(host);
  const svg = host.querySelector("svg")!;
  // happy-dom gives every element a zero box; the viewer needs a real one to
  // turn a client point into a fraction of the viewport.
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { host, svg, viewer: makeZoomable(host) };
};

const box = (svg: SVGSVGElement) => parseViewBox(svg.getAttribute("viewBox"))!;

describe("zooming moves the viewBox", () => {
  it("narrows it, rather than scaling the element", () => {
    const { svg, viewer } = mount();
    viewer.zoom(2);
    expect(box(svg).w).toBeCloseTo(400, 6);
    // The element itself is untouched: no transform, no width/height.
    expect(svg.getAttribute("transform")).toBeNull();
    expect(svg.style.transform).toBe("");
  });

  it("fits back to the whole map", () => {
    const { svg, viewer } = mount();
    viewer.zoom(4);
    viewer.fit();
    expect(box(svg)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(viewer.factor()).toBeCloseTo(1, 6);
  });

  it("reports how close it is", () => {
    const { viewer } = mount();
    viewer.zoom(2);
    expect(viewer.factor()).toBeCloseTo(2, 6);
  });

  it("marks a zoomed map, so it can say it is draggable", () => {
    const { host, viewer } = mount();
    expect(host.classList.contains("chartdown-zoomed")).toBe(false);
    viewer.zoom(2);
    expect(host.classList.contains("chartdown-zoomed")).toBe(true);
    viewer.fit();
    expect(host.classList.contains("chartdown-zoomed")).toBe(false);
  });
});

describe("the wheel belongs to the note until asked for", () => {
  it("a bare wheel scrolls past the map", () => {
    // A map that swallowed the wheel would trap a reader's scroll on the way
    // down the note.
    const { svg, host } = mount();
    const before = box(svg);
    host.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true }));
    expect(box(svg)).toEqual(before);
  });

  it("ctrl/⌘ + wheel zooms, and takes the event", () => {
    const { svg, host } = mount();
    const event = new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true });
    // happy-dom's WheelEvent drops ctrlKey and the client point from its init
    // dict — they read back undefined — so they are set on the event itself.
    Object.assign(event, { ctrlKey: true, clientX: 200, clientY: 150 });
    host.dispatchEvent(event);
    expect(box(svg).w).toBeLessThan(800);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("the reader's position survives a re-render", () => {
  it("keeps the view when the same map is drawn again", () => {
    // A note re-renders on a mode toggle and on every edit to a `.cd` file.
    // Resetting would throw a reader back to the whole map exactly while they
    // were adjusting the number they zoomed in to check.
    const { host, svg, viewer } = mount();
    viewer.zoom(4);
    const held = box(svg);
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HOME}"></svg>`;
    const next = host.querySelector("svg")!;
    next.getBoundingClientRect = svg.getBoundingClientRect;
    viewer.adopt();
    expect(box(next)).toEqual(held);
  });

  it("refits when the map is a different size", () => {
    const { host, viewer } = mount();
    viewer.zoom(4);
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"></svg>`;
    viewer.adopt();
    expect(box(host.querySelector("svg")!)).toEqual({ x: 0, y: 0, w: 1200, h: 900 });
  });
});

describe("reporting", () => {
  it("tells a caller when the view changes, so a toolbar can follow", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HOME}"></svg>`;
    document.body.appendChild(host);
    host.querySelector("svg")!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const onChange = vi.fn();
    makeZoomable(host, onChange).zoom(2);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(2, 6);
  });

  it("does nothing at all when there is no map", () => {
    const host = document.createElement("div");
    const viewer = makeZoomable(host);
    expect(() => { viewer.zoom(2); viewer.fit(); viewer.adopt(); }).not.toThrow();
    expect(viewer.factor()).toBe(1);
  });
});
