# Architecture Decision Records

A contentious decision that closes off alternatives — syntax choices, technology choices, scope cuts — is recorded here before its issue is closed. See [CONTRIBUTING.md](../../CONTRIBUTING.md#adrs-architecture-decision-records) for the rules.

- Files are numbered sequentially: `0001-<slug>.md`, `0002-<slug>.md`, …
- **The number is claimed on merge, not on draft** — take the next free one while writing, and if a concurrent branch took it too, whoever merges second renumbers. The index table below is what makes that collision surface as a git conflict rather than as two files sharing a number.
- Copy [0000-template.md](0000-template.md) to start a new one.
- **Immutable once it reaches `preview`**, not once the header says Accepted: before that it is a draft and errors are fixed in place; after it, a change of mind is a new ADR that marks the old one **Superseded**, linking both ways.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-mit-code-cc-by-spec.md) | Code is MIT; the specification is CC-BY-4.0 | Accepted |
| [0002](0002-document-model-lexical-layer.md) | One line grammar, `;` comments, `key=value` properties; embedded and standalone documents are identical | Accepted |
| [0003](0003-coordinates-and-placement.md) | Chess-style addresses on every grid; a closed relational grammar; live, order-bounded, fail-loud anchor resolution | Accepted |
| [0004](0004-identity-and-references.md) | Explicit ids and display names are both reference keys; anonymous entities are unreferenceable; resolution is fail-loud | Accepted |
| [0005](0005-open-vocabulary-archetypes.md) | The language knows no nouns: closed archetypes, open vocabulary, usage inference, theme-owned appearance | Accepted |
| [0006](0006-battlemap-primitives-decisions.md) | No bestiary; elevation as emergent terraces; orthogonal footprints with renderer smoothing | Accepted |
| [0007](0007-typescript-stack.md) | The reference implementation is TypeScript | Accepted |
| [0008](0008-open-structures-declared.md) | Unroofed structures are declared with the `open` flag, not derived from the level stack | Accepted |
| [0009](0009-relative-placement-referent-frames.md) | Relative placement rides `on … at`: the `at` payload is interpreted in the referent's frame | Accepted |
| [0010](0010-uvtt-export-caller-raster.md) | UVTT export lives in the renderer and the caller supplies the raster | Accepted |
| [0011](0011-mcp-server-runtime-deps.md) | `@chartdown/mcp` carries runtime dependencies; the zero-dep rule binds the language core | Accepted |
| [0012](0012-borders-are-relationships.md) | Borders are relationships with states; realm edges may follow features | Accepted |
| [0013](0013-terrain-kinds-aspect-adaptation.md) | Terrain comes in kinds (patches, belts, zones); references adapt by aspect, never by guess | Accepted |
| [0014](0014-provenance-gated-cleanup.md) | Generated SVGs carry a provenance marker; cleanup is gated on it, never on inference | Accepted |
| [0015](0015-one-staging-zone-spelling.md) | A staging zone has one spelling: the word `start` | Accepted |
| [0016](0016-derivation-carries-word-keyed-behaviour.md) | Derivation carries behaviour attached to a standard-library word | Accepted |
| [0017](0017-openings-perforate-terrain.md) | Openings may perforate declared terrain; `passes=` is a closed value set | Accepted |
| [0018](0018-fields-generalize-light.md) | Ambient conditions are content; the vacant `light` archetype becomes `field` | Accepted |
| [0019](0019-line-labels-claim-before-point-labels.md) | Line labels claim before point labels — leaders gave points a way to move that lines lack | Accepted |
| [0020](0020-render-resolution-is-editorial.md) | Render resolution is an author choice (`detail: overview\|reference`), not a fixed canvas | Accepted |
| [0021](0021-a-map-is-the-sum-of-its-files.md) | A map is the sum of its files; cross-document references are in scope, and validated in both directions | Accepted |
| [0022](0022-a-declaration-is-a-promise.md) | A declaration is a promise; the file that made it for this map is the one that is checked | Accepted |
| [0023](0023-detail-is-data-not-noise.md) | Detail is data, not noise: anything a story can attach to must be declared | Accepted |
| [0024](0024-a-feature-takes-its-bearing-from-the-water-it-sits-in.md) | A detached feature takes its bearing from the water it sits in, read from that water's own declaration | Accepted |
| [0025](0025-a-blob-declares-an-extent-not-an-outline.md) | A blob declares an extent, not an outline; finishing is texture and may never decide a dimension | Accepted |
| [0026](0026-shape-is-declared-data.md) | A feature's shape is declared data: an outline for what is detached, a centerline for what deforms | Accepted |
| [0027](0027-an-island-is-separate-or-it-is-a-peninsula.md) | An island is separate, or it is a peninsula; a welded island is reported, never repaired | Accepted |
| [0028](0028-measurement-is-an-optional-package-in-typescript.md) | Measurement is an optional TypeScript package, not a second language | Accepted |
| [0029](0029-a-shipped-dependency-is-ours-to-answer-for.md) | A shipped dependency is ours to answer for: built-ins before dependencies, shipped code audited in CI | Accepted |
| [0030](0030-a-centerline-carries-its-own-width.md) | A centerline carries its own width: `via (x,y)@1.5mi`, so a channel may widen and narrow | Accepted |
| [0031](0031-a-bank-the-document-did-not-choose.md) | A bank the document did not choose is refused, not picked: an arm on its host's centerline names the ambiguity | Accepted |
| [0032](0032-a-measurement-emits-a-line-that-draws.md) | A measurement emits a line that draws, and checks it the way the renderer will | Accepted |
| [0033](0033-width-is-a-cross-section.md) | A channel's width is its cross-section, square to the centerline | Accepted |
| [0034](0034-a-border-lies-on-one-side-of-its-line.md) | A border lies on one side of its line, and is clipped to the region that owns it | Accepted |
| [0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md) | A channel too narrow to see is drawn as a symbol, at a floor in viewport units | Accepted |
| [0036](0036-a-measurement-reports-what-it-removed.md) | A measurement reports what it consumed, not only what it produced | Accepted |
| [0037](0037-geometry-is-in-map-units-ink-is-in-canvas-units.md) | Geometry is in map units, ink is in canvas units; a shape may not depend on `extent:` | Accepted |
| [0038](0038-a-placement-form-means-the-same-thing-on-every-map-kind.md) | A placement form means the same thing on every map kind: the half-plane places battlemap terrain, ink to the centerline and cells by their centres | Accepted |
| [0039](0039-an-archetype-name-is-grammar-not-a-type-word.md) | An archetype name is grammar, not a type word: using one as a type word is an error | Accepted |
| [0040](0040-ink-holds-its-device-width-while-zoomed.md) | Ink holds its device width while zoomed; a measured stroke scales | Accepted |
| [0041](0041-breaking-means-a-clean-document-stops-checking-clean.md) | Breaking means a clean document stops checking clean; breaking work rides `preview` | Accepted |
| [0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md) | Everything a field draws is clipped to the map field of its own panel | Accepted |
| [0043](0043-an-address-form-a-slot-cannot-consume-is-refused.md) | An address form a slot cannot consume is refused, never quietly reinterpreted | Accepted |
| [0044](0044-where-courses-meet-they-merge.md) | Where courses meet, they merge: a joining end stops in the water, and no bank is drawn over water | Accepted |
| [0045](0045-a-redaction-is-not-the-document.md) | A redaction is not the document: coherence lints read what was declared, in every mode | Accepted |
| [0046](0046-a-landing-is-suppressed-by-a-declaration-not-by-a-drawing.md) | A landing is suppressed by a declaration, not by a drawing: the far end yields to what the document said | Accepted |
| [0047](0047-a-document-path-is-a-token.md) | A document path is a token: quoting protects its spaces, and the quotes are not part of the path | Accepted |
| [0048](0048-an-annotation-names-the-nearest-landing-of-its-own-flight.md) | An annotation names the nearest landing of its own flight, on every panel | Accepted |
| [0049](0049-a-cell-address-on-a-gridless-map-is-refused-not-dropped.md) | A cell address on a gridless map is refused, not dropped; a grid-only header key that has nothing to do warns | Accepted |
| [0050](0050-a-pool-that-fills-its-field-is-reported-not-redrawn.md) | A pool that fills its whole map field is reported, not redrawn | Accepted |
| [0051](0051-the-renderers-answer-is-data-before-it-is-ink.md) | The renderer's answer is data before it is ink: `resolveScene` exports resolved geometry in map units, and `render` consumes the same pass | Accepted |
| [0052](0052-a-stair-is-a-way-in.md) | A stair is a way in: `stairs` and `ramp` become load-bearing words, so a single-level room entered by its stair checks clean | Accepted |
