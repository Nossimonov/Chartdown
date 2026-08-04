/**
 * Spec 02 §7's relational forms, on a battlemap (#239, #238).
 *
 * §7 is normative for every map kind, and the battlemap answered three of its
 * nine forms. The other six rendered **byte-identically to the same document
 * with the line deleted**, with no diagnostic — the failure #207 already ruled
 * on, found twice since one form at a time (#233, #238).
 *
 * So this suite asserts the WHOLE SET rather than a form at a time. The table
 * is the point: every form in the closed grammar appears in it, and each one
 * either resolves or is reported. A form added to §7 without a row here should
 * fail the last test in this file.
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const BASE = [
  "map: battlemap",
  "grid: square 20x15",
  "scale: 5ft",
  "",
  "[structures]",
  'building kitchen "Kitchen" : C3..H8',
  "  door : E8.s",
  "",
  "[terrain]",
  'river host "The Host" : path A12 T12 width=1',
  "pond alpha : B2",
  "pond omega : B14",
];

const render = (line: string, section = "[features]") =>
  renderSource([...BASE, "", section, line].join("\n"));

/** The same document without the line under test — the silence baseline. */
const baseline = (section = "[features]") => renderSource([...BASE, "", section].join("\n")).svg;

const errorsOf = (r: { diagnostics: { severity: string; message: string }[] }): string[] =>
  r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

interface Case {
  form: string;
  line: string;
  section?: string;
  /** "resolves" — it draws; "reports" — it is refused in words. */
  outcome: "resolves" | "reports";
}

// Every relational form spec 02 §7 defines. Each either draws or is reported;
// what none of them may do is render as though it were never written.
const CASES: Case[] = [
  { form: "at <cell>", line: "statue s : at F10", outcome: "resolves" },
  { form: "bare <cell>", line: "statue s : F10", outcome: "resolves" },
  { form: "on <ref> at <local>", line: "table t : on kitchen at B2", outcome: "resolves" },
  { form: "from <ref> to <ref>", line: "stream s : from alpha to omega", section: "[terrain]", outcome: "resolves" },
  { form: "from <ref> join <ref>", line: "stream s : from alpha join host", section: "[terrain]", outcome: "resolves" },
  { form: "<compass> of <ref>", line: "forest f : north of host", section: "[terrain]", outcome: "resolves" },
  { form: "on <ref>", line: "statue s : on kitchen", outcome: "reports" },
  { form: "near <ref>", line: "statue s : near alpha", outcome: "reports" },
  { form: "<measure> <compass> of <ref>", line: "statue s : 20ft north of alpha", outcome: "reports" },
  { form: "<compass> edge of <ref>", line: "statue s : north edge of kitchen", outcome: "reports" },
  { form: "along <ref>", line: "statue s : along host", outcome: "reports" },
];

describe("every relational form either draws or says why not", () => {
  for (const c of CASES) {
    it(`${c.form} — ${c.outcome}`, () => {
      const r = render(c.line, c.section);
      const same = r.svg === baseline(c.section);
      if (c.outcome === "resolves") {
        expect(errorsOf(r)).toEqual([]);
        expect(same).toBe(false);
      } else {
        // Refused in words. The render matching the baseline is CORRECT here —
        // a refused placement draws nothing — so the diagnostic is the claim.
        expect(errorsOf(r).length).toBeGreaterThan(0);
        expect(errorsOf(r).join(" ")).toMatch(/spec 02 §7/);
      }
    });
  }

  it("no form renders byte-identically to its own absence in silence", () => {
    // The property the whole file exists for, asserted over the table at once.
    for (const c of CASES) {
      const r = render(c.line, c.section);
      const vanished = r.svg === baseline(c.section);
      const spoke = r.diagnostics.some((d) => d.severity === "error" || d.severity === "warning");
      expect(vanished && !spoke, `${c.form} vanished without a word`).toBe(false);
    }
  });
});

describe("the resolutions mean what §7 says they mean", () => {
  it("`at <cell>` is the bare cell — §7: 'at optional on grids'", () => {
    const withKeyword = render("statue s : at F10").svg;
    const bare = render("statue s : F10").svg;
    expect(withKeyword).toBe(bare);
  });

  it("a course runs between the cells its anchors name", () => {
    // On its own, so the only polyline in the output is the course itself —
    // the shared fixture also carries a river, and reading "the first
    // polyline" would have measured that instead.
    const { svg } = renderSource([
      "map: battlemap", "grid: square 20x15", "scale: 5ft", "",
      "[terrain]", "pond alpha : B2", "pond omega : B14",
      "stream s : from alpha to omega",
    ].join("\n"));
    const all = [...svg.matchAll(/<polyline points="([^"]*)"/g)].map((m) => m[1]!);
    expect(all).toHaveLength(1);
    const xs = all[0]!.split(" ").map((p) => Number(p.split(",")[0]));
    expect(new Set(xs).size).toBe(1); // one column: it runs straight down B
  });

  it("a course is live: moving an anchor moves the course", () => {
    const near = render("stream s : from alpha to omega", "[terrain]").svg;
    const moved = renderSource(
      [...BASE.map((l) => (l.startsWith("pond omega") ? "pond omega : R14" : l)), "", "[terrain]", "stream s : from alpha to omega"].join("\n"),
    ).svg;
    // The property the `path` workaround cannot offer (#238, spec 02 §8.4).
    expect(moved).not.toBe(near);
  });

  it("`join` meets the trunk at the nearest cell, not its midpoint", () => {
    const { svg, diagnostics } = render("stream s : from alpha join host", "[terrain]");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const points = /<polyline points="([^"]*)"/.exec(svg)?.[1] ?? "";
    expect(points).not.toBe("");
  });
});

