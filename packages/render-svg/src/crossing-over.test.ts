/**
 * A crossing declares which band is over, and the placement makes it a
 * crossing (#398, ADR 0053).
 *
 * `ford` and `bridge` were invented to carry a rendering hint — which band is
 * drawn on top where a road meets water — and ended up carrying three other
 * jobs: the gate on whether `on <water> on <road>` resolves at all, the test
 * the §6 warning applies, and actual meaning. So a causeway, a culvert, a line
 * of stepping stones had to claim to be a bridge to get a hint orthogonal to
 * what they are, and were otherwise told their placement named no cell.
 *
 * The word now carries only meaning. `over=path|water` carries the hint, and
 * the placement shape carries crossing-hood — spec 05 §4 already draws that
 * line for coastal morphology ("`morph=` says what the geometry does; the word
 * says what the thing is") and spec 06 §3 draws it for barriers.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# Probe", "map: battlemap", "chartdown: 0.1", "grid: square 20x15", "scale: 5ft"];
const BANDS = [
  'river redford "The Redford" : path A9 F9 K9 P10 T10 width=2',
  'road tollroad "Old Toll Road" : path K1 K15',
];
const doc = (vocab: string, line: string): string =>
  [...HEAD, "", ...(vocab ? ["[vocab]", vocab, ""] : []), "[terrain]", ...BANDS, line].join("\n");

const render = (vocab: string, line: string) => renderSource(doc(vocab, line), { mode: "gm" });
const errors = (vocab: string, line: string): string[] =>
  render(vocab, line).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const warnings = (vocab: string, line: string): string[] =>
  render(vocab, line).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

const CAUSEWAY = 'causeway c1 "The Causeway" : on redford on tollroad';

describe("the reported case", () => {
  it("a causeway is placed, not refused", () => {
    // Was two errors — "'on redford' names no cell on a battlemap" — plus the
    // implied-crossing warning, all three cleared only by `causeway : bridge`.
    expect(errors("causeway : feature", CAUSEWAY)).toEqual([]);
    expect(warnings("causeway : feature", CAUSEWAY)).toEqual([]);
  });

  it("and so is an UNKNOWN word — spec 04 §3 permits it", () => {
    expect(errors("", CAUSEWAY)).toEqual([]);
    expect(warnings("", CAUSEWAY)).toEqual([]);
  });
});

describe("`over=` decides which band is on top", () => {
  // A causeway carries no theme entry, so it falls back to the built-in fills:
  // the brown deck when the path is over, the shallow tone when water is.
  const DECK = "#a8763e";
  const WATER = "#c2d4dc";

  it("the default is over=path, silently", () => {
    const svg = render("causeway : feature", CAUSEWAY).svg;
    expect(svg).toContain(DECK);
    expect(svg).not.toContain(WATER);
    expect(warnings("causeway : feature", CAUSEWAY)).toEqual([]); // silent, not warned
  });

  it("a vocabulary facet flips it", () => {
    const svg = render("causeway : feature over=water", CAUSEWAY).svg;
    expect(svg).toContain(WATER);
    expect(svg).not.toContain(DECK);
  });

  it("and an entity pair beats the vocabulary", () => {
    const svg = render("causeway : feature over=path", `${CAUSEWAY} over=water`).svg;
    expect(svg).toContain(WATER);
    expect(svg).not.toContain(DECK);
  });

  it("it is inherited, so a derived word needs no restatement", () => {
    // ADR 0016. `culvert : ford` is water-over-path without saying so.
    //
    // Compared on the crossing band itself rather than the whole sheet: the
    // two documents differ in entity name and in the clip id, which carries a
    // line number, so byte identity would fail for reasons that are not the
    // claim.
    const band = (svg: string): string | undefined =>
      svg.match(/<g id="cd-probe-c1">.*?(<polyline[^>]*>)/s)?.[1]?.replace(/xing-\d+/, "xing-N");
    const derived = band(render("culvert : ford", 'culvert c1 "C" : on redford on tollroad').svg);
    expect(derived).toBeDefined();
    expect(derived).toBe(band(render("", 'ford c1 "C" : on redford on tollroad').svg));
    // and it is the ford treatment, not the bridge one
    expect(derived).not.toContain("#a8763e");
  });

  it("a value outside the closed set warns and the default applies", () => {
    const msg = warnings("causeway : feature", `${CAUSEWAY} over=sideways`).join("\n");
    expect(msg).toContain("over=sideways");
    expect(render("causeway : feature", `${CAUSEWAY} over=sideways`).svg).toContain(DECK);
  });
});

describe("what makes something a crossing", () => {
  it("carrying `over=` does, however it is placed", () => {
    // `ford : E5` has no `on` references at all. Spec 06 §6 keeps explicit
    // cells legal, and this is what stops the shape being the whole test —
    // it regressed exactly here while the change was being written.
    const explicit = [...HEAD, "", "[terrain]", ...BANDS, "ford : K9 difficult"].join("\n");
    expect(renderSource(explicit, { mode: "gm" }).diagnostics
      .filter((d) => d.message.includes("with no crossing"))).toEqual([]);
  });

  it("and so does the two-`on` placement shape", () => {
    expect(warnings("causeway : feature", CAUSEWAY)).toEqual([]);
  });

  it("a single `on` reference is not a crossing", () => {
    // One band is not an intersection; this must still be refused rather than
    // silently treated as a crossing of something.
    expect(errors("causeway : feature", 'causeway c1 : on redford')).not.toEqual([]);
  });
});

describe("what must not move", () => {
  it("the stdlib words render exactly as before", () => {
    for (const w of ["ford", "bridge"]) {
      expect(errors("", `${w} x1 "X" : on redford on tollroad`), w).toEqual([]);
      expect(warnings("", `${w} x1 "X" : on redford on tollroad`), w).toEqual([]);
    }
  });

  it("a bridge is path-over-water and a ford is not", () => {
    // The hint itself, which is the whole reason these words exist.
    expect(render("", 'bridge b1 "B" : on redford on tollroad').svg).toContain("#a8763e");
    expect(render("", 'ford f1 "F" : on redford on tollroad').svg).not.toContain("#a8763e");
  });

  it("an uncrossed overlap still warns, and names no vocabulary", () => {
    const bare = [...HEAD, "", "[terrain]", ...BANDS].join("\n");
    const msg = renderSource(bare, { mode: "gm" }).diagnostics.map((d) => d.message).join("\n");
    expect(msg).toContain("with no crossing");
    expect(msg).not.toContain("ford or bridge");
  });
});
