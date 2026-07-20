# Prior Art Survey

*Fulfills [#1](https://github.com/Nossimonov/Chartdown/issues/1). Researched July 2026. Three clusters: text-to-diagram languages (what made them succeed), TTRPG map tools and formats (what the incumbents encode), and text-native map languages (whether this problem is already solved).*

**Headline verdict:** the specific niche Chartdown targets — a readable, Markdown-embeddable, semantic, multi-map-type, version-controllable map language — is **open, but not untouched**. The core idea "plain text → SVG hex map" has existed since ~2007 (Text Mapper) and is still maintained; what nobody has is battlemaps, a formal spec, semantic modeling, a portable implementation, or Markdown embedding that isn't dormant. Details in [§4](#4-viability-verdict).

---

## 1. Text-to-diagram languages

These prove the category (text in a fenced block → rendered diagram) and teach the adoption playbook. Their shared blind spot is Chartdown's opening: they are all **relational** (nodes and edges, automatic layout), while maps are **positional**.

### Mermaid

Line-oriented DSL; first keyword selects the diagram grammar (~30 types as of v11.16). Renders client-side in pure JS, which is exactly why ` ```mermaid ` fences render natively on GitHub, GitLab, Obsidian, Notion, and Azure DevOps — no server, no Java. Theming is layered: site-wide init → per-diagram YAML frontmatter over a single modifiable `base` theme with derived variables; "secure" config keys can't be overridden by document authors (a sandboxing model embedding hosts require). New grammars ship with a `-beta` keyword suffix and drop it on stabilization — versioning at the grammar level, not the library level.

- **Steal:** frontmatter config co-located with source; `-beta` grammar evolution; the security split between author-settable and host-reserved config; first-token dispatch to per-map-type grammars.
- **Avoid:** nothing structural — but note its April 2026 scramble to restore v10 compatibility: users severely punish breakage of diagrams embedded in prose.
- **Positional story:** none. `block-beta` (column grid) and `architecture-beta` (direction hints) are the closest, both slot-relative. Demand for spatial types is documented and unserved: a floorplan syntax proposal ([mermaid#6134](https://github.com/mermaid-js/mermaid/issues/6134)) has sat in triage untouched since Dec 2024, and a D&D dungeon-map discussion ([#7064](https://github.com/orgs/mermaid-js/discussions/7064), Oct 2025) has zero replies.

Sources: [mermaid.js.org](https://mermaid.js.org/intro/), [theming](https://mermaid.ai/open-source/config/theming.html), [GitHub PlantUML discussion](https://github.com/orgs/community/discussions/10111)

### PlantUML

`@startuml…@enduml` blocks, enormous feature surface, Java + Graphviz, typically server-rendered via deflate-encoded URLs. Strictly more capable than Mermaid; lost the embedding war anyway because platforms wouldn't take the server/Java dependency. Its positioning stance is the cautionary tale: the community guide states *"wrangling diagram elements to an exact position or layout is not what PlantUML is for,"* and decades of forum threads show layout control is the #1 chronic user pain, worked around with hidden-edge hacks.

- **Steal:** the URL-encoding trick (deflate+base64 source in a URL) for zero-install sharing links.
- **Avoid:** server-dependent rendering as the primary path; `skinparam`-style styling sprawl (hundreds of inconsistent knobs); any philosophy that fights users who want to say *where things are*.

Sources: [text-encoding](https://plantuml.com/text-encoding), [Hitchhiker's Guide on layout](https://crashedmind.github.io/PlantUMLHitchhikersGuide/layout/layout.html)

### Kroki

Unified HTTP gateway aggregating ~28 diagram DSLs (PlantUML, Mermaid, D2, ditaa, Pikchr, nwdiag…) behind one URL scheme; admin-enabled integration renders fenced blocks across GitLab, Gitea, Asciidoctor, Sphinx, Antora, Obsidian. It already carries niche *positional* DSLs (Pikchr's coordinate placement, ditaa/SvgBob's ASCII-art, rackdiag's slots) — precedent that spatial oddballs enter ecosystems through Kroki rather than through Mermaid core.

- **Steal:** the adoption path itself. One renderer merged into Kroki yields a whole ecosystem of embedding hosts at once. This is the cheapest distribution channel available to a new DSL.

Sources: [kroki.io](https://kroki.io/), [GitLab integration](https://docs.gitlab.com/administration/integration/kroki/)

### D2 (Terrastruct)

The newest entrant (~20k stars, still pre-1.0): clean JSON-without-quotes syntax, containers, icons, a hand-drawn `sketch` mode, autoformatter, language server. Most instructive is its layout architecture: pluggable engines, where the good positioning features (`near: <object>`, absolute `top`/`left`) are **gated behind the proprietary TALA engine**. The open-source answer is grid diagrams (`grid-rows`/`grid-columns`) — which have a known wart: once positions are fixed, the layout engine can no longer route connections well ([d2#2635](https://github.com/terrastruct/d2/issues/2635)).

- **Steal:** developer-experience bar (playground, watch mode, autoformat, LSP); `sketch` mode is exactly the aesthetic a TTRPG audience wants.
- **Avoid:** gating core capability behind a proprietary component; but especially **learn from the grid wart** — if Chartdown ever adds relational overlays on fixed geometry (patrol routes, sight lines), routing over user-positioned elements must be designed in from the start, since it's precisely what auto-layout engines fail at.

Sources: [d2lang.com/tour/positions](https://d2lang.com/tour/positions/), [grid diagrams](https://d2lang.com/tour/grid-diagrams/)

### Graphviz / DOT

The 35-year-old granddaddy, still maintained. Its longevity lessons: a tiny, stable, formally specified grammar; language separated from layout engine (six engines consume the same text); an open attribute namespace that absorbed decades of features without grammar breaks. DOT became an *interchange format* — many tools emit and consume it without ever running Graphviz. Explicit positioning exists (`pos="x,y!"`, `neato -n`) but is bolted-on, unit-confusing, silently ignored by the default engine, and almost never discovered.

- **Steal:** spec-independent-of-renderer as an explicit goal, so third parties (VTT importers, generators) can parse Chartdown without Chartdown's renderer; open attribute namespace for forward compatibility.
- **Avoid:** raw float coordinates with ambient unit conventions — DOT's inches-and-origin confusion shows bare coordinates are hostile in plain text.

Sources: [pos attribute](https://graphviz.org/docs/attrs/pos/), [DOT history](https://en.wikipedia.org/wiki/DOT_(graph_description_language))

**Cluster summary:** no ecosystem has a map/spatial diagram type; every one of them either forbids, upsells, or hides explicit positioning. A natively positional language inverts the #1 chronic pain of the entire category.

---

## 2. TTRPG map tools and formats

The incumbents define the semantic vocabulary Chartdown must express, and none of them is text-first.

### Universal VTT (.uvtt / .dd2vtt)

De facto battlemap interchange JSON, created by the Dungeondraft dev: grid resolution, wall polylines (`line_of_sight`), object blockers, portals (doors/windows with position, rotation, closed/freestanding flags), point lights (position, range, intensity, color, shadows), ambient environment — plus a **base64-embedded raster image**, which is why it's machine-only in practice. Coordinates are float *grid squares*, resolution-independent. Square grids only; **no hex concept at all**. As of July 2026 essentially every major VTT imports it: Foundry (module), Fantasy Grounds (native), MapTool, Owlbear Rodeo (extensions), and — since July 16, 2026 — **Roll20, natively, on the free tier**.

- **Steal:** float grid-square units (makes UVTT export a near-identity transform); the wall/portal/light schema, which is the interop-complete battlemap vocabulary.
- **Implication:** UVTT is *the* export target. Chartdown semantics → UVTT keys is nearly 1:1, and it makes Chartdown maps playable in every VTT with dynamic lighting intact. And since UVTT has no hexes, **there is no interchange format for hex charts at all** — Chartdown could be it.

Sources: [Arkenforge spec](https://arkenforge.com/universal-vtt-files/), [Roll20 announcement](https://blog.roll20.net/posts/page-menu-updates/)

### Foundry VTT scenes

Scene JSON with embedded collections (walls, tokens, lights, tiles, regions, notes); v14 added native multi-floor levels. Richest grid model in the industry: gridless, square, and **four hex variants** (odd/even offset × pointy/flat orientation), with cube coordinates internally. Not hand-written, but heavily *programmatically* authored via its JS API and community import modules — evidence that "build scenes from data" is a real workflow.

- **Steal:** the four-variant hex enum is the interop-complete parameterization — a hex format must pin down orientation *and* offset parity; wall segments carrying separate move/sight/light restrictions show what "semantic walls" means at full fidelity.

Sources: [WallDocument API](https://foundryvtt.com/api/classes/foundry.documents.WallDocument.html), [GRID_TYPES](https://foundryvtt.com/api/v11/enums/foundry.CONST.GRID_TYPES.html)

### Dungeondraft / Wonderdraft

The standard "make a pretty battlemap" tools. Files are JSON but undocumented, unstable across versions, and coupled to installed asset packs — maps aren't portable without the same assets, which is exactly why UVTT export exists. Not practically hand-authorable or diffable.

- **Avoid:** asset-path coupling; content that can't survive outside its birth tool.

### Dungeon Scrawl

Browser-based, free, Roll20-owned. **Geometry-first**: boolean shape operations on dungeon geometry, with style applied at render time — the closest incumbent to Chartdown's "describe structure, render style" philosophy, and proof that attractive stylized output from pure geometry (no art assets) is popular. GUI-only; `.ds` JSON is parseable (a community Foundry importer generates walls from it).

- **Steal:** the geometry/style split as validation of guiding principle 4; its map styles as a rendering-quality bar.

Sources: [dungeonscrawl.com](https://www.dungeonscrawl.com/), [DungeonScrawlImporter](https://github.com/kid2407/DungeonScrawlImporter)

### Mipui

Open-source (MIT, alive as of Feb 2026) collaborative grid editor. Deliberately **symbolic**: no textures; walls, doors, windows, stairs, text live as semantic content on cells and *cell edges*. Its vocabulary is essentially what a grid-dungeon DSL needs, and walls-on-edges vs. walls-as-polylines is a genuine design fork Chartdown must decide.

Sources: [github.com/amishne/mipui](https://github.com/amishne/mipui)

### Hex Kit / Worldographer

The hexcrawl incumbents. Hex Kit: tile-stamping, offset coords from top-left, PNG-only export, dormant since 2019. Worldographer: `.wxx` = gzipped UTF-16 XML, publicly documented — semantic per-hex tuples (terrain type, elevation, flags, seven resource counts), features/labels separate, `hexOrientation` COLUMNS|ROWS, three nested zoom levels, and a per-hex **GM-only flag** (player vs GM knowledge). Semantic data killed as a text format by its container.

- **Steal:** Worldographer's per-hex tuple as a proven hexcrawl vocabulary; the GM-only visibility flag is a genuinely good idea Chartdown should keep in mind (secret annotations that render only in a GM view).

Sources: [Worldographer file format](https://worldographer.com/instructions/file-format/)

### Inkarnate

The artistic mass-market incumbent (~100k-strong community). Cloud-stored scenes over a licensed art library; **no data export at all** — output is a flattened raster. 2025 brought a price-increase revolt and an AI-asset controversy; total lock-in is the community's sore spot.

- **Implication:** don't compete on aesthetics; compete on ownership. "Your map is a text block in your campaign repo" is a differentiator no incumbent can match.

### Owlbear Rodeo

Deliberately minimal browser VTT (image + tokens + fog), huge with in-person/hybrid groups, extension ecosystem since 2023. Its rise is direct evidence that **speed and simplicity beat features** for a large segment — the same segment Chartdown's "five-line map" targets.

Sources: [extensions.owlbear.rodeo](https://extensions.owlbear.rodeo/)

**Cluster summary:** the shared vocabulary across all incumbents is compact and stable — *grid, walls, doors/windows, lights, terrain, features/icons, labels, tokens* — and zero incumbents are text-first or diff-friendly.

---

## 3. Text-native map languages

The viability-critical cluster: has anyone already built this?

### Text Mapper (Alex Schroeder) — the anchor prior art

**Alive**: v1.09 released March 2026 ([src.alexschroeder.ch/text-mapper.git](https://src.alexschroeder.ch/text-mapper.git)); hosted at [campaignwiki.org/text-mapper](https://campaignwiki.org/text-mapper). Perl/Mojolicious, AGPL-3.0. Plain text → SVG since ~2007, one line per hex:

```
0101 tree "tree"
0306 soil keep "The Keep"
0005-0806 trail "The Auld Trail" 30%
```

Broader than commonly known: hex maps, square grids (Traveller sectors), even dungeon rendering (Gridmapper mode), user-definable vocabulary via library files mapping terrain words to SVG (Gnomeyland icons et al.), bundled procedural generators. Its companion **Hex Describe** generates per-hex prose from the same text — demonstrating that a plain-text map format works as an *interchange substrate* for downstream tooling.

**Where it falls short of "Markdown for maps":** not Markdown-embeddable (standalone app/CLI); no formal spec (the language is defined by the Perl implementation); presentational rather than semantic (a terrain word *is* an SVG definition); no battlemap concepts (tokens, furniture, lighting); AGPL + Perl limit embedding and contribution. Adoption is real but confined to the OSR hexcrawl niche.

**Its ports prove the demand for exactly Chartdown's direction:**
- [obsidian-text-mapper](https://github.com/modality/obsidian-text-mapper) (MIT) — Text Mapper syntax in ` ```text-mapper ` fenced blocks. **Literally "Markdown-embeddable Text Mapper" and the closest single competitor to Chartdown's pitch** — and dormant since January 2024, hex-only, single icon set, with no fork taking over.
- [text-mapper.js](https://codeberg.org/devurandom/text-mapper.js) (AGPL, TypeScript) — dormant since November 2023.

### Obsidian ecosystem (what TTRPG users actually do)

The dominant solution is [Obsidian Leaflet](https://github.com/javalent/obsidian-leaflet) — fenced blocks, but the map is an **image drawn elsewhere**, with markers at percent-coordinates; officially in maintenance mode. Newer plugins (Hex Cartographer, Feb 2026; hexmaker; TTRPG Maps) store data in the vault but author via **visual click-to-paint editors** — the text is serialized editor state, not a writable language. The standard workflow across the community is: draw in Dungeondraft/Inkarnate, embed the PNG. **Nobody is describing the map itself in text.**

### The GitHub sweep — negative space

Searches across "battlemap DSL", "dungeon map DSL", "hexmap format", "map markup language", etc. found **nothing** beyond the Text Mapper family. Adjacent non-answers, each instructive:

| Thing | What it is | Why it isn't Chartdown |
|---|---|---|
| [Watabou One Page Dungeon](https://watabou.itch.io/one-page-dungeon) | Beloved generator; JSON export is a de facto interchange format with an active Foundry importer | No published spec; machine geometry, not human-authorable |
| [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) | Very active procedural region-map generator | `.map` is serialized app state; not a description language |
| [Gridmapper](https://github.com/kensanata/gridmapper) (Schroeder) | Dungeon maps saved as text | The text is a keystroke-command log — version-controllable but write-only for humans |
| NetHack `.des` files | Decades-old ASCII map DSL (`MAP…ENDMAP` + declarative features) | Game-internal; proves the pattern's longevity, nothing more |
| [Trizbort](https://trizbort.io) | Interactive-fiction area mapper, XML/YAML files | Room-graph topology only; visual editor |
| [svgbob](https://github.com/ivanceras/svgbob) / ditaa | ASCII art → SVG (svgbob active) | WYSIWYG positioning, no map semantics |
| CTAN [wargame](https://ctan.org/pkg/wargame) / hexboard | Real declarative hex-terrain authoring in LaTeX/TikZ | LaTeX-bound, print-oriented, wargame idioms |
| [Wardley Maps DSL](https://docs.onlinewardleymaps.com/docs/dsl-reference/) | `component Customer [1, 0.4]` — "maps-as-code" de facto standard, VS Code + Obsidian plugins, modernized June 2025 | Not terrain — but it is the **proven playbook**: positional text DSL + editor plugins → niche ownership |
| BattlemapAI / CharGen etc. (2024–26) | Prompt → raster battlemap image | No structured output, no editability — and they make a semantic DSL *more* valuable as a controllable LLM generation target |

---

## 4. Viability verdict

**The niche is partially occupied, and the occupied part is under-maintained.**

1. "Plain text → SVG hex map" is not novel. Text Mapper has done it for ~19 years, still ships, and has a real community. Chartdown must position honestly relative to it — and should treat its line-per-hex ergonomics and user-definable vocabulary as proven ideas worth learning from.
2. The full niche Chartdown targets is claimed by **no one**: Markdown embedding (Text Mapper's only port is 2.5 years dormant), battlemaps (no text language exists at all — the wide-open flank), a formal spec (nobody has one; even Watabou's postponed theirs), semantic modeling (Text Mapper is presentational), multi-map-type coverage in one language (nobody), and a portable dependency-free implementation (nobody).
3. Demand is documented on both sides: unanswered spatial-diagram proposals in Mermaid's tracker, and a TTRPG community whose text-authoring option went dormant without replacement.
4. Strongest competitor: **Text Mapper**. Risks: hexcrawlers saying "this already exists," or a modernized fork appearing. Mitigations: battlemaps first (uncontested), spec-first (uncontested), and potentially *import* of Text Mapper syntax as an onramp.

**Conclusion: the project is viable and the problem is not solved.** The evidence points at a specific strategy — be "the Mermaid of maps," following the Wardley-maps-as-code playbook (own grammar → dependency-free JS renderer → fenced-block plugins → Kroki) with UVTT as the interop bridge into actual play.

---

## 5. Implications for Chartdown

Distilled, cross-cluster, roughly ordered by how much they should constrain design:

1. **Embedding is the product.** Mermaid beat a strictly more powerful PlantUML because a dependency-free JS renderer made fenced blocks free for platforms to adopt. The reference implementation must render ` ```chartdown ` blocks client-side with zero dependencies. (Constrains the Phase 2 stack decision, [#10](https://github.com/Nossimonov/Chartdown/issues/10).)
2. **Native positionality is the differentiator.** Every diagram ecosystem forbids, hides, or upsells explicit positioning; it's their #1 user pain and Chartdown's core competency. Corollary from D2's grid wart: routing *relational* overlays (routes, sight lines) across fixed geometry must be designed early, not retrofitted.
3. **Battlemaps are the wide-open flank; hexes have an incumbent.** No text battlemap language exists; Text Mapper owns text hexmaps. Lead with battlemaps, respect (and possibly import) Text Mapper syntax for hexes.
4. **The semantic vocabulary is known and small:** grid, walls, doors/windows, lights, terrain, features, labels, tokens — with UVTT's wall/portal/light schema as the battlemap fidelity bar and Worldographer's per-hex tuple (plus its GM-only flag) as the hexcrawl one. (Feeds [#7](https://github.com/Nossimonov/Chartdown/issues/7), [#8](https://github.com/Nossimonov/Chartdown/issues/8) and the primitives proposals.)
5. **Coordinates: discrete cell addresses over raw floats.** Every successful positional precedent uses discrete slots; DOT shows bare float coordinates are hostile in text. Use grid-square units (UVTT-compatible floats under the hood), cell/hex addressing on the surface, and for hexes pin down orientation + offset parity explicitly (Foundry's four-variant enum is the interop-complete parameterization). ([#8](https://github.com/Nossimonov/Chartdown/issues/8))
6. **UVTT export makes Chartdown playable everywhere** (every major VTT imports it as of July 2026, Roll20 natively since this month) — and its absence of hex support means Chartdown can *be* the hexcrawl interchange format. Plan UVTT export as an early Phase 3 item.
7. **Copy Mermaid's config architecture** — per-document frontmatter over one modifiable base theme, host-reserved secure keys, `-beta` grammar versioning, first-token dispatch per map type. Avoid PlantUML's styling sprawl. ([#7](https://github.com/Nossimonov/Chartdown/issues/7), [#9](https://github.com/Nossimonov/Chartdown/issues/9))
8. **Spec independent of renderer** (DOT's longevity lesson): third parties should be able to parse Chartdown without our renderer — that's what turns a tool into an interchange format, and Hex Describe shows the downstream-tooling ecosystem a text substrate enables.
9. **Compete on ownership, not aesthetics.** Inkarnate's lock-in backlash and Dungeondraft's asset coupling are the incumbents' sore spot; Dungeon Scrawl proves geometry-first rendering can still look good (and Mipui proves the symbolic model). Target Owlbear Rodeo's audience: the 90-second map in the notes you already have open.
10. **Kroki is the cheapest distribution channel** — one merged renderer yields GitLab, Gitea, Asciidoctor, Sphinx, and more at once; it already hosts niche positional DSLs, so a map language fits its pattern. (Phase 3.)
