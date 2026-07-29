# Changelog

All notable changes to the Chartdown language and its reference implementation. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) (pre-1.0: minor bumps may break). The language specification and the four `@chartdown` npm packages version together — a version number names a spec+implementation pair.

## [Unreleased]

## [0.4.0] — 2026-07-29

### Changed

- **BREAKING — a staging zone has one spelling** ([ADR 0015](docs/decisions/0015-one-staging-zone-spelling.md), #121): the word `start` (or anything deriving from it) with an area placement — `start party : J14..L15`. Spec 06 §4's inference rule ("a token-archetype word with an area placement renders as a staging zone") is removed, and a token word carrying an area is now a fail-loud error naming both fixes. Previously the same picture came from two spellings with **different theme subjects**: in `party start : …` the type word is `party`, so `start : fill=` styled nothing — a trap that caught a reader of that very section. The three example lines migrate; the rendered zone label changes from `start` to `party`. Because it breaks, this ships in 0.4, never a patch.

## [0.3.3] — 2026-07-25

Mostly the conformance half of the #93–#115 batch review: everywhere the implementation didn't do what the spec already said. Found by two authoring-at-scale exercises — a Middle-earth region map and a full-Moria eight-level mega-dungeon — plus the release-plumbing and co-authoring work from the same cycle.

### Fixed

- **One vocabulary chain, walked once.** A derivation living in a `use:`-imported library did not inherit its base word's theme entry, though the identical derivation written in an in-document `[vocab]` did — the renderer rebuilt its vocabulary table from the AST, which carried only the document's own entries. The document now carries its imported vocabulary, so themes resolve through spec 04 §2's one shadowing order. This defeated exactly the configuration spec 04 §2 calls "the shareable/publishable surface," and it failed silently. (#101)
- **Derived openings are openings.** Opening appearance was matched against the literal words `door`/`gate`/`window`, so `portal : door` — or anything bound straight to the `opening` archetype — fell through to a fallback that drew it *in the wall's own ink, at the wall's own weight, on top of the wall*. Every non-stdlib door was invisible; a Moria map with 88 archways rendered as unbroken stone. Appearance now resolves through the vocabulary chain and openings are recognized by archetype. (#103)
- **Walls gap at openings.** A structure's perimeter was drawn straight across its openings with the door mark painted over it, so the render disagreed with spec 06 §9's normative UVTT export, which subtracts every opening edge. An arch is a hole, and now draws as one. (#103)
- **Four archetypes ignored the theme entirely.** `opening`, `barrier`, `path`, and `zone` draw code carried hardcoded colours and never consulted `[theme]` — `wall`, `door`, and `pillar`, the interop-critical triad of spec 06 §2, could not be restyled at all. The built-in values now live in the default theme document like every other palette entry (no privileged styling path), and all nine archetypes resolve through one lookup. (#105)
- **Free text renders as text alone.** A `note` drew a generic feature marker beside its text at point placements, so every caption asserted there was a thing at that spot. Spec 07 §2 already said its "rendering *is* its text"; it now is, at every placement form, with `sprawl` letter-spaced so it differs from a bare range. A placement the renderer draws nothing for now warns instead of vanishing silently. Spec 07 §2 states the no-marker rule normatively and points authors at named entities for the pin case. (#104, #107)
- **Water wins every overlap.** Massifs and terrain patches painted *over* the sea, so a range meeting the coast floated on open water and a gulf could not cut one named range in two. Terrain of every kind is now clipped to the land side; islands stay land above their sea. Spec 05 §2's guarantee is generalized from zonal terrain to terrain generally. (#98)
- **Structure perimeters are theme subjects.** Room outlines — the most visually defining element on a battlemap — were drawn in literal ink at a literal weight by a path that consulted no theme at all, so a theme could restyle the paper, terrain, props, doors and freestanding walls and then outline every room in the same brown. They now take `stroke=`, `width=` and `dash=` from the structure's own word, through derivation and `word.state`. Found re-testing 0.3.3 at a call site the #105 reproduction never reached. (#117)
- **A bare `ruined` ruins every side.** `ruined` is a declared state of `building` (spec 06 §2), but structures honoured it only as a detail line selecting sides (`ruined : north`) — the flag form drew intact walls, while freestanding barriers had always honoured it. (found alongside #117)
- **`glyph=` and `fill=` compose.** A themed glyph was emitted `fill="none"` with hardcoded ink, so a themer chose the shape *or* the colour, never both — spec 08 §3 lists them as independent members of one closed set. Point-placed barriers also skipped the glyph lookup entirely, so a `pillar` could not take a column symbol though every other point-placed entity could. (#119)
- **`check` surfaces render-side warnings.** The #104 diagnostic lived in the renderer, so the command authors and CI actually run still reported `ok` for a document containing a line that renders nothing. `check` now renders a map (GM mode, output discarded) and merges those diagnostics — the general rule being that every diagnostic a renderer can emit must be reachable from `check`, or authors and CI see different documents. (#120)
- **`check` validates all three document kinds.** Vocabulary and theme documents need no `map:` (spec 04 §2, spec 08 §1), but `check` validated everything against the map rules — reporting a missing `map:` and then discarding a 126-line theme as unknown sections. Two of the three kinds had no validation path, so a misspelled appearance property or a typo'd derivation base was discovered by the map looking wrong. Kind is now inferred from the sections present (the durable fix is #110's `kind:` discriminator), in the CLI and the MCP server alike. (#102)

- The spec digest — served publicly as `llms-full.txt` — and `grammar.ebnf` still titled themselves "spec draft v0.1", misinforming every LLM that bootstraps from them; the grammar also claimed sections 01–07 while covering 08. Headers now state the real version, and a core test locks both artifacts to `SPEC_VERSION` so they can never drift again. Owner-caught.
- The digest's "Header keys" list omitted `map:` (the one REQUIRED key — present in the skeleton snippet, invisible in the list an agent scans), plus `levels:` and `level:`. User-caught (#99). The list is now complete, and a core test asserts every `KNOWN_HEADER_KEYS` entry appears in it — a future header key can't ship without its digest line.
- **Releasing is one command** (#90): `npm run bump -- x.y.z` rewrites every version surface — the six package.json files, render-svg's pin on core, `SPEC_VERSION`, the digest/grammar/spec-README headers — and rolls the `[Unreleased]` changelog into the new section with compare links. The core consistency test derives the expected version from the packages and asserts *every* surface agrees, so a surface that escapes the command fails `npm test` instead of shipping (the failure mode behind both the 0.3.1 fix and the digest-header fix above). The right way is now the easy way.

### Changed

- Obsidian: each map's toolbar gains the round-trip pair (#88; replaces an unreleased primer-button design after owner review). **Copy Chartdown** leads the copied text with `;` comment lines naming the language and pointing at the public reference (`llms-full.txt`), so a paste into an LLM chat self-identifies without the plugin bundling a spec or pushing AI at anyone. **Paste Chartdown** brings a reply back: accepts bare Chartdown or a ` ```chartdown ` fence, strips a returning breadcrumb, **validates before writing** — an invalid paste changes nothing and names the offending line; the button grays out while the clipboard is empty (format metadata only — content is read exactly once, on an explicit paste click). The store README now presents the co-writing workflow and how to bootstrap an assistant (paste `llms-full.txt`, or `@chartdown/mcp` for tool-using agents).

## [0.3.2] — 2026-07-22

Fixes found by an agent stretching the tool's legs on old campaign notes (#78, #79).

### Fixed

- **Tooltips escape user text** (#79): every `<title>` path now escapes display names, `gm=` notes, and fallback type words — a room named `Treasury & Accounting` produced invalid XML that GitHub refused to display, while the visible label beside it escaped correctly. Spec 02 §8 gains the rule this enforces (renderers MUST emit well-formed markup for every valid document, whatever characters user text contains), and the test suite now XML-parses every example render in both modes with a strict parser to keep it true.

### Added

- **Output provenance and orphan cleanup** ([ADR 0014](docs/decisions/0014-provenance-gated-cleanup.md), #78): every SVG the Action writes carries a `<metadata>` marker naming its source, docId, mode, and the output path it was written to — no timestamps or versions, so re-renders stay byte-identical — and the artifact declares itself generated. The Action's new `clean:` input (`warn` default | `true` | `false`) removes **marker-confirmed orphans only** (renamed docs, deleted fences, mode changes) under a three-condition test that can never touch a hand-made SVG or a deliberately kept copy; `verify` mode fails on orphans like any other drift. `stampProvenance`/`readProvenance` export from `@chartdown/render-svg`. The first marker-aware run restamps every output once.

## [0.3.1] — 2026-07-22

### Fixed

- The parser's `SPEC_VERSION` still said `0.1`, so a document honestly declaring `chartdown: 0.3` drew a spurious "this parser implements 0.1" warning — it now tracks the released spec version (the spec and packages version together), and per spec 01 the warning fires only for documents targeting a spec **newer** than the parser, not for older documents, which are the parser's own history. Example pins corrected to the versions their syntax actually requires (Sundered Reach and Vessany `0.3`, Fairwater Manor and the Gilded Tankard `0.2`). Owner-caught.

## [0.3.0] — 2026-07-22

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

[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Nossimonov/Chartdown/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/Nossimonov/Chartdown/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Nossimonov/Chartdown/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Nossimonov/Chartdown/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Nossimonov/Chartdown/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Nossimonov/Chartdown/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Nossimonov/Chartdown/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Nossimonov/Chartdown/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nossimonov/Chartdown/releases/tag/v0.1.0
