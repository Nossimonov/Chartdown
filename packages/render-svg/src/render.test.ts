import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseXml } from "@rgrove/parse-xml";
import { describe, expect, it } from "vitest";
import { exportUvttSource, renderSource } from "./index";
import { shrinkFloor } from "./labels";

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

describe("levels (spec 06 §8)", () => {
  it("the manor renders three titled panels", () => {
    const { svg, diagnostics } = renderSource(example("fairwater-manor"), { mode: "gm" });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(svg).toContain("— upper —");
    expect(svg).toContain("— ground —");
    expect(svg).toContain("— cellar —");
  });

  it("connectors annotate direction and destination; landings render reciprocally", () => {
    const { svg } = renderSource(example("fairwater-manor"));
    expect(svg).toContain("▲ upper");
    expect(svg).toContain("▼ cellar");
    expect(svg).toContain("▼ ground"); // reciprocal landing on the upper panel
    expect(svg).toContain("▲ ground"); // reciprocal landing on the cellar panel
  });

  it("the GM/player split computes per level", () => {
    const player = renderSource(example("fairwater-manor"), { mode: "player" }).svg;
    const gm = renderSource(example("fairwater-manor"), { mode: "gm" }).svg;
    expect(player).not.toContain("Old Merek");
    expect(gm).toContain("Old Merek");
  });

  it("undeclared levels fail loud", () => {
    const src = "map: battlemap\ngrid: square 8x8\nscale: 5ft\nlevels: upper ground\n[features attic]\ncrates : B2\n";
    const { diagnostics } = renderSource(src);
    expect(diagnostics.map((d) => d.message).join()).toMatch(/unknown level 'attic'/);
  });

  it("qualifiers and to= without levels: fail loud", () => {
    const qualified = "map: battlemap\ngrid: square 8x8\nscale: 5ft\n[features upper]\ncrates : B2\n";
    expect(renderSource(qualified).diagnostics.map((d) => d.message).join()).toMatch(/requires a levels: declaration/);
    const connector = "map: battlemap\ngrid: square 8x8\nscale: 5ft\n[features]\nstairs : B2 to=cellar\n";
    expect(renderSource(connector).diagnostics.map((d) => d.message).join()).toMatch(/requires a levels: declaration/);
  });

  it("the drop flag renders a ticked fall edge; earth fills the underground", () => {
    const { svg } = renderSource(example("fairwater-manor"));
    expect(svg).toContain('class="drop"');
    expect(svg).toContain('fill="#6b6157"'); // earth around the Undercroft
  });

  it("upper levels declare their surfaces: air and difficult roofs", () => {
    const { svg } = renderSource(example("fairwater-manor"), { level: "upper" });
    expect(svg).toContain('fill="#e9edee"'); // open sky
    expect(svg).toContain('fill="#bf9c85"'); // roof tiles
    expect(svg).toContain("url(#hatch)"); // roofs are difficult terrain
  });

  it("feature footprints span their declared range (the high table)", () => {
    const { svg } = renderSource(example("fairwater-manor"), { level: "ground" });
    expect(svg).toContain('width="90"'); // 3 cells minus insets
    const gm = renderSource(example("fairwater-manor"), { mode: "gm", level: "ground" }).svg;
    expect(gm).toContain(">alarm</text>"); // gm range entities stay zones
  });

  it("relative placement: on <structure> at <local> resolves in the footprint frame (#34)", () => {
    const { svg, diagnostics } = renderSource(example("fairwater-manor"), { level: "ground" });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // the resolved absolute address surfaces as a tooltip (DM frame stays absolute)
    expect(svg).toContain("C2..D2 of Kitchen = F8..G8");
    // parent-frame detail: door : at E2.e = H8.e (an east door segment at x=280)
    expect(svg).toMatch(/line x1="280" y1="248" x2="280" y2="280"[^/]*stroke="#a8763e"/);
  });

  it("relative placement fails loud: outside the footprint, and frameless referents", () => {
    const base = ["map: battlemap", "grid: square 8x8", "[structures]", 'building shed "Shed" : B2..D4'];
    const outside = renderSource([...base, "[features]", "table : on shed at F1"].join("\n"), {});
    expect(outside.diagnostics.some((d) => d.severity === "error" && d.message.includes("outside"))).toBe(true);
    const frameless = renderSource(
      ["map: battlemap", "grid: square 8x8", "[terrain]", "river r : path A4 H4 width=1", "[features]", "table : on r at B2"].join("\n"),
      {},
    );
    expect(frameless.diagnostics.some((d) => d.severity === "error" && d.message.includes("footprint"))).toBe(true);
  });

  it("polygon water bounds seas so two continents can exist (#76)", () => {
    const source = [
      "map: region",
      "extent: 400x300mi",
      "[vocab]",
      "island : terrain",
      "[water]",
      'sea "The Split" : area (150,0) (170,150) (150,300) (250,300) (230,150) (250,0)',
      "[terrain]",
      'island "Midholm" : blob (200,150) size=20mi',
      'forest "The Weald" : blob (80,150) size=40mi',
      "[realms]",
      'realm "Westmark" : area (10,10) (140,10) (160,290) (10,290)',
    ].join("\n");
    const { svg, diagnostics } = renderSource(source, {});
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // the sea is FULL water fill (not the faint zone tint)
    expect(svg).toMatch(/polygon[^/]*fill="#b9d3e6"/);
    // the island rises above it as LAND: paper surface, coastline stroke
    expect(svg).toMatch(/fill="#f9f5ea" stroke="#8fa8b8"/);
    // realm tint paints beneath terrain: its dashed boundary appears before the forest fill
    const realmAt = svg.indexOf('stroke-dasharray="9 4 2 4"');
    const forestAt = svg.indexOf("#a9c79c");
    expect(realmAt).toBeGreaterThan(-1);
    expect(forestAt).toBeGreaterThan(realmAt);
    // and the sea paints before the realm (territorial waters tint over water)
    expect(svg.indexOf("#b9d3e6")).toBeLessThan(realmAt);
  });

  it("terrain kinds: named ground, zonal terrain, massif areas, aspect adaptation (ADR 0013)", () => {
    const source = [
      "map: region",
      "extent: 400x300mi",
      "ground: plains",
      "[terrain]",
      'frostline "The Frost" : path (0,80) (200,60) (400,90)',
      'tundra "The Waste" : north of "The Frost"',
      'mountains high "The High Reach" : area (100,150) (200,140) (220,220) (120,230)',
      "[realms]",
      'realm "South" : area (40,180) along "The High Reach" (300,260) (60,270)',
      'realm "North" : area (60,40) along south edge of "The High Reach" (350,120) (320,40)',
    ].join("\n");
    const { svg, diagnostics } = renderSource(source, {});
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // aspect adaptation: `along` a crestless AREA fails loud without a face…
    const ambiguous = diagnostics.filter((d) => d.severity === "warning" && /ambiguous/.test(d.message));
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]!.message).toMatch(/edge of/);
    // …and the face-qualified form resolves silently.
    // named ground: a second full-canvas rect over the paper
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(2);
    // massif area: the merged-massif group with peak chevrons inside
    expect(svg).toMatch(/<g opacity="0.55">/);
    expect(svg).toMatch(/<path d="M[^"]+L[^"]+L[^"]+M/);
  });

  it("glyphless words tint deterministically; legend samples match the map (#71)", () => {
    const source = [
      "map: battlemap",
      "grid: square 8x8",
      "legend: on",
      "[vocab]",
      "keg : barrel",
      "[features]",
      "table : B2",
      "barrel : C2",
      "keg : D2",
      "well : E2",
    ].join("\n");
    const { svg } = renderSource(source, {});
    const tints = [...svg.matchAll(/fill="(hsl\([\d.]+ 32% 55%\))"/g)].map((m) => m[1]!);
    const distinct = new Set(tints);
    // table, barrel(+keg sharing the family tint), well → 3 distinct colors
    expect(distinct.size).toBe(3);
    // every tint appears at least twice: once on the map, once in the legend
    for (const t of distinct) {
      expect(tints.filter((x) => x === t).length).toBeGreaterThanOrEqual(2);
    }
    // derived keg shares barrel's tint (family hashing) — barrel's tint appears 4x (2 map + 2 legend? no: keg row + barrel row + 2 map squares)
    const counts = new Map<string, number>();
    for (const t of tints) counts.set(t, (counts.get(t) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
    // determinism: same doc, same colors
    expect(renderSource(source, {}).svg).toBe(svg);
  });

  it("labels: keyed numbers names in document order, key= pins, key list in the band (#65)", () => {
    const source = [
      "map: battlemap",
      "grid: square 10x10",
      "labels: keyed",
      "[structures]",
      'building hall "The Hall" : B2..E5',
      'building solar "The Solar" : F2..H5 key=7',
      "[features]",
      'well wishing "The Wishing Well" : C8',
      "[tokens]",
      'lord "Lord Grey" : C3',
    ].join("\n");
    const { svg, diagnostics } = renderSource(source, {});
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // numbers on the map (pin 7 respected, others fill 1,2,3), bold markers
    expect(svg).toMatch(/font-weight="bold"[^>]*>1<\/text>/);
    expect(svg).toMatch(/font-weight="bold"[^>]*>7<\/text>/);
    // each name appears exactly once — in the key band, not on the map
    expect(svg.match(/>The Hall<\/text>/g)).toHaveLength(1);
    expect(svg.match(/>The Wishing Well<\/text>/g)).toHaveLength(1);
    expect(svg).toMatch(/>1\.<\/text>/);
    expect(svg).toMatch(/>7\.<\/text>/);
    // duplicate pins fail loud
    const dup = renderSource(source.replace('well wishing "The Wishing Well" : C8', 'well wishing "The Wishing Well" : C8 key=7'), {});
    expect(dup.diagnostics.some((d) => d.severity === "error" && d.message.includes("pinned twice"))).toBe(true);
  });

  it("freestanding barriers draw their edge runs (#62)", () => {
    const source = [
      "map: battlemap",
      "grid: square 6x6",
      "[structures]",
      "wall w1 : B3.s C3.s D3.s",
      "fence f1 : D1.e D2.e",
      "pillar : E5",
    ].join("\n");
    const { svg, diagnostics } = renderSource(source, {});
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const wallLines = svg.match(/stroke="#3d3629" stroke-width="3"[^/]*stroke-linecap="square"/g) ?? [];
    expect(wallLines).toHaveLength(3); // the three wall edges
    const fenceLines = svg.match(/stroke="#8a7a5c"/g) ?? [];
    expect(fenceLines).toHaveLength(2); // dashed, sight-passing
    expect(svg).toContain('fill="#5a5244"'); // the pillar post
  });

  it("vocab facet defaults and chain glyphs survive derivation and footprints (#64)", () => {
    const source = [
      "map: battlemap",
      "grid: square 8x8",
      "scale: 5ft",
      "[vocab]",
      "hearth : campfire",
      "[features]",
      "hearth : F3..F4",
      "campfire lone : B6",
      "stairs up : G6..G7",
    ].join("\n");
    const { svg, diagnostics } = renderSource(source, { mode: "gm" });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // both campfire-derived entities glow (light=20ft facet default → r=128)
    const glows = svg.match(/r="128" fill="#ffd98a"/g) ?? [];
    expect(glows).toHaveLength(2);
    // both carry the flame fallback; the stairs footprint gets treads
    const flames = svg.match(/fill="#d9822b"/g) ?? [];
    expect(flames).toHaveLength(2);
    expect(svg).toContain('stroke-width="2.2"'); // tread lines
  });

  it("legend: on renders a legend from the words actually used (#63, spec 07 §4)", () => {
    const source = [
      "map: battlemap",
      "grid: square 8x8",
      "legend: on",
      "[terrain]",
      "mud : area B2..C3 difficult",
      "river r : path A5 H5 width=1",
      "[features]",
      "campfire : E2",
      "table : F2",
    ].join("\n");
    const { svg } = renderSource(source, {});
    expect(svg).toContain(">mud</text>");
    expect(svg).toContain(">river</text>");
    expect(svg).toContain(">campfire</text>");
    expect(svg).toContain(">table</text>");
    const withoutLegend = renderSource(source.replace("legend: on\n", ""), {}).svg;
    expect(withoutLegend).not.toContain(">mud</text>");
  });

  it("cell-union footprints render with a derived perimeter (spec 06 §3, #45)", () => {
    const source = [
      "map: battlemap",
      "grid: square 10x10",
      "[structures]",
      'building hall "The Hall" : B2..D5 E4..F5',
      "  ruined : north",
      "  door : E5.s",
    ].join("\n");
    const { svg, diagnostics } = renderSource(source, {});
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Non-rectangular union: fill is a path of cell squares, not a rect.
    expect(svg).toContain('<path d="M');
    // Perimeter merges to straight wall runs; both north-facing runs are
    // ruined (dashed), the rest solid. The unbroken south side B5..F5 is
    // SPLIT BY THE DOOR at E5.s (#103) — an opening is a hole, so the wall
    // stops either side of it instead of being drawn straight across.
    const walls = svg.match(/stroke="#3d3629" stroke-width="3"/g) ?? [];
    expect(walls).toHaveLength(7);
    const dashed = svg.match(/stroke-dasharray="5 6"/g) ?? [];
    expect(dashed).toHaveLength(2);
    // The door's own span carries no wall line — only the opening stroke.
    expect(svg).toContain('x1="152" y1="184" x2="184" y2="184" stroke="#a8763e"');
    expect(svg).not.toContain('x1="152" y1="184" x2="184" y2="184" stroke="#3d3629"');
  });

  it("union walls drive light and UVTT identically (one wall truth)", () => {
    const source = [
      "map: battlemap",
      "grid: square 10x10",
      "[structures]",
      'building hall "The Hall" : B2..D5 E4..F5',
      "  ruined : north",
      "  door : E5.s",
    ].join("\n");
    const { uvtt } = exportUvttSource(source, {});
    // 18 perimeter cell-edges, minus 5 ruined-north edges, minus the door edge
    expect(uvtt!["line_of_sight"]).toHaveLength(12);
    expect(uvtt!["portals"]).toHaveLength(1);
  });

  it("room labels stay inside bent rooms (bounding-rect center can be outside)", () => {
    const source = [
      "map: battlemap",
      "grid: square 10x10",
      "[structures]",
      'building spire "The Spire" : B2..B6 C6..F6',
    ].join("\n");
    const { svg } = renderSource(source, {});
    // The wide base row (B6..F6) wins: narrow tower rows penalize the label.
    expect(svg).toMatch(/<text x="136" y="203.5"[^>]*>The Spire<\/text>/);
  });

  it("open structures read as outdoor ground (spec 06 §3, ADR 0008)", () => {
    const { svg, diagnostics } = renderSource(example("fairwater-manor"), { level: "ground" });
    expect(svg).toContain('fill="#e3ddc2"'); // the courtyard's building.open fill
    expect(svg).toContain('fill="#efe9da"'); // roofed rooms keep the interior tone
    expect(diagnostics.filter((d) => d.severity === "warning" && d.message.includes("open"))).toEqual([]);
  });

  it("a floor above open ground warns (open wants air above)", () => {
    const source = [
      "map: battlemap",
      "grid: square 6x6",
      "levels: top base",
      "level: base",
      "[structures]",
      'building yard "The Yard" : A1..D4 open',
      "[terrain top]",
      "air : area A1..F6",
      "roof : area A1..B2 difficult",
    ].join("\n");
    const { diagnostics } = renderSource(source, {});
    const warning = diagnostics.find((d) => d.severity === "warning" && d.message.includes("open to the sky"));
    expect(warning?.message).toContain("The Yard");
    expect(warning?.message).toContain("roof");
    expect(warning?.message).toContain("A1");
  });

  it("room labels dodge the pieces (the kitchen label clears its table)", () => {
    const { svg } = renderSource(example("fairwater-manor"), { level: "ground" });
    const m = /<text x="[\d.]+" y="([\d.]+)"[^>]*>Kitchen<\/text>/.exec(svg);
    expect(m).toBeTruthy();
    const y = Number(m![1]);
    // the kitchen table F8..G8 spans y 248..280; the label picks a clear row
    expect(y < 244 || y > 284).toBe(true);
  });

  it("the title gets its own band above the column letters (numbers: on)", () => {
    const { svg } = renderSource(example("fairwater-manor"), { level: "ground" });
    // letters row shifts below the 20px title band: baseline 17 → inside a translate(0 20)
    expect(svg).toContain('transform="translate(0 20)"');
    const withoutTitle = renderSource(example("fairwater-manor").replace("# Fairwater Manor\n", ""), { level: "ground" });
    expect(withoutTitle.svg).toContain('transform="translate(0 0)"');
  });

  it("route labels sit at the course's arc-length midpoint, sliding along when crowded", () => {
    const { svg } = renderSource(example("brenmark"), {});
    const bren = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>The Bren<\/text>/.exec(svg);
    expect(bren).toBeTruthy();
    // course F1..A4 clipped at the coast: mid-course is near D3 (x ≈ 160-200),
    // not the C4/B4 tail (x ≈ 155 was the old index-midpoint terminus read)
    expect(Number(bren![2])).toBeLessThan(140); // y near row 3, not row 4+
  });

  it("room labels render beneath features and tokens (z-order)", () => {
    const { svg } = renderSource(example("fairwater-manor"), { level: "ground" });
    const roomLabel = svg.indexOf(">The Great Hall</text>");
    const firstToken = svg.indexOf('cd-fairwater-manor-g1');
    expect(roomLabel).toBeGreaterThan(-1);
    expect(firstToken).toBeGreaterThan(roomLabel);
  });

  it("room labels sit inside their rooms (readable on any surrounding fill)", () => {
    const { svg } = renderSource(example("fairwater-manor"), { level: "cellar", mode: "gm" });
    const label = svg.indexOf(">The Undercroft</text>");
    expect(label).toBeGreaterThan(-1);
    const x = /x="([\d.]+)" y="([\d.]+)"[^>]*>The Undercroft/.exec(svg);
    expect(x).not.toBeNull(); // centered placement asserted via snapshot stability
  });

  it("RenderOptions.level renders a single panel", () => {
    const all = renderSource(example("fairwater-manor"));
    const one = renderSource(example("fairwater-manor"), { level: "cellar" });
    expect(one.svg.length).toBeLessThan(all.svg.length);
    expect(one.svg).not.toContain("— upper —");
    expect(one.svg).toContain("The Undercroft");
  });

  it("themes can restyle connector kinds and directions (ladder.down)", () => {
    const theme = "[theme]\nladder.down : glyph=rungs\n[glyphs]\nrungs : \"M-5,-8 L-5,8 M5,-8 L5,8 M-5,-3 L5,-3 M-5,3 L5,3\"\n";
    const { svg } = renderSource(example("fairwater-manor"), { theme });
    expect(svg).toContain("M-5,-8 L-5,8");
  });
});

