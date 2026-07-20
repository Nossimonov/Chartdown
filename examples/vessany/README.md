# Vessany

**Status: aspirational** — not valid under any spec draft; exists to drive syntax design. Fulfills [#5](https://github.com/Nossimonov/Chartdown/issues/5), authored against Elena's region-map narrative in [docs/use-cases.md](../../docs/use-cases.md) §3. This is the acknowledged hard problem: continuous positioning in readable text.

## The map

A 900×600-mile stretch of Elena's continent: the Argen Sea and a ragged coastline to the west, the Serpent's Spine range walling off Khar to the east, the Vess descending from the mountains to Gull Bay, six settlements from capital to village, and a contested realm border along the mountain crest.

## Intended render

An atlas-style physical/political map — the inside-cover map of a fantasy novel. Coastline smoothed organically from the six sketch points (deterministically: same source, same curves, per the additive-stability requirement); mountain ridge rendered as a range along its spine, not a blob; the Vess meandering from its named source region to its named mouth; settlement icons and label weights by tier; the Vessany/Khar border following the crest; sea label sprawling across its area. Compass rose and scale bar on. The **player render** drops the border's `gm` note.

Rough schematic of the layout (not to scale — a sketch of *where things are*, which is all the mock needs to pin):

```
  ~~~~~ │                                          ▲▲
  ~~~~~ │        Thornwood ♣♣♣                    ▲▲▲▲
  ~~~~~  ╲        ♣♣♣♣♣♣♣♣    · Sparrowdown       ▲▲▲▲
  ~~~~~~  │        · Dunmere                     ▲▲▲▲
  ~~~~~~  │              ★ HIGHKEEP            ▲▲▲▲
  ~~~~~~ ╱   · Merrow's Rest    ╲            ≈≈ the Vess
  ~~~ Gull ⌒ Bay                 King's Way ╱   ▲▲▲▲
  ~~~~~ │ · Gull Landing        ∩∩ Vess Downs   ▲▲▲▲
  ~~~~~  ╲ ◉ ARGENPORT                          ▲▲▲▲
  ~~~~~~  │        VESSANY            border ‖   KHAR
```

## What this example asserts (syntax under test)

1. **World-unit coordinates, coarsely** — positions are `(x,y)` in declared map units (miles) from a declared origin, used only where nothing better exists (first placement of major features). Never pixels; precision is never required.
2. **Anchored placement wherever a named thing exists**: `on coast at…`, `on Gull Bay`, `south edge of Thornwood`, `70 mi north of Argenport`, `40 mi east of Highkeep`. Most settlements never state a coordinate — the map is written *in terms of itself*, which is also what makes it skimmable ("Dunmere is at Thornwood's south edge" IS the fact a reader wants).
3. **Sparse organic shapes with renderer-owned finishing**: a 6-point coastline, a 3-point mountain `ridge`, `blob around <point> ~<size>` for forest and hills. The author sketches; the renderer draws — deterministically.
4. **Topological paths by named endpoints**: the Vess runs *from* the Spine *to* Gull Bay; roads connect settlements by name, with `along coast` as a shape hint. (This is where the battlemap example's contested "pseudo-English relations" question gets its strongest pro case — coordinates for these would be strictly worse.)
5. **Realms defined by relation to geography** (`west of the Serpent's Spine`) and a border as a feature-referencing line (`crest of…`) — so the Treaty of Argen is a one-line edit that never touches geometry.
6. **Additive stability by construction**: anchored placements depend only on their named anchors, so adding Sparrowdown moves nothing.
7. **Tier words carry rendering weight**: `capital/city/town/village` decide icon and label prominence; `[labels]` overrides placement only where defaults fail (the sprawling sea label).
8. **Anchors for the wiki**: every named entity (`Highkeep`, `Gull Bay`, `the Vess`) is a crosslink target for Elena's two hundred lore pages ([#11](https://github.com/Nossimonov/Chartdown/issues/11)).

## Requirements traceability

Against Elena's checklist (use-cases §3): gridless human-writable positioning ✓ (coarse world-units + anchored relative — both candidates exercised) · sparse organic areas, deterministic smoothing ✓ · topological paths ✓ · importance tiers ✓ · regions/borders changeable without redrawing geography ✓ · label hierarchy + placement hints ✓ · stable anchors ✓ · additive stability ✓ · scale bar/compass ✓.

## Open questions this example deliberately raises

- **How much pseudo-English is too much?** This example leans hard on relational phrases (`south edge of`, `on coastline at`, `west of`, `crest of`) — the strongest case *for* them, per the battlemap example's contested question. If [#8](https://github.com/Nossimonov/Chartdown/issues/8) rules for a closed relation-keyword set, this file is the corpus to test it against: every phrase here must survive translation into the rigid form without losing skimmability.
- **Anchor-dependency cycles and ordering**: Merrow's Rest is placed relative to Argenport — may entities reference entities declared later? Can chains (`A near B near C`) or cycles form, and what's the error story? ([#8](https://github.com/Nossimonov/Chartdown/issues/8), [#11](https://github.com/Nossimonov/Chartdown/issues/11))
- **Which side is the sea on?** `coastline : from…via…to…` plus `sea : west of coastline` makes land/sea assignment explicit but clumsy. Alternatives: winding-order convention, or coast declared as the boundary of a `sea` area. ([#8](https://github.com/Nossimonov/Chartdown/issues/8))
- **`blob around X ~90 mi`** — the roughness sigil `~` and a size-without-shape; is approximate extent a first-class concept, and does the renderer promise stable output as neighboring features are added? (Determinism requirement vs. layout-engine temptation.)
- **Anchored placement must never silently reflow.** Vague anchors have finite capacity: as the map fills, a renderer tempted to "make room" would shift previously-placed entities — a slowly-revealed map that slowly *changes*, defeating additive stability precisely for the incremental worldbuilder it serves (unless the author had the foresight to plan every placement up front, which is the tool's job, not theirs). Candidate rule for [#8](https://github.com/Nossimonov/Chartdown/issues/8): resolution is deterministic and **order-bounded** — an entity resolves only against entities declared before it, so appending can never move an existing placement — and an exhausted anchor ("no room on Gull Bay") is an author-facing error demanding a refined phrase, never renderer improvisation. The strong form, if order-bounded determinism proves insufficient: bake resolved positions into a lock artifact (resolve once, pin forever, lockfile-style), at the cost of a generated file alongside the source.
- **Are anchors live dependencies or initial-placement sugar?** If Argenport *deliberately* moves, does Merrow's Rest follow (live relationship) or stay (frozen position)? Live anchors honor "the map is written in terms of itself" but magnify the reflow risk above; baked positions kill the risk but mean an anchor phrase can drift from rendered truth. Needs a decision, not a default. ([#8](https://github.com/Nossimonov/Chartdown/issues/8))
