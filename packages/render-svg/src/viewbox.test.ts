/**
 * The viewBox arithmetic behind zooming a map (#186).
 *
 * The property under test is the one that makes zooming worth doing at all:
 * narrowing the viewBox grows the geometry while leaving `non-scaling-stroke`
 * widths alone, so detail emerges. Scaling the element instead magnifies both
 * and reveals nothing — which is why these functions move the box.
 */
import { describe, expect, it } from "vitest";
import { clamp, formatViewBox, isFitted, MAX_ZOOM, panBy, parseViewBox, sameMap, zoomAbout, zoomFactor, type Rect } from "./viewbox";

const HOME: Rect = { x: 0, y: 0, w: 800, h: 600 };

describe("reading a viewBox", () => {
  it("takes the forms an SVG actually writes", () => {
    expect(parseViewBox("0 0 800 600")).toEqual(HOME);
    expect(parseViewBox("0,0,800,600")).toEqual(HOME);
    expect(parseViewBox("  0   0  800 600 ")).toEqual(HOME);
  });

  it("refuses what it cannot use", () => {
    for (const bad of [null, "", "0 0 800", "0 0 -1 600", "0 0 800 0", "a b c d"]) {
      expect(parseViewBox(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("round-trips", () => {
    expect(parseViewBox(formatViewBox(HOME))).toEqual(HOME);
  });
});

describe("zooming keeps the point under the cursor", () => {
  it("holds the centre when zooming about the centre", () => {
    const z = zoomAbout(HOME, HOME, 0.5, 0.5, 2);
    expect(z.x + z.w / 2).toBeCloseTo(400, 6);
    expect(z.y + z.h / 2).toBeCloseTo(300, 6);
    expect(z.w).toBeCloseTo(400, 6);
  });

  it("holds a corner when zooming about it", () => {
    // Whatever is under the cursor stays under it — the property that makes
    // wheel-zoom feel like looking closer rather than being moved.
    const z = zoomAbout(HOME, HOME, 0, 0, 4);
    expect(z.x).toBeCloseTo(0, 6);
    expect(z.y).toBeCloseTo(0, 6);
  });

  it("keeps the document's aspect ratio", () => {
    // A stretched view would make a measured map lie about its proportions.
    const z = zoomAbout(HOME, HOME, 0.3, 0.7, 3.5);
    expect(z.w / z.h).toBeCloseTo(HOME.w / HOME.h, 6);
  });

  it("stops at MAX_ZOOM", () => {
    let v = HOME;
    for (let i = 0; i < 20; i++) v = zoomAbout(v, HOME, 0.5, 0.5, 4);
    expect(zoomFactor(v, HOME)).toBeCloseTo(MAX_ZOOM, 3);
  });

  it("never shows more map than there is", () => {
    const v = zoomAbout(zoomAbout(HOME, HOME, 0.5, 0.5, 4), HOME, 0.5, 0.5, 0.01);
    expect(v).toEqual(HOME);
    expect(isFitted(v, HOME)).toBe(true);
  });
});

describe("panning stays on the map", () => {
  it("moves the view with the drag", () => {
    const zoomed = zoomAbout(HOME, HOME, 0.5, 0.5, 4);
    const panned = panBy(zoomed, HOME, -0.25, 0);
    expect(panned.x).toBeGreaterThan(zoomed.x);
  });

  it("cannot wander off the edge", () => {
    const zoomed = zoomAbout(HOME, HOME, 0.5, 0.5, 4);
    const far = panBy(zoomed, HOME, 100, 100);
    expect(far.x).toBeLessThanOrEqual(HOME.x + HOME.w - far.w + 1e-9);
    expect(far.y).toBeLessThanOrEqual(HOME.y + HOME.h - far.h + 1e-9);
    const back = panBy(zoomed, HOME, -100, -100);
    expect(back.x).toBeGreaterThanOrEqual(HOME.x - 1e-9);
    expect(back.y).toBeGreaterThanOrEqual(HOME.y - 1e-9);
  });

  it("a fitted view cannot pan at all — there is nowhere to go", () => {
    expect(panBy(HOME, HOME, 0.5, 0.5)).toEqual(HOME);
  });
});

describe("clamping and identity", () => {
  it("holds a view inside its map", () => {
    expect(clamp({ x: -50, y: -50, w: 200, h: 150 }, HOME)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });

  it("tells one map from another, so a resize refits and an edit does not", () => {
    expect(sameMap(HOME, { ...HOME })).toBe(true);
    expect(sameMap(HOME, { ...HOME, w: 801 })).toBe(false);
    expect(sameMap(null, HOME)).toBe(false);
  });
});