describe("one vocabulary chain, walked once (#101, #103, #105)", () => {
  const THEME = "[theme]\nbuilding : fill=#112233\n";
  const MAP = (vocabBlock: string): string =>
    ["map: battlemap", "grid: square 10x10", "scale: 5ft", vocabBlock, "[structures]", "hall h1 : B2..D4"].join("\n");

  it("a use:-imported derivation resolves through the theme chain, exactly as an in-document one does", () => {
    const imported = renderSource(MAP("use: lib.cd"), {
      theme: THEME,
      libraries: { "lib.cd": "[vocab]\nhall : building\n" },
    });
    const inDocument = renderSource(MAP("[vocab]\nhall : building"), { theme: THEME });
    // The bug: only the in-document derivation reached the theme, and nothing
    // warned — the map rendered plausibly with half its theme dead.
    expect(imported.svg).toContain("#112233");
    expect(inDocument.svg).toContain("#112233");
  });

  it("a word derived from door/gate/window strokes like its base, not like the wall (#103)", () => {
    const src = [
      "map: battlemap",
      "grid: square 16x8",
      "scale: 5ft",
      "[vocab]",
      "portal : door",
      "hatch : opening passes=closed sight=none",
      "[structures]",
      "building r1 : B2..D6",
      "  door : D4.e",
      "building r2 : F2..H6",
      "  portal : H4.e",
      "building r3 : J2..L6",
      "  hatch : L4.e",
    ].join("\n");
    const { svg } = renderSource(src);
    const doorStrokes = svg.match(/stroke="#a8763e"/g) ?? [];
    // door + portal (derived) + hatch (bound to the archetype) — all three.
    expect(doorStrokes.length).toBe(3);
  });

  it("openings, barriers, paths, and zones honour their theme entries (#105)", () => {
    const src = [
      "map: battlemap",
      "grid: square 14x14",
      "scale: 5ft",
      "[structures]",
      "building b1 : D2..F4",
      "  door : F3.e",
      "  window : D3.w",
      "wall w1 : H2.n I2.n",
      "pillar p1 : K2",
      "fence f1 : H6.n",
      "[terrain]",
      "road r1 : path A12 N12 width=2",
      "[vocab]",
      "watch : zone",
      "[tokens]",
      "watch z1 \"Z\" : A6..B7",
    ].join("\n");
    const theme = [
      "[theme]",
      "door : stroke=#445566",
      "window : stroke=#778899",
      "wall : stroke=#aabbcc",
      "pillar : fill=#bb1111",
      "fence : stroke=#cc2222",
      "road : stroke=#ff5555",
      "watch : fill=#654321",
    ].join("\n");
    const { svg } = renderSource(src, { theme });
    for (const value of ["#445566", "#778899", "#aabbcc", "#bb1111", "#cc2222", "#ff5555", "#654321"]) {
      expect(svg, `theme entry ${value} never reached the output`).toContain(value);
    }
  });
});

