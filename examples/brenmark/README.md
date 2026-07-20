# The Brenmark

**Status: aspirational** — hex addressing, vocabulary, and route/region semantics remain pre-spec; the lexical layer conforms to [spec 01 (document model)](../../docs/spec/01-document-model.md), whose §7 sanctions this file's colon-less `[hexes]` ledger as spec-defined shorthand (pending [#8](https://github.com/Nossimonov/Chartdown/issues/8)). Spec-01 canonicalization (2026-07-20): `(difficult)` → `difficult`, `gm "…"` → `gm="…"`. Fulfills [#4](https://github.com/Nossimonov/Chartdown/issues/4), authored against Marcus's hexcrawl narrative in [docs/use-cases.md](../../docs/use-cases.md) §2.

## The chart

A 8×9 chart of six-mile hexes, partially explored: a coastal strip, the settled Duchy of Bren in the east, the Old Trade Road threading between them, and the river Bren descending from the mountains to the sea. Rows 5–9 inland are unmentioned — and therefore unexplored.

## Intended render

Classic wargame-style hex chart: terrain icon per hex, hex numbers on, settlement icons scaled by tier, road and river threading hex centers, the Duchy's border drawn around its hex set, and a legend generated from the terrain types actually used. **Unmentioned hexes render blank/fogged** — the chart visibly has an edge of the known world. The **player render** drops every trailing `gm "…"` note.

ASCII mock (two characters per hex — terrain, then feature; `··` = unexplored; even columns are the offset ones):

```
      01  02  03  04  05  06  07  08
 1    ~~  ~~  h·  hR  m·  m·  ··  ··
 2      ~~  pV  pT  p·  hD  m·  ··
 3    ~~  p·  p·  f·  fK  h·  ··  ··
 4      ~~  pM  f·  fL  f·  pC  ··
 5    ~~  ··  ··  ··  ··  ··  ··  ··
 6      ~~  ··  ··  ··  ··  ··  ··
 7    ~~  ··  ··  ··  ··  ··  ··  ··
 8      ~~  ··  ··  ··  ··  ··  ··
 9    ~~  ··  ··  ··  ··  ··  ··  ··
```

`~` sea · `p` plains · `h` hills · `f` forest · `m` mountains · `pM` marsh · features: `V` village, `T` town, `C` city, `R` ruin, `D` dungeon, `K` keep, `L` lair (GM render only)

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

- **Are addresses `colrow` or `rowcol`?** `0203` follows Text Mapper/wargame convention (column 02, row 03), but nothing in the syntax self-documents this; the header comment is doing load-bearing work. [#8](https://github.com/Nossimonov/Chartdown/issues/8) must fix the convention and consider making it declarable.
- **Feature words vs. the vocabulary question**: `keep`, `lair`, `dungeon` assume a known site vocabulary — same "what does the language know?" question the battlemap example raises for `wagon` ([#9](https://github.com/Nossimonov/Chartdown/issues/9)).
- **Exploration state granularity**: omission = unexplored works for Marcus, but "sighted from a distance" (terrain known, contents unknown) needs an explicit marker eventually — is that a hex property or a GM-section concern? ([#7](https://github.com/Nossimonov/Chartdown/issues/7))
- **Do routes validate adjacency?** If consecutive route hexes aren't neighbors, is that an error, or does the renderer route through intervening hexes? Matters for both authoring forgiveness and diff stability.
- **Range semantics on hex addresses**: `0302..0304` reads as a column run; is a rectangular block range (`0302..0604`) legal, and does it respect offset geometry? ([#8](https://github.com/Nossimonov/Chartdown/issues/8))
- **The ledger form is dense by nature — is a grouped form warranted?** Hex-keyed lines optimize append/diff/lookup but make for a brutal wall of addresses (any cell-content chart looks like this; Text Mapper is identical). The skim-friendly inversion — `forest : 0304 0403 0404 0504`, grouping by content — reads far softer but sacrifices one-line-per-hex diffs and scatters a hex's facts across lines. Whether both forms are legal (canonical ledger + grouped sugar), and whether friendlier addresses (`C4`, spreadsheet-style `AA` columns past 26) beat `0304`, belongs to [#7](https://github.com/Nossimonov/Chartdown/issues/7)/[#8](https://github.com/Nossimonov/Chartdown/issues/8).
