# The Brenmark

**Status: spec-aligned** — valid under spec draft v0.1 (sections 01–07), including the sanctioned `[hexes]` ledger shorthand. Spec-01 canonicalization (2026-07-20): `(difficult)` → `difficult`, `gm "…"` → `gm="…"`. Spec-02 canonicalization (2026-07-20): digit-pair addresses re-rendered to unified chess-style (`0203` → `B3`). Fulfills [#4](https://github.com/Nossimonov/Chartdown/issues/4), authored against Marcus's hexcrawl narrative in [docs/use-cases.md](../../docs/use-cases.md) §2.

## The chart

A 8×9 chart of six-mile hexes, partially explored: a coastal strip, the settled Duchy of Bren in the east, the Old Trade Road threading between them, and the river Bren descending from the mountains to the sea. Rows 5–9 inland are unmentioned — and therefore unexplored.

## Intended render

Classic wargame-style hex chart: terrain icon per hex, hex numbers on, settlement icons scaled by tier, road and river threading hex centers, the Duchy's border drawn around its hex set, and a legend generated from the terrain types actually used. **Unmentioned hexes render blank/fogged** — the chart visibly has an edge of the known world. The **player render** drops every trailing `gm "…"` note.

ASCII mock (two characters per hex — terrain, then feature; `··` = unexplored; even columns are the offset ones):

```
      A   B   C   D   E   F   G   H
 1    ~~  ~~  h·  hR  m·  m·  ··  ··
 2      ~~  pV  pT  p·  hD  m·  m?
 3    ~~  p·  p·  f·  fK  h·  ··  ··
 4      ~~  pM  f·  fL  f·  pC  ··
 5    ~~  ··  ··  ··  ··  ··  ··  ··
 6      ~~  ··  ··  ··  ··  ··  ··
 7    ~~  ··  ··  ··  ··  ··  ··  ··
 8      ~~  ··  ··  ··  ··  ··  ··
 9    ~~  ··  ··  ··  ··  ··  ··  ··
```

`~` sea · `p` plains · `h` hills · `f` forest · `m` mountains · `pM` marsh · `m?` seen (terrain visible, contents hidden) · features: `V` village, `T` town, `C` city, `R` ruin, `D` dungeon, `K` keep, `L` lair (GM render only)

## What this example asserts (syntax under test)

1. **The ledger model**: one hex per line — `address terrain feature* "label"? gm-note?` — so Marcus's append-after-session workflow produces one-line diffs, and the file reads as an exploration log. Deliberately in the spirit of Text Mapper's `0203 forest ruin "label"`, per the migration requirement.
2. **Header pins the interop-critical parameters**: orientation (`pointy`), offset parity (`odd-row`), dimensions, per-hex scale — the four things [#8](https://github.com/Nossimonov/Chartdown/issues/8) says a hex format must never leave implicit.
3. **Sparseness is meaningful**: unmentioned hexes are unexplored, so the *absence* of a line renders as fog. No "unexplored" markup needed for the common case.
4. **Address ranges** (`0101..0109`, `0302..0304`) for bulk fills and region membership, while single-hex lines stay the norm.
5. **Cell-content vocabulary**: terrain word + feature words (`village`, `ruin`, `dungeon`, `lair`, `keep`) from the settlement/site tiers in the use-case requirements.
6. **Trailing `gm "…"` notes** on any hex line — the hexcrawl's secret channel, stripped from player renders (cf. Worldographer's per-hex GM flag).
7. **Routes as ordered hex sequences** (`road … : 0202 0302 …`) — the route threads hex centers; no sub-hex geometry at this scale, honoring the cell-content model from [#8](https://github.com/Nossimonov/Chartdown/issues/8)'s discussion.
8. **Regions as hex-set membership** (`realm … : 0302..0304 …`) rather than drawn borders — the renderer derives the border from the set.

## Requirements traceability

Against Marcus's checklist (use-cases §2): orientation/parity/dimensions/scale ✓ · line-per-hex with label ✓ · ranges for bulk ✓ · settlement tiers + site features ✓ · multi-hex realm with derived border ✓ · routes threading hexes ✓ · per-hex GM notes ✓ · unexplored-by-omission ✓ · number toggle ✓ · legend from used types (renderer behavior, declared in README) ✓ · Text Mapper-compatible spirit ✓. Not exercised: explicit known/unknown override (a hex the players have *seen* but not entered) — noted below.

## Open questions this example deliberately raises

- ~~Address convention~~ — **resolved by [spec 02](../../docs/spec/02-coordinates-and-grids.md) §2/§4** (via [#14](https://github.com/Nossimonov/Chartdown/issues/14) as amended): chess-style column-letter + row-number (`C4`) unified across all grid types; digit-pair dropped; orientation + offset parity mandatory in the header.
- ~~Routes and adjacency~~ — **resolved by spec 02 §4**: consecutive hexes SHOULD be adjacent; renderers bridge non-adjacent steps deterministically and warn.
- ~~Range semantics~~ — **resolved by spec 02 §2**: one matching axis = run, both differing = bounding block in offset space.
- ~~Ledger density~~ — **resolved by spec 02 §4**: ledger form (`C4 forest`) is canonical and tool-emitted; grouped form (`forest : C4 D3 D4`) is legal human sugar; letter addresses soften the wall.
- ~~Feature words vs. the vocabulary question~~ — **resolved by [spec 04](../../docs/spec/04-vocabulary-and-archetypes.md) (mechanism) and [spec 05](../../docs/spec/05-map-primitives.md) §1 (content)**: `keep`, `lair`, `dungeon` are standard-library entries; the ledger grammar (first word terrain, then contents) is spec 05 §3.
- ~~Exploration state granularity~~ — **resolved by [spec 05](../../docs/spec/05-map-primitives.md) §3** (via [#17](https://github.com/Nossimonov/Chartdown/issues/17)): omission = unexplored; `seen` renders terrain but hides contents (demonstrated at G2, the white peak); `unexplored` force-fogs a mentioned hex so GMs can pre-author and reveal per session. GM mode ignores both.