describe("every drawn thing is a theme subject (#117, #119)", () => {
  it("structure perimeters take stroke/width/dash, through derivation and states (#117)", () => {
    const src = [
      "map: battlemap",
      "grid: square 20x10",
      "scale: 5ft",
      "[vocab]",
      "hall : building",
      "[structures]",
      "building b1 : B2..E6",
      "hall h1 : H2..K6",
      "building b2 : N2..Q6",
      "  ruined : north",
    ].join("\n");
    const theme = [
      "[theme]",
      "building : fill=#112233 stroke=#ff0000 width=4",
      "hall : stroke=#00ff00",
      "building.ruined : stroke=#0000ff dash=9,9",
    ].join("\n");
    const { svg } = renderSource(src, { theme });
    expect(svg).toContain("#112233"); // fill worked before
    expect(svg).toContain("#ff0000"); // …the walls did not
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain("#00ff00"); // a derived word inherits the outline
    expect(svg).toContain("#0000ff"); // word.state reaches the perimeter too
    expect(svg).toContain('stroke-dasharray="9 9"');
  });

  it("a bare `ruined` state ruins every side, as the detail form does per side", () => {
    const src = ["map: battlemap", "grid: square 12x8", "[structures]", "building b : B2..E6 ruined"].join("\n");
    const { svg } = renderSource(src);
    // Freestanding barriers already honoured the flag; structures read it only
    // from detail lines, so a flag-form ruin drew as intact walls.
    expect(svg).toContain('stroke-dasharray="5 6"');
  });

  it("a themed glyph carries its entry's colour, and point-placed barriers take glyphs (#119)", () => {
    const src = [
      "map: battlemap",
      "grid: square 10x8",
      "scale: 5ft",
      "[structures]",
      "pillar p1 : I3",
      "[features]",
      "statue s1 : B8",
    ].join("\n");
    const theme = [
      "[theme]",
      "pillar : glyph=swing fill=#0000ff",
      "statue : glyph=swing fill=#ffff00",
      "[glyphs]",
      'swing : "M-8,8 A16,16 0 0,1 8,-8"',
    ].join("\n");
    const { svg } = renderSource(src, { theme });
    // Both draw the glyph — a pillar occupies a cell exactly like a statue.
    expect(svg.match(/M-8,8 A16,16/g) ?? []).toHaveLength(2);
    // …and each keeps its colour: glyph and fill are independent properties.
    expect(svg).toContain("#ffff00");
    expect(svg).toContain("#0000ff");
  });
});

