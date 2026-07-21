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
    "river r1 : path A5 J5 width=1",
    "road r2 : path E1 E10",
  ];

  it("a road×river overlap with no crossing warns about the implied bridge", () => {
    const { diagnostics } = renderSource(base.join("\n"));
    expect(diagnostics.map((d) => d.message).join()).toMatch(/crosses 'river' at E5 with no ford or bridge/);
  });

  it("a derived ford (on X on Y) claims the crossing and draws the water band", () => {
    const src = [...base, "ford : on r1 on r2 difficult"].join("\n");
    const { svg, diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => /no ford or bridge/.test(d.message))).toEqual([]);
    expect(svg.indexOf("#c3a878")).toBeLessThan(svg.indexOf("#c2d4dc")); // road stroke before ford band
    expect(svg).toContain("clip-path");
  });

  it("explicit cells remain a legal fallback", () => {
    const src = [...base, "ford : E5 difficult"].join("\n");
    const { diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => /no ford or bridge/.test(d.message))).toEqual([]);
  });

  it("a bridge also satisfies the crossing rule", () => {
    const src = [...base, "bridge : on r1 on r2"].join("\n");
    const { diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => /no ford or bridge/.test(d.message))).toEqual([]);
  });

  it("two crossings without a disambiguator is a loud error; at <cell> resolves it", () => {
    const zigzag = [
      "map: battlemap",
      "grid: square 10x10",
      "scale: 5ft",
      "[terrain]",
      "river r1 : path A5 J5 width=1",
      "road r2 : path C1 C9 G9 G1",
      "ford : on r1 on r2 difficult",
    ].join("\n");
    const ambiguous = renderSource(zigzag);
    expect(ambiguous.diagnostics.map((d) => d.message).join()).toMatch(/ambiguous.*add 'at <cell>'/);
    const resolved = renderSource(zigzag.replace("ford : on r1 on r2", "ford : on r1 on r2 at C5"));
    expect(resolved.diagnostics.filter((d) => /ambiguous/.test(d.message))).toEqual([]);
  });

  it("the corpus renders diagnostic-free (Redford's derived ford claims its crossing)", () => {
    const { diagnostics } = renderSource(example("redford-crossing"), { mode: "gm" });
    expect(diagnostics).toEqual([]);
  });
});

describe("themes (spec 08)", () => {
  const candyworld = readFileSync(join(examplesDir, "gumdrop-vale", "candyworld.theme.cd"), "utf8");

  it("the lollipop test: candyworld restyles Gumdrop Vale without touching its source", () => {
    const src = example("gumdrop-vale");
    const themed = renderSource(src, { theme: candyworld });
    const plain = renderSource(src);
    expect(themed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(themed.svg).not.toBe(plain.svg);
    expect(themed.svg).toContain('fill="#fdf1f5"'); // candy paper
    expect(themed.svg).toContain("a5,5 0 1,1"); // scattered lollipops over the licorice forest
    expect(themed.svg).toContain('fill="#f2d4e0"'); // gumdrop-hills edge zone
  });

  it("zone edging renders an under-stroke on the river band", () => {
    const { svg } = renderSource(example("gumdrop-vale"), { theme: candyworld });
    expect(svg.indexOf("#c9628f")).toBeLessThan(svg.indexOf("#e88ab0")); // edge beneath core
  });

  it("theme lookups walk derivation chains", () => {
    // licorice-forest : forest — themed forest fill applies to the derived word.
    const { svg } = renderSource(example("gumdrop-vale"), { theme: candyworld });
    expect(svg).toContain('fill="#a8d894"');
  });

  it("themes are deterministic: same theme, same output", () => {
    const src = example("gumdrop-vale");
    expect(renderSource(src, { theme: candyworld }).svg).toBe(renderSource(src, { theme: candyworld }).svg);
  });

  it("unknown theme properties warn (closed appearance vocabulary)", () => {
    const bad = "[theme]\nforest : font=Papyrus\n";
    const { diagnostics } = renderSource(example("gumdrop-vale"), { theme: bad });
    expect(diagnostics.map((d) => d.message).join()).toMatch(/unknown theme property 'font'/);
  });
});

describe("fallback-chain terminal labels (spec 04 §4)", () => {
  it("vocab-defined words with no themed glyph carry their word as label", () => {
    const { svg } = renderSource(example("gumdrop-vale"));
    expect(svg).toContain(">sugar-silo</text>");
    expect(svg).toContain(">hovercart</text>");
    expect(svg).toContain(">zorbleflax</text>");
  });

  it("tiered settlement glyphs speak for themselves — named only", () => {
    const src = "map: region\nextent: 100x100mi\n[settlements]\nvillage : (50,50)\n";
    const { svg } = renderSource(src);
    expect(svg).not.toContain(">village</text>");
  });

  it("labels: none silences derived labels map-wide (spec 07 §3)", () => {
    const src = example("fairwater-manor").replace("numbers: on", "numbers: on\nlabels: none");
    const { svg } = renderSource(src);
    expect(svg).not.toContain(">The Great Hall</text>");
    expect(svg).not.toContain(">Lord Fairwater</text>");
  });

  it("nolabel silences one entity (the manor's courtyard uses it)", () => {
    const { svg } = renderSource(example("fairwater-manor"));
    expect(svg).not.toContain(">The Courtyard</text>");
    expect(svg).toContain(">The Great Hall</text>");
  });

  it("battlemap label conduct (spec 06 §7): fallback words are tooltips, not text", () => {
    const src = "map: battlemap\ngrid: square 8x8\nscale: 5ft\n[features]\ncrates : B2\n";
    const { svg } = renderSource(src);
    expect(svg).not.toContain(">crates</text>");
    expect(svg).toContain("<title>crates</title>");
  });
});

describe("windows pass light (spec 06 §2 facets)", () => {
  it("a window opens a gap in the visibility polygon", () => {
    const walled = [
      "map: battlemap",
      "grid: square 10x10",
      "scale: 5ft",
      "[structures]",
      "building shed : D4..F6",
      "[features]",
      "campfire : E5 light=20ft",
    ].join("\n");
    const windowed = walled.replace("building shed : D4..F6", "building shed : D4..F6\n  window : D5.w");
    const a = renderSource(walled).svg;
    const b = renderSource(windowed).svg;
    expect(a).not.toBe(b); // the light escapes westward through the window
  });

  it("openings paint above all walls — a door on a shared wall survives the sibling's stroke", () => {
    const src = [
      "map: battlemap",
      "grid: square 10x10",
      "scale: 5ft",
      "[structures]",
      "building hall : D2..H5",
      "  door : F5.s",
      "building kitchen : D6..H8",   // north wall coincides with the hall's south
    ].join("\n");
    const { svg } = renderSource(src);
    const doorAt = svg.indexOf("#a8763e");
    const lastWallGroup = svg.lastIndexOf('stroke="#3d3629" stroke-width="3"');
    expect(doorAt).toBeGreaterThan(lastWallGroup); // door renders after every wall
  });

  it("coincident walls are one wall — a window opens the shared edge (spec 06 §3)", () => {
    const shared = [
      "map: battlemap",
      "grid: square 10x10",
      "scale: 5ft",
      "[structures]",
      "building yard : D2..H8",
      "building room : D2..F5",       // shares the yard's west wall
      "  window : D4.w",
      "[features]",
      "campfire : E4 light=20ft",
    ].join("\n");
    const sealed = shared.replace("\n  window : D4.w", "");
    expect(renderSource(shared).svg).not.toBe(renderSource(sealed).svg); // light escapes past BOTH walls
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
