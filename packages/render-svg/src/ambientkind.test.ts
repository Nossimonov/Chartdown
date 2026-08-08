/**
 * An ambient baseline is a battlemap concern (#287, spec 04 §5).
 *
 * `light: dark` on a region or hexcrawl rendered byte-identically to its own
 * absence and said nothing — #206's failure exactly. The answer is not to wash
 * those map kinds: at region and hexcrawl zoom a reader is above the weather,
 * and visibility is a tactical question, which is the same reasoning that keeps
 * `difficult` off a region map.
 *
 * So the reason is written down — and unlike `difficult`, which says nothing at
 * all, this warns. An author who declares an ambient is picturing a dark sheet,
 * and silence lets them keep picturing it.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const REGION = ["map: region", "extent: 400x300mi"];
const HEXCRAWL = ["map: hexcrawl", "grid: hex 6x5 pointy odd-row", "scale: 6mi"];
const BATTLEMAP = ["map: battlemap", "grid: square 4x3", "scale: 5ft"];

const render = (head: string[], ...rest: string[]) => renderSource([...head, ...rest].join("\n"));
const warnings = (r: ReturnType<typeof renderSource>): string =>
  r.diagnostics.filter((d) => d.severity === "warning").map((d) => d.message).join(" | ");

describe("a map kind that cannot draw an ambient says so", () => {
  for (const [kind, head] of [["region", REGION], ["hexcrawl", HEXCRAWL]] as const) {
    it(`${kind} warns rather than rendering as noon in silence`, () => {
      const said = warnings(render(head, "light : dark"));
      expect(said).toMatch(/sets an ambient baseline/);
      expect(said).toContain(`a ${kind} map does not draw`);
    });

    it(`${kind} names the affordance that does work`, () => {
      // A warning that only refuses leaves the author with the picture they
      // wanted and no way to get it.
      expect(warnings(render(head, "light : dark"))).toMatch(/light "The Sunwell" : blob/);
    });

    it(`${kind} still renders — the document is not wrong, only unanswerable here`, () => {
      const r = render(head, "light : dark");
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(r.svg.startsWith("<svg")).toBe(true);
    });
  }

  it("a battlemap is untouched", () => {
    expect(warnings(render(BATTLEMAP, "light : dark"))).not.toMatch(/ambient baseline/);
  });

  it("it is the FIELD that decides, not the word `light`", () => {
    // A setting's own field earns the same treatment — the rule is about
    // ambient baselines, not about one standard-library word.
    // The header comes before any section; the vocab that makes it a field
    // may follow, since the check runs after the whole document is parsed.
    const said = warnings(render(REGION, "silence: heavy", "", "[vocab]", "silence : field"));
    expect(said).toMatch(/'silence: heavy' sets an ambient baseline/);
  });

  it("an ordinary header is not mistaken for one", () => {
    expect(warnings(render(REGION, "detail: reference"))).not.toMatch(/ambient baseline/);
  });
});

describe("the regional override is what a region map uses instead", () => {
  it("draws, where the header does not", () => {
    // The Underdark case: a stretch where the ceiling opens. This is the
    // affordance the warning points at, so it had better work.
    const with_ = render(REGION, "", "[terrain]",
      "forest wood : blob at (200,150) size=120mi",
      'light "The Sunwell" : blob at (100,100) size=60mi daylight');
    const without = render(REGION, "", "[terrain]", "forest wood : blob at (200,150) size=120mi");
    expect(with_.svg).not.toBe(without.svg);
    expect(with_.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