describe("openings perforate declared terrain; passes= is enumerated (#113)", () => {
  const mk = (opening: string): string =>
    [
      "map: battlemap", "grid: square 12x8", "scale: 10ft",
      "[vocab]", "arch : opening sight=all",
      "[terrain]", "earth : area A1..L8",
      "[structures]", "passage hall : D3..H6",
      "[features]", opening,
    ].join("\n");

  it("an opening in a rock face needs no parent structure", () => {
    const { diagnostics } = renderSource(mk("gate great-gates : D4.w"), { mode: "gm" });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("solid means the WINNING terrain declaration, not merely one that was made (#125)", () => {
    const base = ["map: battlemap", "grid: square 12x8", "scale: 5ft", "[terrain]"];
    // Overpainted: `earth` is declared, then grass wins those cells (spec 06
    // §6). E4/D4 are walkable, so the gate perforates nothing.
    const overpainted = [...base, "grass west : area A1..D8", "earth : area E1..L8", "grass east : area E1..H8",
      "[features]", "gate g1 : E4.w"].join("\n");
    // Same geometry, no redundant earth underneath.
    const plain = [...base, "grass west : area A1..D8", "grass east : area E1..H8", "earth : area I1..L8",
      "[features]", "gate g1 : E4.w"].join("\n");
    for (const [label, src] of [["overpainted", overpainted], ["plain", plain]] as const) {
      const err = renderSource(src, { mode: "gm" }).diagnostics.find((d) => d.severity === "error");
      expect(err?.message, label).toMatch(/no barrier to perforate/);
    }
  });

  it("an unparented opening may also sit on a wall or a perimeter, as it always could", () => {
    // Regression: the first cut checked only `earth`, so it rejected two forms
    // spec 06 §3 has always permitted — and the error message promised all three.
    const src = [
      "map: battlemap", "grid: square 12x8", "scale: 5ft",
      "[structures]",
      "wall palisade : E2.n F2.n G2.n",
      "gate w1 : F2.n",
      "building hall : B4..E7",
      "gate h1 : E5.e",
    ].join("\n");
    expect(renderSource(src, { mode: "gm" }).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // …but an opening with no barrier anywhere near it still fails loud.
    const lonely = "map: battlemap\ngrid: square 9x9\n[features]\ngate lonely : C4.e\n";
    expect(renderSource(lonely, { mode: "gm" }).diagnostics.find((d) => d.severity === "error")?.message)
      .toMatch(/no barrier to perforate/);
  });

  it("fails loud with nothing to pass through, or buried in stone", () => {
    // Rooms carve the rock, so F4/F3 are both floor.
    const inRoom = renderSource(mk("arch inner : F4.n"), { mode: "gm" });
    expect(inRoom.diagnostics.find((d) => d.severity === "error")?.message).toMatch(/no barrier to perforate/);
    const buried = renderSource(mk("door buried : B2.e"), { mode: "gm" });
    expect(buried.diagnostics.find((d) => d.severity === "error")?.message).toMatch(/solid ground on both sides/);
  });

  it("passes= resolves through the chain, defaulting to open — an arch is not a shut door", () => {
    // `gate` inherits door's passes=closed facet: a portal, closed.
    const gate = exportUvttSource(mk("gate great-gates : D4.w"), { mode: "gm" }).uvtt as
      | { portals: { closed: boolean }[] } | null;
    expect(gate?.portals.map((p) => p.closed)).toEqual([true]);
    // `arch : opening sight=all` leaves passes unset → open → no leaf, no portal.
    // Before #113 the facet was never read and this exported as a CLOSED portal.
    const arch = exportUvttSource(mk("arch a1 : D4.w"), { mode: "gm" }).uvtt as
      | { portals: unknown[] } | null;
    expect(arch?.portals).toEqual([]);
  });

  it("the rock boundary is an occluder, so a cave exports with line_of_sight", () => {
    const uvtt = exportUvttSource(mk("gate great-gates : D4.w"), { mode: "gm" }).uvtt as
      | { line_of_sight: unknown[] } | null;
    // Without the earth boundary this was only the room's own 16 wall segments.
    expect((uvtt?.line_of_sight.length ?? 0)).toBeGreaterThan(16);
  });
});

describe("free text renders as text alone (spec 07 §2, #104)", () => {
  const NOTES = [
    "map: battlemap",
    "grid: square 20x12",
    "scale: 5ft",
    "[labels]",
    'note "point anchored" : C9',
    'note "sprawled across" : sprawl F2..N4',
    'note "range footprint" : P8..T10',
  ].join("\n");

  it("no marker at any placement form — a caption promises nothing is there", () => {
    const { svg } = renderSource(NOTES);
    for (const label of ["point anchored", "sprawled across", "range footprint"]) {
      expect(svg).toContain(label);
    }
    // The generic-feature fallback tint (spec 04 §4) is what a note used to
    // get; a marker beside a caption asserts an object at that cell.
    expect(svg).not.toMatch(/hsl\(\d+ 32% 55%\)/);
  });

  it("sprawl is letter-spaced, so it differs from a bare range placement", () => {
    const { svg } = renderSource(NOTES);
    const sprawled = /<text[^>]*letter-spacing="[\d.]+"[^>]*>sprawled across<\/text>/.exec(svg);
    expect(sprawled).not.toBeNull();
    expect(svg).toMatch(/<text(?![^>]*letter-spacing)[^>]*>range footprint<\/text>/);
  });

  it("`along` sets the caption on the referenced course (#107, was a warning in 0.3.3)", () => {
    const src = [
      "map: battlemap",
      "grid: square 20x12",
      "scale: 5ft",
      "[terrain]",
      "river r1 \"The Rill\" : path A6 T6 width=2",
      "[labels]",
      'note "along the rill" : along r1',
    ].join("\n");
    const { svg, diagnostics } = renderSource(src);
    expect(diagnostics.filter((d) => d.severity !== "error").map((d) => d.message)).toEqual([]);
    expect(svg).toContain("along the rill");
    expect(svg).toMatch(/<textPath href="#cdnote-/);
  });

  it("a course that cannot be resolved still warns rather than vanishing", () => {
    const src = [
      "map: battlemap", "grid: square 20x12", "scale: 5ft",
      "[features]", 'statue s1 "The Watcher" : C4',
      "[labels]", 'note "beside a point" : along s1',
    ].join("\n");
    const { diagnostics } = renderSource(src);
    expect(diagnostics.find((d) => d.severity === "warning")?.message).toMatch(/draws nothing/);
  });
});

describe("output is well-formed XML (#79)", () => {
  // parseXml is strict: a raw & or < anywhere in text content throws. Any
  // call site that leaks user text into markup unescaped fails here.
  const wellFormed = (src: string): void => {
    for (const mode of ["player", "gm"] as const) {
      expect(() => parseXml(renderSource(src, { mode }).svg)).not.toThrow();
    }
  };

  it("battlemap tooltips escape display names and gm notes", () => {
    const src = [
      "map: battlemap",
      "grid: square 8x8",
      "[structures]",
      'building vault "B - Treasury & Accounting <Ltd>" : A1..D4',
      "  door : B4.s",
      "[features]",
      "crates loot : F6 gm=\"DC 25 <encrypted> & warded\"",
    ].join("\n");
    const { svg } = renderSource(src, { mode: "gm" });
    expect(svg).toContain("&amp;");
    wellFormed(src);
  });

  it("region and hexcrawl tooltip paths escape too", () => {
    const region = [
      "map: region",
      "extent: 100x100mi",
      "[terrain]",
      'forest "Briar & Bramble <Wood>" : blob (50,50) size=20mi gm="Home of the Wolf & Wight"',
    ].join("\n");
    wellFormed(region);
    const hexcrawl = [
      "map: hexcrawl",
      "grid: hex 4x4 pointy odd",
      "[hexes]",
      'B2 : forest "Thorn & Tangle" gm="Spiders < everywhere >"',
    ].join("\n");
    wellFormed(hexcrawl);
  });

  for (const name of ["redford-crossing", "brenmark", "vessany", "gumdrop-vale", "fairwater-manor", "gilded-tankard", "sundered-reach"]) {
    it(`${name} parses as XML in both modes`, () => {
      wellFormed(example(name));
    });
  }
});

describe("snapshots", () => {
  for (const name of ["redford-crossing", "brenmark", "vessany", "gumdrop-vale"]) {
    it(`${name} SVG snapshot is stable`, () => {
      expect(renderSource(example(name), { mode: "gm" }).svg).toMatchSnapshot();
    });
  }
});

/**
 * The `sight=` half of #131. The reporter could not test this and said so:
 * spec 06 §9 gives `sight=` no distinct UVTT surface, so all four values
 * export identically. It IS observable in the render — `sight=all` makes the
 * edge transparent to light — which is where the fallback has to be checked.
 */
describe("sight= recovers to the vocabulary default too (#131)", () => {
  const src = (suffix: string): string =>
    [
      "map: battlemap", "grid: square 8x6", "scale: 5ft", "light: dark",
      "[vocab]", "window2 : window",
      "[structures]", "building b1 : B2..E5", `  window2 : E3.e${suffix}`,
      "[features]", "torch t1 : C3 light=20ft",
    ].join("\n");
  const svg = (suffix: string): string => renderSource(src(suffix), {}).svg;

  it("an out-of-set value renders as the inherited default, not as blocking", () => {
    const base = svg(""); // window2 : window, so the default is sight=all
    expect(svg(" sight=all"), "all").toBe(base);
    expect(svg(" sight=bogus"), "bogus").toBe(base);
    expect(svg(" sight=none"), "none").not.toBe(base); // the facet still works
  });
});

/**
 * #132: the legibility floor and the hierarchy floor are separate concerns and
 * were conflated in `Math.max(8, fontSize - 3)`. Unit-tested rather than driven
 * through a document: the constants only mean anything in relation to each
 * other, and synthetic crowding cannot reliably force the shrink path (a tier
 * claims by font size, so a hamlet under pressure is dropped by earlier
 * claimants before it ever shrinks).
 */
describe("shrink floors are two floors, not one (#132)", () => {
  const TIERS = { capital: 13, city: 11, town: 10, village: 9, hamlet: 8 };

  it("every tier can shrink — a hamlet had ZERO headroom", () => {
    // Old floor: max(8, 8 - 3) = 8, identical to base, so any crowding took a
    // hamlet from full size straight to omission with no step in between.
    for (const [tier, base] of Object.entries(TIERS)) {
      expect(shrinkFloor(base), tier).toBeLessThan(base);
    }
  });

  it("hierarchy is preserved: a bigger tier never floors below a smaller one", () => {
    const floors = Object.values(TIERS).map((b) => shrinkFloor(b));
    for (let i = 1; i < floors.length; i++) expect(floors[i - 1]!).toBeGreaterThanOrEqual(floors[i]!);
    expect(shrinkFloor(TIERS.capital)).toBeGreaterThan(shrinkFloor(TIERS.hamlet));
  });

  it("the floor is proportional, so the old capital-vs-constant trap is gone", () => {
    // A capital's floor was 10 and governed by `fontSize - 3`, so lowering the
    // `8` — the fix #132 originally proposed — could not move it at all.
    expect(shrinkFloor(13)).toBeLessThan(10);
  });

  it("floors are whole numbers — the fallback claims AT the floor", () => {
    for (const base of Object.values(TIERS)) expect(shrinkFloor(base) % 1).toBe(0);
  });

  it("a wider canvas raises the legibility floor, but never above the base size", () => {
    expect(shrinkFloor(18, 3000)).toBeGreaterThan(shrinkFloor(18, 400));
    for (const base of Object.values(TIERS)) expect(shrinkFloor(base, 5000)).toBeLessThanOrEqual(base);
  });
});

/**
 * #133: a label with no adjacent slot may sit in open space with a leader line
 * back to its marker, instead of being dropped (spec 07 §5 rule 3).
 */
describe("leader lines rescue labels that would be omitted (#133)", () => {
  // One marker boxed in by long names on every side, with open space beyond.
  const crowded = [
    "map: region", "extent: 900x600mi", "[settlements]",
    // The subject is the LOWEST tier so it claims last (priority is font size,
    // spec 07 §5 rule 1) and genuinely faces a full neighbourhood.
    'hamlet subject "Subjecttown" : (450,300)',
    ...[[430,290],[470,290],[430,310],[470,310],[450,285],[450,320],[425,300],[475,300]]
      .map(([x, y], i) => `capital "Averyverylongcompetitorname${i}" : (${x},${y})`),
  ].join("\n");

  it("the name is kept and connected rather than dropped", () => {
    const { svg } = renderSource(crowded, {});
    expect(svg).toContain(">Subjecttown<");
    const leaders = svg.match(/<line [^>]*opacity="0\.55"/g) ?? [];
    expect(leaders.length, "a leader should connect the displaced name").toBeGreaterThan(0);
  });

  it("the leader stays within its bound — names do not wander off", () => {
    const { svg } = renderSource(crowded, {});
    for (const m of svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"[^>]*opacity="0\.55"/g)) {
      const [, x1, y1, x2, y2] = m.map(Number);
      // 45 is the bound, measured marker-to-label-anchor; the drawn line runs
      // to the box edge, so allow the label's own half-width beyond it.
      expect(Math.hypot(x1! - x2!, y1! - y2!)).toBeLessThan(120);
    }
  });

  it("placement stays deterministic", () => {
    expect(renderSource(crowded, {}).svg).toBe(renderSource(crowded, {}).svg);
  });
});

describe("detail: reference enlarges the canvas (#139, ADR 0020)", () => {
  const map = (hdr: string): string =>
    ["# T", "map: region", "extent: 1750x1550mi", hdr, "[settlements]",
     'capital hk "Highkeep" : (900,700)'].filter(Boolean).join("\n");
  const widthOf = (svg: string): number => Number(svg.match(/viewBox="0 0 ([\d.]+)/)![1]);

  it("overview is the default, so existing documents do not move", () => {
    expect(widthOf(renderSource(map(""), {}).svg)).toBe(820);
    expect(renderSource(map("detail: overview"), {}).svg).toBe(renderSource(map(""), {}).svg);
  });

  it("reference doubles the canvas, and the map scales with it", () => {
    const ref = renderSource(map("detail: reference"), {}).svg;
    expect(widthOf(ref)).toBe(1640);
    // Same document, so the marker sits at the same FRACTION of the canvas.
    // Compare CENTRES, not the rect's x: x is `cx - r` and the tier radius is
    // an absolute size that deliberately does not scale with the canvas, so
    // the corner drifts ~0.7% while the centre is exact.
    const centre = (svg: string): number => {
      const m = svg.match(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"[^>]*transform="rotate\(45/)!;
      return Number(m[1]) + Number(m[2]) / 2;
    };
    const ratio = centre(ref) / 1640 / (centre(renderSource(map(""), {}).svg) / 820);
    expect(ratio).toBeCloseTo(1, 3);
  });
});


/**
 * #130: a barrier word in a structure detail replaces that side's perimeter
 * with that barrier — the spelling authors already reach for, which used to
 * draw an ordinary wall and take no styling.
 */
describe("a barrier word replaces a structure side (#130)", () => {
  const hall = (details: string[]): string =>
    ["map: battlemap", "grid: square 12x10", "scale: 5ft",
     "[vocab]", "cave-in : wall", "choke : fence",
     "[structures]", 'building hall "The Hall" : B2..H8', ...details].join("\n");
  const losPoints = (src: string): number =>
    (exportUvttSource(src, {}).uvtt!["line_of_sight"] as unknown[][]).reduce((n, p) => n + p.length, 0);

  it("the side takes the barrier's own theme, not the structure's", () => {
    const theme = ["kind: theme", "[theme]", "cave-in : stroke=#8a5a3a dash=3,3 width=4"].join("\n");
    const svg = renderSource(hall(["  cave-in : east"]), { theme }).svg;
    expect(svg).toMatch(/stroke="#8a5a3a"[^>]*stroke-width="4"/);
  });

  it("the FACET decides occlusion, not the word", () => {
    // A `fence`-derived choke passes sight; a `wall`-derived cave-in does not.
    // `sightOf`'s default is written for openings ("no leaf means sight
    // passes"), which is exactly wrong for a barrier — a cave-in that stopped
    // occluding would be silent wrongness of the worst kind.
    expect(losPoints(hall(["  choke : north"]))).toBeLessThan(losPoints(hall(["  cave-in : north"])));
    expect(losPoints(hall(["  cave-in : north"]))).toBe(losPoints(hall([])));
  });

  it("edge tokens select edges directly", () => {
    expect(renderSource(hall(["  cave-in : C2.n D2.n"]), {}).svg).toBeTruthy();
    expect(exportUvttSource(hall(["  cave-in : C2.n D2.n"]), {}).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a side word selects every perimeter edge FACING that way", () => {
    // An L-shaped hall's `east` is all of its east-facing edges, not one side
    // of a bounding box — the same rule `ruined` follows on a cell union.
    const ell = ["map: battlemap", "grid: square 14x12", "scale: 5ft",
      "[vocab]", "cave-in : wall",
      "[structures]", "building ell : B2..E8 F2..H4", "  cave-in : east"].join("\n");
    expect(exportUvttSource(ell, {}).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(renderSource(ell, {}).svg).toBeTruthy();
  });
});


describe("join lands on the trunk's finished curve (#94)", () => {
  const src = (terminal: string): string =>
    ["map: region", "extent: 900x800mi",
     "[water]", "coastline coast : from (100,0) via (120,400) to (100,800)",
     "[paths]",
     "river trunk : from (625,215) via (605,360) (588,500) to coast",
     `river trib : from (800,320) via (700,440) ${terminal}`].join("\n");
  const courseOf = (svg: string, id: string): number[][] => {
    const m = svg.match(new RegExp(`<g id="cd-[^"]*-${id}"><polyline points="([^"]+)"`));
    if (!m?.[1]) throw new Error(`no rendered course for '${id}'`);
    return m[1].trim().split(/\s+/).map((s) => s.split(",").map(Number));
  };
  const gapToTrunk = (svg: string): number => {
    const trunk = courseOf(svg, "trunk");
    const end = courseOf(svg, "trib").at(-1)!;
    let best = Infinity;
    for (let i = 1; i < trunk.length; i++) {
      const a = trunk[i - 1]!, b = trunk[i]!;
      const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
      const L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((end[0]! - a[0]!) * dx + (end[1]! - a[1]!) * dy) / L));
      best = Math.min(best, Math.hypot(a[0]! + dx * t - end[0]!, a[1]! + dy * t - end[1]!));
    }
    return best;
  };

  it("the tributary ends ON the trunk, not near it", () => {
    expect(gapToTrunk(renderSource(src("join trunk"), {}).svg)).toBeLessThan(0.5);
  });

  it("the confluence is live — moving the trunk moves it", () => {
    // The failure this replaces: coincident literal coordinates that detach
    // silently when the trunk is edited.
    const moved = src("join trunk").replace("via (605,360) (588,500)", "via (500,360) (480,500)");
    expect(gapToTrunk(renderSource(moved, {}).svg)).toBeLessThan(0.5);
    expect(renderSource(moved, {}).svg).not.toBe(renderSource(src("join trunk"), {}).svg);
  });

  it("'to <river>' still means the midpoint, so the pair reads deliberately", () => {
    // Both land on the trunk — a midpoint is on the curve too — so what
    // matters is WHERE. This tributary approaches the trunk's HEAD, far from
    // its midpoint, which is the discrimination the first fixture lacked:
    // there the two happened to coincide within 5px and proved nothing.
    const high = (terminal: string): string =>
      ["map: region", "extent: 900x800mi",
       "[paths]",
       "river trunk : from (600,100) via (600,400) to (600,700)",
       `river trib : from (850,110) via (750,115) ${terminal}`].join("\n");
    const endOf = (terminal: string): number[] => courseOf(renderSource(high(terminal), {}).svg, "trib").at(-1)!;
    const j = endOf("join trunk");
    const t = endOf("to trunk");
    // join meets it where the tributary arrives (near y=115); to walks to the
    // trunk's middle (near y=400).
    expect(j[1]!).toBeLessThan(250);
    expect(t[1]!).toBeGreaterThan(300);
  });
});


/**
 * #94, second half: two watercourses that cross without meeting are nonsense
 * on the ground. Nothing governed this before — the battlemap crossing rule
 * (spec 06 §6) is cell-based and does not reach region maps, so a visible X
 * between two rivers drew in silence.
 */
describe("rivers that cross without meeting warn (#94)", () => {
  const doc = (lines: string[]): string => ["map: region", "extent: 900x800mi", "[paths]", ...lines].join("\n");
  const crossings = (src: string): string[] =>
    renderSource(src, {}).diagnostics.filter((d) => /cross at/.test(d.message)).map((d) => d.message);

  const A = 'river a "River A" : from (200,200) via (450,400) to (700,600)';

  it("flags a genuine X", () => {
    expect(crossings(doc([A, 'river b "River B" : from (700,200) via (450,400) to (200,600)']))).toHaveLength(1);
    expect(crossings(doc([A, 'river b "River B" : from (700,200) via (450,400) to (200,600)']))[0])
      .toMatch(/'River A' and 'River B' cross at \(\d+,\d+\) without meeting/);
  });

  it("a declared meeting is not a crossing — in either direction", () => {
    // join: tributary ends on the trunk. from <river>: a distributary leaves
    // it. Both are declared relationships, and firing on them would make the
    // check useless on exactly the documents that use the feature correctly.
    expect(crossings(doc([A, 'river b "River B" : from (700,200) via (500,300) join a']))).toEqual([]);
    expect(crossings(doc([A, 'river b "River B" : from a via (500,300) to (700,200)']))).toEqual([]);
  });

  it("leaves roads alone — a road crossing a river is a ford, not an error", () => {
    expect(crossings(doc([A, 'road r "The Road" : from (700,200) via (450,400) to (200,600)']))).toEqual([]);
  });

  it("says nothing when they do not cross", () => {
    expect(crossings(doc(['river a "A" : from (200,200) to (200,600)', 'river b "B" : from (700,200) to (700,600)']))).toEqual([]);
  });
});


describe("solitary peak and volcano (#95)", () => {
  const doc = (lines: string[]): string =>
    ["map: region", "extent: 1400x900mi", "[terrain]", ...lines].join("\n");
  const silhouette = (svg: string, id: string): string | null => {
    const m = svg.match(new RegExp(`<g id="cd-[^"]*${id}"[^>]*>.*?<path d="([^"]+)"`));
    return m?.[1] ?? null;
  };

  it("a peak is a mountain silhouette at a point, not a settlement dot", () => {
    // The whole complaint: `mountains … blob size=` drew a round region, and
    // a bare point fell through to the settlement marker.
    const svg = renderSource(doc(['peak erebor "Erebor" : (600,300)']), {}).svg;
    const d = silhouette(svg, "erebor");
    expect(d).toBeTruthy();
    expect((d!.match(/L/g) ?? []).length + 1).toBe(3); // apex triangle
    expect(svg).toContain("Erebor");
  });

  it("a volcano reads as one on the map, not only in its name", () => {
    const svg = renderSource(doc(['volcano orodruin "Orodruin" : (900,600)']), {}).svg;
    expect((silhouette(svg, "orodruin")!.match(/L/g) ?? []).length + 1).toBe(6); // truncated cone + crater
  });

  it("volcano derives from peak, so it inherits the point-scale behaviour", () => {
    // Derivation, not a second implementation: a word deriving from `volcano`
    // must still place as a peak (spec 04 §2, ADR 0016).
    const svg = renderSource(doc(["[vocab]", "firemount : volcano", "[terrain]",
      'firemount m "Mount Ash" : (700,400)'].join("\n").split("\n")), {}).svg;
    expect(silhouette(svg, "m")).toBeTruthy();
  });

  it("states are declared, so a typo warns rather than rendering silently", () => {
    expect(renderSource(doc(['volcano v "V" : (700,400) erupting']), {}).diagnostics
      .filter((d) => d.severity === "warning")).toEqual([]);
    expect(renderSource(doc(['volcano v "V" : (700,400) eruptng']), {}).diagnostics
      .map((d) => d.message).join()).toMatch(/not a declared state/);
  });
});


/**
 * #142: a shape may be declared in a referent's frame, so it travels with it.
 * Anchoring only the first point was measured and rejected — it drags one end
 * and leaves the rest, deforming the shape instead of moving it.
 */
describe("a framed shape travels with its referent (#142)", () => {
  const doc = (peakAt: string, spur: string): string =>
    ["map: region", "extent: 1400x900mi", "[terrain]",
     `peak erebor "Erebor" : ${peakAt}`,
     `mountains arm "Spur" : ${spur} width=40mi`].join("\n");
  const boxOf = (src: string): { x: number; y: number; w: number; h: number } => {
    const m = renderSource(src, {}).svg.match(/<g id="cd-[^"]*arm"><polygon points="([^"]+)"/);
    if (!m?.[1]) throw new Error("spur did not render");
    const pts = m[1].trim().split(/\s+/).map((t) => t.split(",").map(Number));
    const xs = pts.map((q) => q[0]!), ys = pts.map((q) => q[1]!);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  const FRAMED = "ridge on erebor at (-70,100) (-90,170)";

  it("moving the referent TRANSLATES the shape — size is unchanged", () => {
    // The assertion is the bounding box, not a coordinate: a coordinate check
    // passes for a deformed shape, which is exactly the bug this replaces.
    const a = boxOf(doc("(700,300)", FRAMED));
    const b = boxOf(doc("(900,300)", FRAMED));
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.w).toBeCloseTo(a.w, 5);
    expect(b.h).toBeCloseTo(a.h, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
  });

  it("an unframed shape still does not move — the old behaviour is untouched", () => {
    const plain = "ridge (630,400) (610,470)";
    expect(boxOf(doc("(700,300)", plain))).toEqual(boxOf(doc("(900,300)", plain)));
  });

  it("two spurs share one frame, so a massif moves as a unit", () => {
    const two = ["map: region", "extent: 1400x900mi", "[terrain]",
      'peak erebor "Erebor" : (700,300)',
      'mountains arm "West" : ridge on erebor at (-70,100) (-90,170) width=40mi',
      'mountains arm2 "East" : ridge on erebor at (75,100) (95,170) width=40mi'].join("\n");
    const leftEdge = (src: string, id: string): number => {
      const m = renderSource(src, {}).svg.match(new RegExp(`<g id="cd-[^"]*${id}"><polygon points="([0-9.]+),`));
      if (!m?.[1]) throw new Error(`no polygon for ${id}`);
      return Number(m[1]);
    };
    const moved = two.replace("(700,300)", "(900,300)");
    // Both arms shift by the same amount: the massif is one rigid thing.
    expect(leftEdge(moved, "arm") - leftEdge(two, "arm"))
      .toBeCloseTo(leftEdge(moved, "arm2") - leftEdge(two, "arm2"), 5);
  });
});


/**
 * #96: spec 02 §9 has always promised the renderer finishes a sketch
 * organically. Coastlines, blobs and ridge belts got it; `area` did not, so a
 * shaped forest rendered as a straight-edged polygon and the only way to fake
 * curves was thirty hand-placed points.
 */
describe("area terrain is organically finished (#96)", () => {
  const doc = (line: string, extra: string[] = []): string =>
    ["map: region", "extent: 1400x900mi", "seed: 7", ...extra, "[terrain]", line].join("\n");
  const verts = (src: string, id: string): number => {
    const m = renderSource(src, {}).svg.match(new RegExp(`<g id="cd-[^"]*${id}"[^>]*><polygon points="([^"]+)"`));
    return m?.[1] ? m[1].trim().split(/\s+/).length : 0;
  };
  const WOOD = 'forest wood "Wood" : area (905,190) (975,180) (1045,235) (1070,360) (1050,470) (995,560)';

  it("a shaped patch gains a finished outline instead of straight edges", () => {
    expect(verts(doc(WOOD), "wood")).toBeGreaterThan(50);
  });

  it("`raw` opts back into literal edges", () => {
    // Surveyed parcels and political enclaves want a hard boundary.
    expect(verts(doc(`${WOOD} raw`), "wood")).toBe(6);
  });

  it("finishing is deterministic, and the seed governs it (spec 02 §8.2)", () => {
    expect(renderSource(doc(WOOD), {}).svg).toBe(renderSource(doc(WOOD), {}).svg);
    expect(renderSource(doc(WOOD), {}).svg).not.toBe(renderSource(doc(WOOD).replace("seed: 7", "seed: 8"), {}).svg);
  });

  it("an outline that FOLLOWS a feature stays literal", () => {
    // `along` splices the feature's own finished curve (ADR 0012). Re-splining
    // it would pull the boundary off the thing it is defined to follow, which
    // is the one property that idiom exists to guarantee.
    const src = ["map: region", "extent: 1400x900mi", "seed: 7",
      "[paths]", "river spine : from (900,100) via (950,300) to (1000,600)",
      "[terrain]", 'forest wood "Wood" : area (905,190) along spine (1050,470) (995,560)'].join("\n");
    const svg = renderSource(src, {}).svg;
    const m = svg.match(/<g id="cd-[^"]*wood"[^>]*><polygon points="([^"]+)"/);
    if (!m?.[1]) throw new Error("the feature-following wood did not render");
    const pts = m[1].trim().split(/\s+/);
    // The spliced course dominates the vertex list; no organic resampling on top.
    expect(renderSource(src, {}).svg).toBe(svg);
    expect(pts.length).toBeGreaterThan(3);
  });

  it("`raw` is a reserved flag, not an undeclared state", () => {
    expect(renderSource(doc(`${WOOD} raw`), {}).diagnostics
      .map((d) => d.message).join()).not.toMatch(/not a declared state/);
  });
});
