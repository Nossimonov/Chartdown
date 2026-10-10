/**
 * A junction does not overshoot (ADR 0044, #437).
 *
 * ADR 0044 decided it: "A joining end stops at its meeting point and is not
 * extended to the cell face... a course that joins another does not terminate
 * in a cell of its own." `extendToCellEdge`'s own comment names the cost of
 * not applying it — "extending it there sends it through the trunk and out the
 * far side."
 *
 * The rule was reachable only through the `join` keyword, which a cell-placed
 * `path` cannot spell (and `from <cell> join <ref>` is refused, #262). So every
 * street placed by cells ran through the road it met and out the other side —
 * the "small stub roads that go nowhere" a dogfooding pass reported on a city
 * map, alongside the gaps #434 covers. They are the same half-cell
 * quantisation from either side: one cell short misses by ~8.5px, on the cell
 * runs ~8.5px past.
 *
 * ADR 0044 exempts the FIRST point, because in `from <ref> … join <ref>` the
 * `from` end is a declared origin that does terminate in its own cell. A cell
 * path has no declared origin — both ends are cells, and the reported map has a
 * lane meeting a road at both. So both ends are inferred here: a divergence
 * from the ADR's letter, following its reasoning.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const HEAD = ["# J", "map: battlemap", "chartdown: 0.1", "grid: square 20x14", "scale: 50ft"];
const TRUNK = "road trunk : path J2 J12 width=0.55";
/** Column J's centreline is x=328; its band spans 320.5..335.5. */
const CENTRELINE = 328;

const band = (...lines: string[]): string[] => {
  const svg = renderSource([...HEAD, "", "[terrain]", ...lines].join("\n"), { mode: "gm" }).svg;
  const m = /<g id="cd-j-side">\s*<polyline points="([^"]+)"/.exec(svg);
  return (m?.[1] ?? "").trim().split(/\s+/);
};
const tipX = (...lines: string[]): number => Number(band(...lines)[0]!.split(",")[0]);

describe("an end that meets another course stops there", () => {
  it("the reported case: no protrusion past the trunk", () => {
    // Was 344 — 8.5px beyond the trunk's far edge.
    expect(tipX(TRUNK, "road side : path J7 C7 width=0.45")).toBe(CENTRELINE);
  });

  it("and the tip lands inside the trunk's own band, so the junction is flush", () => {
    const tip = tipX(TRUNK, "road side : path J7 C7 width=0.45");
    expect(tip).toBeGreaterThanOrEqual(320.5);
    expect(tip).toBeLessThanOrEqual(335.5);
  });

  it("BOTH ends, which is where this diverges from ADR 0044's letter", () => {
    // A lane crossing the map between two trunks meets one at each end.
    const pts = band(TRUNK, "road trunk2 : path C2 C12 width=0.55", "road side : path J7 C7 width=0.45");
    expect(pts[0]).toBe("328,232");           // J's centreline
    expect(pts[pts.length - 1]).toBe("104,232"); // C's centreline
  });
});

describe("what must still reach the cell face", () => {
  it("a free end in open ground", () => {
    // #145's whole point: a course fills the cell it terminates in.
    const pts = band(TRUNK, "road side : path J7 F7 width=0.45");
    expect(pts[0]).toBe("328,232");  // meets the trunk
    expect(pts[pts.length - 1]).toBe("184,232"); // F's centre is 200 — extended west
  });

  it("an end one cell short still extends, leaving #434's gap to report", () => {
    // This fix removes stubs; it deliberately does not invent a connection the
    // document does not state. The two issues divide the problem there.
    expect(tipX(TRUNK, "road side : path I7 C7 width=0.45")).toBe(312);
  });

  it("a flyover keeps its own geometry", () => {
    // Differing `elevation=` is the Sky Bridge over a street, not a junction.
    expect(tipX(TRUNK, "road side : path J7 C7 width=0.45 elevation=40ft")).toBe(344);
  });

  it("two courses sharing a TERMINUS both fill their cell", () => {
    // Not a T-junction: neither runs through the other. Suppressing here
    // shortened the host rather than the joiner, which `undercellar` caught —
    // its runnel starts in the cell where its seep joins.
    expect(tipX(TRUNK, "road side : path J12 C12 width=0.45")).toBe(344);
  });
});

describe("the explicit spelling still agrees", () => {
  it("`join` behaves as it always did", () => {
    const svg = renderSource([...HEAD, "", "[terrain]", TRUNK, 'town a "A" : C7',
      "road side : from a join trunk width=0.45"].join("\n"), { mode: "gm" }).svg;
    const pts = (/<g id="cd-j-side">\s*<polyline points="([^"]+)"/.exec(svg)?.[1] ?? "").trim().split(/\s+/);
    // Ends on the trunk's centreline, as it did before this change.
    expect(pts[pts.length - 1]!.split(",")[0]).toBe(String(CENTRELINE));
  });
});
