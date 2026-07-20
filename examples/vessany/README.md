# Vessany

**Status: aspirational** — placements and relational grammar remain pre-spec; the lexical layer conforms to [spec 01 (document model)](../../docs/spec/01-document-model.md). Spec-01 canonicalization (2026-07-20): commas removed, `~90 mi` → `size=90mi`, `gm "…"` → `gm="…"`, multi-word entity references quoted (`to "Merrow's Rest"` — reference form itself is [#11](https://github.com/Nossimonov/Chartdown/issues/11)-pending), and `coastline` moved above the entities that reference it, demonstrating the order-bounded resolution rule. Fulfills [#5](https://github.com/Nossimonov/Chartdown/issues/5), authored against Elena's region-map narrative in [docs/use-cases.md](../../docs/use-cases.md) §3. This is the acknowledged hard problem: continuous positioning in readable text.

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

- ~~How much pseudo-English is too much?~~ — **resolved by [spec 02](../../docs/spec/02-coordinates-and-grids.md) §7** (via [#14](https://github.com/Nossimonov/Chartdown/issues/14)): a closed nine-form relational grammar over the keyword set `at/on/near/of/from/via/to/along/edge`. This file survived translation nearly unchanged; the casualty was `crest of` (vocabulary masquerading as grammar) → `along "The Serpent's Spine"`.
- ~~Anchor-dependency cycles and ordering~~ — **resolved by [spec 02](../../docs/spec/02-coordinates-and-grids.md) §8 and [spec 03](../../docs/spec/03-identity-and-links.md) §2**: forward references are errors (order-bounded), so cycles cannot form; chains are legal and resolve in document order; misses and ambiguous names are fail-loud errors. This file now demonstrates both reference forms — quoted display names for the simple cases, an explicit id where prose links (`capital highkeep "Highkeep" : … link="lore/highkeep.md"`, referenced as `east of highkeep`).
- ~~Which side is the sea on?~~ — **resolved by [spec 05](../../docs/spec/05-map-primitives.md) §2** (via [#17](https://github.com/Nossimonov/Chartdown/issues/17)): this file's pattern is the blessed one. Water areas are ordinary terrain placed with the half-plane form, clipped to the coastline path; the sea is on whichever side the author says. Winding-order conventions were rejected.
- ~~`blob` roughness and stability~~ — **resolved by spec 02 §9/§1**: `blob <point> size=<measure>` is a first-class sketch shape; organic finishing is deterministic and seeded (`seed:` header), so neighboring additions never perturb it.
- ~~Anchored placement must never silently reflow~~ / ~~live vs. frozen anchors~~ — **resolved by [spec 02](../../docs/spec/02-coordinates-and-grids.md) §8** (via [#14](https://github.com/Nossimonov/Chartdown/issues/14) as amended): resolution is order-bounded, deterministic (seeded), and fail-loud (exhausted anchors error; renderers never relocate); anchors are **live**, so deliberate upstream edits ripple by design, with the **remnant landmark** pattern (leave `ruin "Former site of X"` behind, anchor dependents to it) as the documented mitigation for moved/destroyed anchors. The lockfile bake is deferred, not rejected.
