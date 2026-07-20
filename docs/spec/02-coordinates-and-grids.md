# 02 — Coordinates and Grids

**Status: Draft** (accepted from proposal [#14](https://github.com/Nossimonov/Chartdown/issues/14) as amended: unified chess-style addressing; live anchoring with the remnant-landmark pattern). Defines how positions are written: cell addresses, edges and corners, gridless points, and the closed relational-placement grammar, plus the resolution semantics that make incremental maps stable.

## 1. Units, indexing, orientation

- Grids are 1-indexed. Row 1 (grids) and y=0 (gridless) are north; columns/x grow east, rows/y grow south. The origin is always northwest.
- `scale:` (grid maps) gives the real size of one cell: `scale: 5ft`, `scale: 6mi`.
- `extent:` (gridless maps) gives the map's world size: `extent: 900x600mi`.
- Bare numbers in placements are cells (grid maps) or world units (gridless maps). Explicit units (`70mi`, `20ft`) are always legal and MUST match the map's unit dimension.
- The optional header key `seed:` takes an integer that varies deterministic organic rendering (§8). Same document + same seed → same geometry, always.

## 2. Cell addresses — one form for every grid

A cell address is column letters followed by a row number: `K11`, `C4`. Columns run `A`–`Z`, then spreadsheet-style `AA`, `AB`, … — there is no width cap. The same form addresses square cells and hexes; the header's `grid:` declaration determines geometry.

- **Lists**: whitespace-separated addresses (`C12 E13`).
- **Ranges**: `A11..F15` — inclusive between the two corner cells. On square grids this is the rectangle; on hex grids, a range with one matching axis is a run along the other, and a range with both differing is the bounding block in offset space.

## 3. Square grids

Declared `grid: square <W>x<H>` (e.g. `grid: square 20x15`). Nothing further; addresses, lists, ranges per §2.

## 4. Hex grids

Declared `grid: hex <W>x<H> <pointy|flat> <odd-row|even-row|odd-col|even-col>` (e.g. `grid: hex 8x9 pointy odd-row`). Orientation and offset parity are **mandatory** — the four-variant parameterization that guarantees round-trippable interop with hex-aware tools.

- **One address grammar, both content models**: `C4` keys a ledger line in a hexcrawl's `[hexes]` section and equally positions a token or shape on a hex-gridded battlemap.
- **Routes** (ordered address sequences): consecutive hexes SHOULD be adjacent; a renderer MUST bridge non-adjacent steps deterministically along the hex-line between them and SHOULD warn.
- **Ledger and grouped forms**: within `[hexes]`, both are legal — address-first ledger lines (`C4 forest`, canonical; tools that write documents MUST emit this form) and type-first grouped lines (`forest : C4 D3 D4`, skim-friendly sugar). Humans choose; the two forms may mix.

## 5. Edges and corners

Walls, doors, and windows live on cell edges. An edge or corner is a single token, `<address>.<dir>`:

- Edges: `O6.s`, `N4.w` — directions `n e s w`.
- Corners: `K5.nw` — directions `ne nw se sw`.

Sequences of edge tokens describe wall runs (`wall : K5.e K6.e K7.e`). Full wall/door/window semantics belong to the battlemap-primitives section; only the addressing is fixed here. Edge-based geometry exports losslessly to polyline formats (UVTT).

## 6. Gridless points

On gridless maps, a point is `(x,y)` in the map's extent units from the northwest origin: `(360,330)`. Points are written coarsely by design — precision is never required, and relational placement (§7) is preferred wherever a named anchor exists. Point sequences form polylines and polygons exactly as cell lists do.

## 7. Relational placement — the closed grammar

Relational placement is legal **only** in the following forms, built from the closed keyword set `at · on · near · of · from · via · to · along · edge`. Anything else is a syntax error: no free prepositions, no new phrasings without a spec change.

| Form | Example |
|---|---|
| `at <point>` (`at` optional on grids) | `capital "Highkeep" : (360,330)` |
| `<measure> <compass> of <ref>` | `town "Merrow's Rest" : 70mi north of "Argenport"` |
| `<compass> of <ref>` — half-plane / general direction | `realm "Khar" : east of "The Serpent's Spine"` |
| `on <ref>` | `village "Gull Landing" : on "Gull Bay"` |
| `on <ref> at <point>` — nearest point on ref | `city "Argenport" : on coastline at (160,470)` |
| `<compass> edge of <ref>` | `town "Dunmere" : south edge of "Thornwood"` |
| `near <ref \| point>` | `near (720,240)` |
| `from <endpoint> [via <points>] to <endpoint>` — paths | `river "The Vess" : from "The Serpent's Spine" at (720,240) to "Gull Bay"` |
| `along <ref>` — path shape hint or feature-following line | `border : along "The Serpent's Spine"` |

- `<ref>` is a bare id word or quoted display name; resolution is defined by [03 — Identity, References, and Links](03-identity-and-links.md).
- `<endpoint>` is `<ref>`, `<point>`, or `<ref> at <point>`.
- `<compass>` is the 8-wind set — `n s e w ne nw se sw`, full words equally legal (`north`, `northwest`).
- `<measure>` is a number with optional unit (`70mi`, `12`).

## 8. Resolution semantics — the never-reflow rules

1. **Order-bounded.** A placement may reference only entities declared earlier in the document. Forward references are errors. Appending lines therefore never moves an existing placement.
2. **Deterministic.** Placement resolution and organic shape rendering are pure functions of (document, seed, renderer version, theme). No unseeded randomness, ever.
3. **Fail-loud.** If a relational placement cannot be satisfied — no room `on "Gull Bay"`, ambiguous reference — that is an author-facing error naming the line. A renderer MUST NOT relocate other entities to make room.
4. **Anchors are live.** Placements re-resolve from source on every render. Deliberately moving an anchor moves the entities anchored to it: the map is written in terms of itself. Because of rule 1, only upstream author edits ripple, and only downstream — never a renderer decision.

> **Authoring pattern — the remnant landmark** *(non-normative)*: when a landmark is deliberately moved or destroyed (the city dragged into the hells), preserve dependent placements by leaving a remnant entity at the former position — `ruin "Former site of Elturel" : at (410,220)` — and anchoring dependents (or the moved original) to the remnant. This keeps live anchoring's readability without surprise ripple through history-heavy maps.

## 9. Sketch shapes

Shape tokens whose geometry the renderer finishes organically (deterministically, per §8.2):

| Shape | Form | Meaning |
|---|---|---|
| `area` | `area <range \| cell/point list>` | polygon or block |
| `path` | `path <cell/point sequence> [width=N]` | polyline |
| `blob` | `blob <point \| cell> size=<measure>` | organic mass around a center |
| `ridge` | `ridge <point sequence>` | elongated organic mass along a spine |

## 10. Grammar sketch additions

Extends spec 01 §9's `placement` production (informal; to be made normative per [#12](https://github.com/Nossimonov/Chartdown/issues/12)):

```ebnf
placement  = address | range | edge | point | shape | relational ;
address    = letter , { letter } , digit , { digit } ;
range      = address , ".." , address ;
edge       = address , "." , dir ;
point      = "(" , number , "," , number , ")" ;
shape      = ( "area" | "path" | "blob" | "ridge" ) , { placement | pair } ;
relational = ( "at" , point )
           | ( [ measure ] , compass , "of" , ref )
           | ( "on" , ref , [ "at" , point ] )
           | ( compass , "edge" , "of" , ref )
           | ( "near" , ( ref | point ) )
           | ( "from" , endpoint , { "via" , point } , "to" , endpoint )
           | ( "along" , ref ) ;
endpoint   = ref , [ "at" , point ] | point ;
ref        = word | string ;
```

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