describe("what the refusals do not catch", () => {
  it("free text keeps `along`, which is its own closed placement set (spec 07 §2)", () => {
    const { svg, diagnostics } = renderSource(
      [...BASE, "", "[labels]", 'note "along the water" : along host'].join("\n"),
    );
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(svg).toContain("along the water");
  });

  it("a crossing keeps its bare `on` references — that IS the idiom (spec 06 §6)", () => {
    const { diagnostics } = renderSource(
      [...BASE, 'road lane "The Lane" : path J1 J15 width=1', "ford : on host on lane"].join("\n"),
    );
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("`along` accompanying a course is a hint, not a placement — and says it is unapplied", () => {
    // Spec 02 §7's own example shape: `from … to … along coast`. Judged alone
    // the hint names no cell, so a naive rule reports the spec's own spelling.
    const { diagnostics } = render("road r : from alpha to omega along host", "[terrain]");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.some((d) => /not applied on a battlemap/.test(d.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/**
 * The same class, one grid short (#248). A hexcrawl's placement loops branch
 * on address/range with no trailing else, exactly as the battlemap's did, so a
 * realm placed `near duchy` drew nothing and said nothing. Swept here as a set
 * for the same reason: this has now been found on three surfaces, each time by
 * sweeping rather than by anyone reporting the individual form.
 */
const HEX = [
  "map: hexcrawl",
  "grid: hex 8x6 pointy odd-row",
  "scale: 6mi",
  "",
  "[hexes]",
  "C2..C4 forest",
  "E1..E2 hills",
  "",
  "[routes]",
  'river bren "The Bren" : F1 E2 D3 C4',
  "",
  "[regions]",
  'realm duchy "Duchy of Bren" : C2..C4',
];

const hex = (line: string) => renderSource([...HEX, line].join("\n"));
const hexBaseline = (): string => renderSource(HEX.join("\n")).svg;

describe("a hexcrawl answers every relational form too (#248)", () => {
  const REFUSED = [
    ["near", 'realm r "R" : near duchy'],
    ["<compass> of", 'realm r "R" : north of bren'],
    ["<compass> edge of", 'realm r "R" : north edge of duchy'],
    ["<measure> <compass> of", 'realm r "R" : 12mi north of bren'],
    ["along", 'realm r "R" : along bren'],
    ["on", 'realm r "R" : on bren'],
    ["from … to …", 'realm r "R" : from duchy to bren'],
  ] as const;

  for (const [form, line] of REFUSED) {
    it(`${form} — reported, not dropped`, () => {
      const r = hex(line);
      const errors = r.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.map((d) => d.message).join(" ")).toMatch(/spec 02 §7/);
    });
  }

  it("`at <hex>` resolves, and is the bare spelling exactly", () => {
    // §7 makes `at` optional ON GRIDS, and a hexcrawl is one — so the two
    // spellings cannot differ. This needs no per-form decision, which is why
    // it is the one form resolved here.
    expect(hex('realm r "R" : at E1').svg).toBe(hex('realm r "R" : E1').svg);
  });

  it("no form renders byte-identically to its own absence in silence", () => {
    const base = hexBaseline();
    for (const [form, line] of [...REFUSED, ["at", 'realm r "R" : at E1'] as const]) {
      const r = hex(line);
      const vanished = r.svg === base;
      const spoke = r.diagnostics.some((d) => d.severity === "error" || d.severity === "warning");
      expect(vanished && !spoke, `${form} vanished without a word`).toBe(false);
    }
  });

  it("says hex, not cell — and offers spellings this map kind has", () => {
    // A hexcrawl has no structures to place against, so `on <structure> at
    // <cell>` would send an author after a form this document cannot use.
    const msg = hex('realm r "R" : near duchy').diagnostics.find((d) => d.severity === "error")!.message;
    expect(msg).toContain("hex");
    expect(msg).not.toContain("cell");
    expect(msg).not.toContain("<structure>");
  });

  it("names the form as the author wrote it", () => {
    const msg = hex('realm r "R" : north of bren').diagnostics.find((d) => d.severity === "error")!.message;
    expect(msg).toContain("north of bren");
    expect(msg).not.toContain("side-of"); // the internal form name
  });

  it("leaves the corpus alone — every example still parses clean", () => {
    // brenmark is the hexcrawl in examples/; it uses only concrete placements,
    // and a rule that refused those would be worse than the silence.
    const { diagnostics } = renderSource(HEX.join("\n"));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
