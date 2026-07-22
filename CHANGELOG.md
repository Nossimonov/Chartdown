# Changelog

All notable changes to the Chartdown language and its reference implementation. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) (pre-1.0: minor bumps may break). The language specification and the four `@chartdown` npm packages version together — a version number names a spec+implementation pair.

## [Unreleased]

### Changed

- Glyphless words tint **deterministically by their base word** (golden-angle hues, parchment-muted; theme `fill=` overrides): table and barrel — and every unknown word a scene will ever hold — stop being the same grey square, on the map and matched in the legend. (#71)

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

[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/Nossimonov/Chartdown/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Nossimonov/Chartdown/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Nossimonov/Chartdown/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nossimonov/Chartdown/releases/tag/v0.1.0
