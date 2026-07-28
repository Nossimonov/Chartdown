# Architecture Decision Records

Every decision that closes off alternatives — syntax choices, technology choices, scope cuts — is recorded here before its issue is closed. See [CONTRIBUTING.md](../../CONTRIBUTING.md#adrs-architecture-decision-records) for the rules.

- Files are numbered sequentially: `0001-<slug>.md`, `0002-<slug>.md`, …
- Copy [0000-template.md](0000-template.md) to start a new one.
- ADRs are immutable once **Accepted**. To reverse a decision, write a new ADR that marks the old one **Superseded** and links both ways.

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
