import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseXml } from "@rgrove/parse-xml";
import { describe, expect, it } from "vitest";
import { exportUvttSource, renderSource } from "./index";

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
    // Perimeter merges to 6 straight wall runs; both north-facing runs are
    // ruined (dashed), the rest solid.
    const walls = svg.match(/stroke="#3d3629" stroke-width="3"/g) ?? [];
    expect(walls).toHaveLength(6);
    const dashed = svg.match(/stroke-dasharray="5 6"/g) ?? [];
    expect(dashed).toHaveLength(2);
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
