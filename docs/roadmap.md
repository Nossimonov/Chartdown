# Roadmap

Phases map 1:1 to GitHub milestones. Every work item is a GitHub issue attached to its milestone; this document describes the shape of the work, the issues carry the detail and status. A phase is done when its exit criterion is met, not when its issues happen to be closed.

## Phase 0 — Foundation

*Understand the problem space before inventing syntax.*

- Survey prior art: Mermaid/Kroki (embedding model), existing map DSLs, hex-map tools, Universal VTT format, roguelike ASCII maps, SVG/TikZ as baselines.
- Write concrete use-case narratives for the three target map types (region map, hex chart, battlemap).
- Author aspirational examples in [examples/](../examples/) — the documents we *wish* were valid Chartdown — before any grammar exists.
- Choose a license.

**Exit criterion:** we can point at a folder of aspirational examples and say "when these render, v0.1 is done."

## Phase 1 — Specification v0.1

*Design the language, example-first, one proposal at a time.*

- Document model: standalone file vs. fenced block, header/metadata, sections, comments.
- Coordinate systems and grids: square grids, hex grids (orientation, offset vs. axial), gridless positioning for region maps.
- Map primitives: terrain areas, paths (rivers, roads, walls), points of interest, regions and borders.
- Battlemap primitives: tokens, walls/doors, elevation, difficult terrain.
- Labels, legends, scale indicators.
- Entity identity and anchors: how named map entities are addressed, so Markdown prose can crosslink to map locations (and renderers can link back).
- Styling/theming model: how appearance is separated from content.

Each of these lands as one or more **syntax proposal issues** (see [CONTRIBUTING.md](../CONTRIBUTING.md#syntax-proposals)), is decided in an ADR when contentious, and is merged into [docs/spec/](spec/) when accepted.

**Exit criterion:** every aspirational example from Phase 0 is either valid under the draft spec or consciously rewritten, and the spec is coherent enough to implement.

## Phase 2 — Reference implementation

*Prove the spec by building it.*

- Choose the implementation stack (ADR required — likely TypeScript for embeddability, but that's a decision, not a default).
- Parser producing a documented AST, with the spec's examples as its test corpus.
- SVG renderer: deterministic output, at least one default theme.
- A way to actually use it: CLI (`chartdown map.cd -o map.svg`) and/or a browser playground.

**Exit criterion:** every example in the spec renders correctly; a stranger can go from `git clone` to a rendered map in ten minutes.

## Phase 3 — Ecosystem (post-v0.1)

*Meet users where they already write.*

Candidates, deliberately unscoped until Phase 2 ships: markdown-it/remark plugin, Obsidian plugin, VS Code preview, static-site integration, VTT export (Universal VTT), community themes. Each gets scoped by issues when we get there.
