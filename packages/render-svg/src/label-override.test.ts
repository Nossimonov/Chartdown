/**
 * `[labels]` on the grid renderers (#252).
 *
 * An override was parsed, resolved against its entity, and validated
 * fail-loud — a typo'd subject is a hard error — and then thrown away by the
 * battlemap and hexcrawl renderers. Every signal the author got said the line
 * had taken effect. That inverts spec 07 §5's one absolute: "author-placed
 * `[labels]` overrides are never omitted."
 *
 * `labelOverrides` was read twice in region.ts and zero times in the other
 * two. A hexcrawl went further and implemented no part of `[labels]` at all,
 * so it could not carry a caption either, though spec 07 §2 calls the section
 * universal.
 *
 * Positions, not presence: the failure mode is a label that renders perfectly
 * at the wrong place.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const posOf = (svg: string, label: string): { x: number; y: number } | null => {
  const m = new RegExp(`<text[^>]*>${label}<`).exec(svg);
  if (!m) return null;
  const x = /x="([\d.]+)"/.exec(m[0]);
  const y = /y="([\d.]+)"/.exec(m[0]);
  return x && y ? { x: Number(x[1]), y: Number(y[1]) } : null;
};

const battlemap = (override?: string): string =>
  [
    "map: battlemap", "grid: square 20x20", "scale: 5ft", "",
    "[terrain]", "wall wall : path A1 T1", "",
    "[features]", 'altar "The Black Altar" : H10',
    ...(override ? ["", "[labels]", override] : []),
  ].join("\n");

const hexcrawl = (...extra: string[]): string =>
  ["map: hexcrawl", "grid: hex 8x6 pointy odd-row", "scale: 6mi", "", "[hexes]", 'C3 forest ruin "Old Tower"', ...extra].join("\n");

describe("a battlemap honours an author's override", () => {
  const control = posOf(renderSource(battlemap()).svg, "The Black Altar")!;

  it("`at <cell>` moves the label to that cell", () => {
    const at = posOf(renderSource(battlemap('"The Black Altar" : at R2')).svg, "The Black Altar")!;
    expect(at).not.toEqual(control);
    // R2 — column 18, row 2 — in cell-space coordinates.
    expect(at.x).toBeGreaterThan(500);
    expect(at.y).toBeLessThan(120);
  });

  it("a compass word moves it to that side", () => {
    const north = posOf(renderSource(battlemap('"The Black Altar" : north')).svg, "The Black Altar")!;
    expect(north.x).toBe(control.x);
    expect(north.y).toBeLessThan(control.y);
  });

  it("`sprawl` letter-spaces it across the declared range", () => {
    const { svg } = renderSource(battlemap('"The Black Altar" : sprawl R2..T4'));
    expect(svg).toMatch(/letter-spacing="[\d.]+"[^>]*>The Black Altar</);
  });

  it("`along` rides the referenced course", () => {
    const { svg } = renderSource(battlemap('"The Black Altar" : along wall'));
    expect(svg).toMatch(/<textPath[^>]*>(?:<tspan[^>]*>)?The Black Altar/);
  });

  it("the label is not ALSO drawn at its default position", () => {
    // The first attempt appended the override and left the default in place,
    // so the name rendered twice — which looks like it worked.
    const { svg } = renderSource(battlemap('"The Black Altar" : at R2'));
    expect(svg.match(/>The Black Altar</g) ?? []).toHaveLength(1);
  });

  it("a gridless point is reported rather than ignored", () => {
    const { diagnostics } = renderSource(battlemap('"The Black Altar" : at (200,200)'));
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("a hexcrawl implements [labels] at all", () => {
  it("carries free text, which spec 07 §2 calls universal", () => {
    const { svg } = renderSource(hexcrawl("", "[labels]", 'note "Here be dragons" : C3'));
    expect(svg).toContain("Here be dragons");
  });

  it("honours an override on a LEDGER LINE's name", () => {
    // A hexcrawl's names live on hex lines, not entities — searching entities
    // alone found nothing and dropped the override silently.
    const control = posOf(renderSource(hexcrawl()).svg, "Old Tower")!;
    const moved = posOf(renderSource(hexcrawl("", "[labels]", '"Old Tower" : at F5')).svg, "Old Tower")!;
    expect(moved).not.toEqual(control);
    expect(moved.x).toBeGreaterThan(control.x);
  });

  it("draws the name once, not twice", () => {
    const { svg } = renderSource(hexcrawl("", "[labels]", '"Old Tower" : at F5'));
    expect(svg.match(/>Old Tower</g) ?? []).toHaveLength(1);
  });

  it("reports a hint it cannot site, rather than dropping it", () => {
    const { diagnostics } = renderSource(hexcrawl("", "[routes]", 'road r "Road" : B2 C2', "", "[labels]", '"Old Tower" : along r'));
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("region is unchanged", () => {
  it("still honours its overrides", () => {
    const src = (override?: string): string =>
      ["map: region", "extent: 1000x800mi", "", "[features]", 'altar "The Black Altar" : (500,400)',
       ...(override ? ["", "[labels]", override] : [])].join("\n");
    const control = posOf(renderSource(src()).svg, "The Black Altar")!;
    const moved = posOf(renderSource(src('"The Black Altar" : at (200,200)')).svg, "The Black Altar")!;
    expect(moved).not.toEqual(control);
  });
});
