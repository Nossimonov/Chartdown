# Changelog

All notable changes to the Chartdown language and its reference implementation. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) (pre-1.0: minor bumps may break). The language specification and the four `@chartdown` npm packages version together — a version number names a spec+implementation pair.

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Nossimonov/Chartdown/releases/tag/v0.1.0
