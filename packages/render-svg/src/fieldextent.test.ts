/**
 * Where a field's drawing stops (ADR 0042, #284/#288).
 *
 * Spec 04 §5 fixed each thing's shape and said nothing about where the paper
 * ends, so the wash, the emitter pool, the pool's cut-out and the level panel
 * each acquired a different boundary — four issues out of one silence.
 *
 * Asserted as COORDINATES rather than as "looks contained", which is what #288
 * asked for: a `3x3` battlemap is a 144×144 page whose map field is exactly
 * (24,24)–(120,120), since MARGIN is 24 and CELL is 32. Every number below is
 * derived from those two constants, so a change to either fails here loudly
 * instead of quietly moving the bound.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";
import { CELL, MARGIN } from "./grid";

const FIELD = { x: MARGIN, y: MARGIN, w: 3 * CELL, h: 3 * CELL };
const PAGE = { w: MARGIN * 2 + 3 * CELL, h: MARGIN * 2 + 3 * CELL };

const doc = (...lines: string[]): string =>
  ["map: battlemap", "grid: square 3x3", "scale: 5ft", ...lines].join("\n");

const rect = (svg: string, fill: string): { x: number; y: number; w: number; h: number } | null => {
  const m = new RegExp(`<rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)" fill="${fill}"`).exec(svg);
  return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : null;
};

describe("the ambient wash stops at the map field", () => {
  it("covers the field exactly, not the page", () => {
    const { svg } = renderSource(doc("light : dark"));
    expect(rect(svg, "#10131a")).toEqual(FIELD);
  });

  it("leaves the page furniture on paper", () => {
    // The failure this replaces: the title drew at 1.06:1 against the wash and
    // the coordinate letters were painted over entirely, because they are
    // emitted into layers.grid and draw BELOW it. Both are page apparatus and
    // belong to the sheet, not to the place.
    const { svg } = renderSource(["# The Hidden Lab", ...doc("numbers: on", "light : dark").split("\n")].join("\n"));
    const wash = rect(svg, "#10131a")!;
    const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), s: m[3]! }));
    const furniture = texts.filter((t) => t.s === "The Hidden Lab" || /^[A-C1-3]$/.test(t.s));
    expect(furniture.length).toBeGreaterThan(6); // the title and six coordinates
    for (const t of furniture) {
      const inside = t.x >= wash.x && t.x <= wash.x + wash.w && t.y >= wash.y && t.y <= wash.y + wash.h;
      expect(inside, `${t.s} at (${t.x},${t.y}) sits inside the wash`).toBe(false);
    }
  });
});

describe("an emitter's pool stops at the map field", () => {
  const oversized = doc("light : dark", "", "[features]", "torch t1 : B2 light=120ft");

  it("is clipped, however far its declared range reaches", () => {
    const { svg } = renderSource(oversized);
    const pool = /<circle[^>]*fill="#ffd98a"[^>]*>/.exec(svg)?.[0] ?? "";
    expect(pool).toContain("clip-path=");
    // The radius itself is untouched: 120ft / 5ft * 32 = 768. Bounding the
    // DRAWING costs no fact, which is the half of ADR 0042 that matters for
    // export — UVTT still emits the true range.
    expect(pool).toContain('r="768"');
  });

  it("clips to the field rect and nothing wider", () => {
    const { svg } = renderSource(oversized);
    const body = /<clipPath id="[^"]*">(.*?)<\/clipPath>/s.exec(svg)?.[1] ?? "";
    const m = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(body);
    expect(m, "no clip rect emitted").not.toBeNull();
    expect({ x: Number(m![1]), y: Number(m![2]), w: Number(m![3]), h: Number(m![4]) }).toEqual(FIELD);
  });

  it("is unreferenced — and so unemitted — on a map that draws no field", () => {
    // Guards the corpus: a battlemap with no ambient and no emitter must be
    // byte-identical to before this decision, or every committed example moves.
    const { svg } = renderSource(doc("", "[features]", "statue s1 : B2"));
    expect(svg).not.toContain("clipPath");
    expect(svg.length).toBeGreaterThan(0);
  });
});

describe("each level panel clips to its own field (#291)", () => {
  const twoLevels = [
    "map: battlemap", "grid: square 3x3", "scale: 5ft",
    "levels: ground cellar", "light : dark", "",
    "[features]", "lamp l1 : B2 level=cellar light=30ft",
  ].join("\n");

  it("names the clip per level, so one panel's light cannot use another's bound", () => {
    const { svg } = renderSource(twoLevels);
    const ids = [...svg.matchAll(/<clipPath id="([^"]*)"/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(1);           // only the panel that draws a pool
    expect(ids[0]).toContain("cellar");
  });

  it("the pool references its own panel's clip", () => {
    const { svg } = renderSource(twoLevels);
    const pool = /<circle[^>]*fill="#ffd98a"[^>]*>/.exec(svg)?.[0] ?? "";
    expect(pool).toContain("cellar");
  });

  it("the page is taller than one panel, so the bound is doing real work", () => {
    // Without a per-panel clip the cellar lamp's r=192 pool spans page y=42..426
    // over a 144-tall ground panel — the lamp lit the floor above.
    const { svg } = renderSource(twoLevels);
    const h = Number(/height="([\d.]+)"/.exec(svg)![1]);
    expect(h).toBeGreaterThan(PAGE.h);
  });
});
