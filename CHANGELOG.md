# Changelog

All notable changes to the Chartdown language and its reference implementation. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) (pre-1.0: minor bumps may break). The language specification and the four `@chartdown` npm packages version together — a version number names a spec+implementation pair.

## [Unreleased]

## [0.3.1] — 2026-07-23

### Fixed

- The parser's `SPEC_VERSION` still said `0.1`, so a document honestly declaring `chartdown: 0.3` drew a spurious "this parser implements 0.1" warning — it now tracks the released spec version (the spec and packages version together), and per spec 01 the warning fires only for documents targeting a spec **newer** than the parser, not for older documents, which are the parser's own history. Example pins corrected to the versions their syntax actually requires (Sundered Reach and Vessany `0.3`, Fairwater Manor and the Gilded Tankard `0.2`). Owner-caught.

## [0.3.0] — 2026-07-23

The region-map release, forced out line by line by [the Sundered Reach](examples/sundered-reach/) — a two-continent stress test reviewed by its owner across twenty-plus rounds until the map earned `spec-aligned` status.

### Added

- **Borders are relationships** (spec 05 §2, [ADR 0012](docs/decisions/0012-borders-are-relationships.md), #81): realm `area` boundaries may **follow features** — `along <ref>` between two vertices traces the feature's curve (a ridge, a coastline), so moving the feature moves the border. `border` leaves the path family and attaches a **state** to a stretch of one realm's boundary: blanket frontier, facing word (outward normal, eight sectors, open edges only; `inner` for bay shores), `along <ref>`, or two-realm sugar for the shared abutting stretch — most specific wins. States are open vocabulary; overlapping realm claims are legal (a disputed march); stated seams render as an atlas band with dash-dot, default boundaries the same dash-dot lighter.
- **Terrain kinds** (spec 02 §9, 03 §2, 05 §2, [ADR 0013](docs/decisions/0013-terrain-kinds-aspect-adaptation.md), #82): terrain is patches (`blob`/`area`), belts (`ridge <points> width=<measure>` — a variable-width massif with peak marks, tapering to tips, merging where ranges overlap), or **zones** — climatic terrain defined by a frontier, declared as an area following the frontier and the coasts (continent-scoped) or a half-plane (map-wide). Zonal frontiers render as dotted lines in the zone's tint. `ground: <terrain-word>` names what unmarked land is. Mountain crest and extent coexist on one entity (`ridge (…) area (…)`) — refinement is additive, and references always mean the crest.
- **Aspect adaptation** (spec 03 §2, ADR 0013): a reference names the *thing*, not its geometry class — line-needing forms take the polyline else the area boundary; point-needing take point → midpoint → centroid; area-needing take polygon → belt. Never guesses between multiple meaningful lines: `along` a crestless area fails loud, disambiguated by `along <compass> edge of <ref>`.
- **Dense-map label conduct** (spec 07 §5, #73): placement claims run in priority order — author overrides, point markers (proximity IS their meaning; capitals before minor features), curve labels, area names, realm/sea sprawls — while paint stacks the reverse. Labels **shrink before migrating** (size floor, then tracking), are **omitted rather than drawn over other text**, and a split sprawl name **repeats once per clear stretch** of its water, centered and sized to the room it actually has.

### Changed

- Glyphless words tint **deterministically by their base word** (golden-angle hues, parchment-muted; theme `fill=` overrides): table and barrel — and every unknown word a scene will ever hold — stop being the same grey square, on the map and matched in the legend. (#71)
- **Nations tint by name**: every realm gets its own deterministic color (the #71 principle at entity grain), with boundary dashes to match — six nations, six tints, one glance.
- Region label placement grew a body of cartographic judgment: curve labels prefer straight stretches and the outside of bends (over-bent names set straight instead of mushing), roads dodge area names (never the reverse), mountain names sit ON their massif region-style, realm and zone names stay inside their own territory, and settlement type steps down so capitals stop rivaling the map title.

### Fixed

- Polygon seas bound by coastline curves (two continents can exist, #76); islands render as land; water→realms→terrain paint order; half-planes span the full map beyond their frontier; phantom label claim boxes; `text-anchor` always written (SVG defaults to start); diagonal label collision gaps; fitLabel prefers size over tracking.

## [0.2.2] — 2026-07-22

### Added

- **GitHub Action** ([`Nossimonov/chartdown-action@v1`](https://github.com/Nossimonov/chartdown-action)): renders `.cd` files and ` ```chartdown ` fences in Markdown to SVGs committed beside them — campaign repos show maps natively on GitHub. `verify` mode diffs instead of writing; this repo dogfoods it in CI to guarantee committed example SVGs never drift from sources.
- **`labels: keyed`** (spec 07 §3): numbered markers with a module-style key list in the legend band; `key=<n>` pins survive insertions; duplicate pins fail loud. (#65)

### Changed

- Campfire-family glyphs sized to be seen, with a flame lick; standalone stairs gain an ascent chevron, turnable with `facing=` (#66, agent verification feedback).

## [0.2.1] — 2026-07-22

### Fixed

- Freestanding `wall`/`fence` edge runs and `pillar` cells now render (they always blocked light; now they're visible — #62, found by an agent dogfooding the MCP server)
- Vocabulary facet defaults are honored: a bare `campfire` glows at its stdlib `light=20ft`, and derived words (`hearth : campfire`) keep their base's glyph and light on both cell and footprint placements; footprint `stairs` show treads (#64)
- `legend: on` renders the spec 07 §4 generated legend — terrain swatches, path/barrier styles, feature glyphs from the words actually used (#63)

### Added

- **`@chartdown/mcp`** — MCP server giving agents the full authoring loop: `chartdown_spec` (the digest), `chartdown_check` (fail-loud validation citing spec sections), `chartdown_render` (PNG image by default via pure-WASM rasterization with a vendored font — no browser, no native binaries; SVG on request), `chartdown_uvtt` (VTT geometry). ADR 0011 records the runtime-dependency boundary.
- **LLM discoverability**: the site serves [`/llms.txt`](https://nossimonov.github.io/Chartdown/llms.txt) and [`/llms-full.txt`](https://nossimonov.github.io/Chartdown/llms-full.txt) (the spec digest verbatim); `@chartdown/core` ships `digest.md` inside the tarball; READMEs signpost the agent bootstrap path.

## [0.2.0] — 2026-07-21

### Added

- **Irregular room shapes**: cell-union structure footprints (`building : K5..M8 K9..K12`) now render with a fully derived perimeter — L-shapes, notches, and reentrant corners get correct walls, light, coincident-wall and opening semantics, UVTT `line_of_sight`, and room labels that stay inside the bent room. `ruined` side words select perimeter edges by facing. The manor's kitchen gained a scullery corner to show it off.
- **UVTT export** (`exportUvtt` / `exportUvttSource` in `@chartdown/render-svg`): battlemaps export to Universal VTT one file per level — walls minus opening edges → `line_of_sight`, openings → `portals` (closed per the `passes` facet; a window is a los hole plus a shut portal), `light=` → `lights`, grid → `resolution`. Geometry shared with the light engine so export can never disagree with the render; the caller supplies the raster image (ADR 0010). Player-mode exports carry no secrets.
- **Obsidian plugin** (in-repo at `packages/obsidian`; community-store submission pending): chartdown fences render in place with a per-map toolbar — GM/player toggle, SVG export, UVTT export with the image rasterized in-app. Exports land next to the note, name their path, and reveal in the system file explorer.

### Changed

- Spec 06 §9 (UVTT export) is now **normative**, upgraded from the original non-normative mapping note.

## [0.1.0] — 2026-07-21

The first public release: the Chartdown language v0.1 and its reference implementation, published to npm as [`@chartdown/core`](https://www.npmjs.com/package/@chartdown/core), [`@chartdown/render-svg`](https://www.npmjs.com/package/@chartdown/render-svg), [`@chartdown/cli`](https://www.npmjs.com/package/@chartdown/cli), and [`@chartdown/browser`](https://www.npmjs.com/package/@chartdown/browser).

### Language

- Three map types: `battlemap` (square/hex grids), `hexcrawl` (ledger-style exploration logs), and `region` (gridless, organic finishing) — [spec 01–08](docs/spec/)
- One line grammar (`subject : predicate`), chess-style addresses on every grid, and a closed nine-form relational grammar with order-bounded, deterministic, fail-loud, live anchor resolution
- Open vocabulary over nine closed archetypes: unknown words never fail; themes own all appearance; no bestiary by design
- Battlemap depth: structure details (walls, doors, windows) with light and sight semantics; derived crossings (`ford : on river on road`); elevation with emergent ledges and `drop` fall edges; multi-level structures (`levels:`, connectors with `to=`, per-level surfaces `earth`/`air`/`roof`/`terrace`); `open` structures (walls without a ceiling); feature footprints as range placements; room-relative placement (`table : on kitchen at C2..D2`)
- The GM/player split: `hidden`, `gm=`, and `[gm]` strip fail-closed from player renders
- Themes are Chartdown documents (`[theme]`/`[glyphs]`), layered and shadowed
- Labels: `labels: names|keyed|none`, label overrides, battlemap word-labels as tooltips

### Implementation

- `@chartdown/core` — parser and AST, zero runtime dependencies
- `@chartdown/render-svg` — deterministic seeded SVG renderer (same input + seed → byte-identical output)
- `@chartdown/cli` — `chartdown render` / `chartdown check`, self-contained bundle
- `@chartdown/browser` — one script tag renders ` ```chartdown ` fenced blocks in place
- The [playground](https://nossimonov.github.io/Chartdown/) — fully client-side editing, level switcher, share links

[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/Nossimonov/Chartdown/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Nossimonov/Chartdown/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Nossimonov/Chartdown/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Nossimonov/Chartdown/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Nossimonov/Chartdown/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nossimonov/Chartdown/releases/tag/v0.1.0
