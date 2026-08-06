/**
 * Does coming closer show more? (#274, ADR 0040)
 *
 * #186 gave a reader zoom and both its modules asserted the property that
 * justifies it — "narrowing the viewBox grows the geometry and leaves the
 * strokes". That was true of ADR 0035's channel symbol and false of every
 * other stroke on the sheet, because canvas units scale with the viewBox too.
 * Measured on the failing case, the coastline over a narrow channel drew 2px at
 * x4 and 32px at x64, so the ratio of ink to water never moved and the passage
 * was buried at every zoom.
 *
 * The assertion is therefore the RATIO, in device pixels, across zoom — not
 * that an attribute is present. An attribute check passes on a map where the
 * reader still cannot see anything.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";
import { MAX_ZOOM } from "./viewbox";

/** A channel below ADR 0035's floor, on a document `check` reports clean. */
const PROBE = [
  "map: region",
  "extent: 1400x1000mi",
  "",
  "[water]",
  "coastline shore : from (1210,0) via (1218,500) to (1210,1000)",
  'sea "The Narrows" : west of shore',
  'island isle "Gull Rock" : near shore at (1165,500) size=120mi reach=0.85',
].join("\n");

interface Marked { width: number; declared: number }

/** Every `cd-ink` stroke, with the width it draws at and the width it published. */
const inkStrokes = (svg: string): Marked[] =>
  [...svg.matchAll(/<[^>]*class="cd-ink"[^>]*>/g)].map((m) => ({
    width: Number(/stroke-width="([\d.]+)"/.exec(m[0])?.[1] ?? NaN),
    declared: Number(/--cd-w:([\d.]+)/.exec(m[0])?.[1] ?? NaN),
  }));

const points = (fragment: string): { x: number; y: number }[] =>
  [...fragment.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

/** The drawn shape carried by the group whose id ends in `suffix`. */
const shape = (svg: string, suffix: string): { x: number; y: number }[] => {
  const at = svg.indexOf(`-${suffix}"`);
  expect(at, `no group id ending in -${suffix}`).toBeGreaterThan(-1);
  const from = svg.lastIndexOf("<g", at);
  const geom = /<(?:polyline|polygon)[^>]*(?:points)="([^"]*)"/.exec(svg.slice(from, from + 40000));
  return points(geom?.[1] ?? "");
};

const narrowestGap = (a: { x: number; y: number }[], b: { x: number; y: number }[]): number => {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  return best;
};

describe("ink is marked, and marked honestly", () => {
  const { svg } = renderSource(PROBE);

  it("publishes the same width it draws — the stylesheet does arithmetic with it", () => {
    const marked = inkStrokes(svg);
    expect(marked.length).toBeGreaterThan(0);
    for (const { width, declared } of marked) {
      expect(Number.isFinite(width)).toBe(true);
      // A --cd-w that disagreed with stroke-width would change the map's
      // weight the instant a reader zoomed, which is the bug one level down.
      expect(declared).toBeCloseTo(width, 6);
    }
  });

  it("leaves the static drawing exactly as it was", () => {
    // ADR 0040 is a viewer behaviour. The marking rides along; it must not be
    // a rendering change, or every committed example moves.
    expect(svg).not.toContain("vector-effect=\"non-scaling-stroke\" class=\"cd-ink\"");
    for (const { width } of inkStrokes(svg)) expect(width).toBeGreaterThan(0);
  });
});

describe("the reader sees more by coming closer", () => {
  const { svg, diagnostics } = renderSource(PROBE);

  it("the probe is a legal map, not a welded island", () => {
    // The fixture this whole issue was first tested on was NOT, and the symbol
    // being measured was standing in a place the renderer had already warned
    // about. A probe that fails this proves nothing about zoom.
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.map((d) => d.message).join(" ")).not.toMatch(/no longer an island/);
  });

  it("the channel is genuinely buried at fit", () => {
    const gap = narrowestGap(shape(svg, "isle"), shape(svg, "shore"));
    const coast = Math.max(...inkStrokes(svg).map((s) => s.width));
    // Two facing strokes, each laying half its width into the water.
    expect(gap - coast).toBeLessThan(1);
  });

  it("water outgrows the ink as the view narrows — the property #274 found missing", () => {
    const gap = narrowestGap(shape(svg, "isle"), shape(svg, "shore"));
    const coast = Math.max(...inkStrokes(svg).map((s) => s.width));
    const COLUMN = 700; // a note's width in CSS px
    const home = Number(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg)?.[1]);
    const fit = COLUMN / home; // px per canvas unit when fitted

    const water = (k: number, pinned: boolean): number =>
      gap * fit * k - coast * fit * (pinned ? 1 : k);

    // As shipped: ink and water scale together, so the ratio is a constant and
    // no amount of zoom reveals anything. This is the regression under test.
    const loose = [2, 8, 32].map((k) => water(k, false) / (coast * fit * k));
    for (const r of loose) expect(r).toBeCloseTo(loose[0]!, 6);

    // Pinned: the water grows and the ink does not, so the passage opens.
    const tight = [2, 8, 32].map((k) => water(k, true) / (coast * fit));
    expect(tight[1]!).toBeGreaterThan(tight[0]! * 2);
    expect(tight[2]!).toBeGreaterThan(tight[1]! * 2);

    // And it opens somewhere a reader can actually reach.
    const legible = [...Array(MAX_ZOOM).keys()].map((i) => i + 1).find((k) => water(k, true) >= 4);
    expect(legible).toBeDefined();
    expect(legible!).toBeLessThanOrEqual(MAX_ZOOM);
  });
});
