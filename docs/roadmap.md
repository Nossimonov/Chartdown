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

## Phase 4 — Language depth (v0.4)

*Deepen the language where authoring at scale proved it thin.*

Phase 3 delivered the ecosystem surfaces that matter — Obsidian, the GitHub Action, the MCP server, the playground, UVTT export — and the remaining candidates (markdown-it/remark, VS Code preview, community themes) are deliberately parked rather than pursued. Roughly ninety percent of the ecosystem's value is shipped; the marginal tenth is worth less than the language work this phase carries, and the two long authoring exercises behind that judgment are the evidence.

Two agent-authored maps at real scale — Christopher Tolkien's Middle-earth and a full-Moria eight-level mega-dungeon — produced twenty-odd bugs (fixed in 0.3.2 and 0.3.3) and nineteen accepted proposals. Their shape is the phase's shape: the region side was missing *expressiveness* (the language could not say what the map needed), and the battlemap side was missing *rigour* (the toolchain accepted maps that could not be navigated).

The accepted work, in dependency order:

1. **Foundations** — derivation carries word-keyed behaviour ([ADR 0016](decisions/0016-derivation-carries-word-keyed-behaviour.md)); a positive `kind:` discriminator for vocabulary and theme documents; openings in declared terrain, a normative `passes=` value set, and the statement that `earth` is impassable.
2. **Vocabulary and semantics** — declared states with a warning on undeclared; opening states; free text's placement set and ungated `key=`; and the generalization of the vacant `light` archetype into **fields**, so a setting can declare radiation, silence, or antimagic in one line.
3. **Authoring power** — river confluences (`join`), solitary `peak`/`volcano`, organically-finished terrain areas, repeated placement (`every`), multi-level shafts, and validated `detail=` seams.
4. **The safety net** — six coherence lints and dead-declaration warnings, so a map that cannot be navigated says so.
5. **Staged, with review** — staged revelation (secret groups, with the reveal set living on the render rather than in the document), and placed coast/river morphology, whose principle is recorded before its build: **detail is data, not noise**.

**Exit criterion:** the two exercise maps re-author cleanly — every workaround their authors documented is expressible, and every defect their readers caught is either fixed or reported by the toolchain.
