import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const examplesDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "examples");
const example = (name: string): string => readFileSync(join(examplesDir, name, `${name}.cd`), "utf8");

describe("determinism (spec 02 §8.2)", () => {
  it("same document + seed → byte-identical SVG", () => {
    const src = example("vessany");
    expect(renderSource(src).svg).toBe(renderSource(src).svg);
  });

  it("a different seed changes organic geometry", () => {
    const src = example("vessany");
    const reseeded = src.replace("map: region", "map: region\nseed: 99");
    expect(renderSource(reseeded).svg).not.toBe(renderSource(src).svg);
  });
});

describe("example corpus renders", () => {
  for (const name of ["redford-crossing", "brenmark", "vessany", "gumdrop-vale"]) {
    it(`${name} renders in both modes without errors`, () => {
      const src = example(name);
      const player = renderSource(src, { mode: "player" });
      const gm = renderSource(src, { mode: "gm" });
      expect(player.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(player.svg.startsWith("<svg")).toBe(true);
      expect(gm.svg.startsWith("<svg")).toBe(true);
    });
  }
});

describe("GM/player split is fail-closed (spec 01 §6)", () => {
  const redford = example("redford-crossing");

  it("player render strips hidden tokens, gm entities, and gm notes", () => {
    const { svg } = renderSource(redford, { mode: "player" });
    expect(svg).not.toContain("Gruk");
    expect(svg).not.toContain(">ambush");
    expect(svg).not.toContain("spring when the wagon");
    expect(svg).not.toContain("Archers hold fire");
    expect(svg).not.toContain("toll ledger");
  });

  it("gm render includes all of it", () => {
    const { svg } = renderSource(redford, { mode: "gm" });
    expect(svg).toContain("Gruk");
    expect(svg).toContain(">ambush");
    expect(svg).toContain("spring when the wagon is mid-ford");
    expect(svg).toContain("Archers hold fire until the trigger.");
  });

  it("hexcrawl gm notes and seen-hex contents stay out of player renders", () => {
    const src = example("brenmark");
    const player = renderSource(src, { mode: "player" }).svg;
    const gm = renderSource(src, { mode: "gm" }).svg;
    expect(player).not.toContain("Haunted");
    expect(player).not.toContain("Spider queen");
    expect(gm).toContain("Haunted; the ghost knows the pass song.");
  });
});

describe("anchors (spec 03 §3)", () => {
  it("identified entities export cd-<doc>-<entity> element ids", () => {
    const { svg } = renderSource(example("vessany"));
    expect(svg).toContain('id="cd-vessany-highkeep"');
    expect(svg).toContain('id="cd-vessany-coast"');
    expect(svg).toContain('id="cd-vessany-merrows-rest"');
  });

  it("hex content names anchor too", () => {
    const { svg } = renderSource(example("brenmark"));
    expect(svg).toContain('id="cd-the-brenmark-saltmere"');
  });
});

describe("furniture and grid (spec 07 §4)", () => {
  it("hex coordinate labels render when numbers: on", () => {
    const { svg } = renderSource(example("brenmark"));
    expect(svg).toContain(">B2</text>");
  });

  it("compass and scale bar render for vessany", () => {
    const { svg } = renderSource(example("vessany"));
    expect(svg).toContain(">N</text>");
    expect(svg).toContain("mi</text>");
  });
});

describe("crossings and layering (spec 06 §6)", () => {
  const base = [
    "map: battlemap",
    "grid: square 10x10",
    "scale: 5ft",
    "[terrain]",
    "river : path A5 J5 width=1",
    "road : path E1 E10",
  ];

  it("a road×river overlap with no crossing warns about the implied bridge", () => {
    const { diagnostics } = renderSource(base.join("\n"));
    expect(diagnostics.map((d) => d.message).join()).toMatch(/crosses 'river' at E5 with no ford or bridge/);
  });

  it("a ford covering the overlap silences the warning and draws above the road", () => {
    const src = [...base, "ford : E5 difficult"].join("\n");
    const { svg, diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => /no ford or bridge/.test(d.message))).toEqual([]);
    expect(svg.indexOf("#c3a878")).toBeLessThan(svg.indexOf("#c2d4dc")); // road stroke before ford cells
  });

  it("a bridge also satisfies the crossing rule", () => {
    const src = [...base, "bridge : E5"].join("\n");
    const { diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => /no ford or bridge/.test(d.message))).toEqual([]);
  });

  it("the corpus renders warning-free (Redford's ford covers its crossing)", () => {
    const { diagnostics } = renderSource(example("redford-crossing"), { mode: "gm" });
    expect(diagnostics).toEqual([]);
  });
});

describe("elevation ledges (spec 06 §5)", () => {
  it("an elevated zone renders as a ledge", () => {
    const src = [
      "map: battlemap",
      "grid: square 10x10",
      "scale: 5ft",
      "[features]",
      'ledge perch "The Old Wall" : zone C2..E3 elevation=15ft',
    ].join("\n");
    const { svg, diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(svg).toContain('class="ledge"');
    expect(svg).toContain("15ft");
  });
});

describe("snapshots", () => {
  for (const name of ["redford-crossing", "brenmark", "vessany", "gumdrop-vale"]) {
    it(`${name} SVG snapshot is stable`, () => {
      expect(renderSource(example(name), { mode: "gm" }).svg).toMatchSnapshot();
    });
  }
});
