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
- **Ranges**: `A11..F15` — inclusive between the two corner cells. On square grids this is the rectangle; on hex grids, a range with one matching axis is a run along the other, and a range with both differing is the bounding block in offset space. On gridless maps, `(x1,y1)..(x2,y2)` bounds the rectangle between two points (used by, e.g., label `sprawl`).

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
| `on <ref> at <point\|local>` — placement in the referent's frame | `city "Argenport" : on coast at (160,470)` · `table : on kitchen at C2..D2` |
| `<compass> edge of <ref>` | `town "Dunmere" : south edge of "Thornwood"` |
| `near <ref \| point>` | `near (720,240)` |
| `from <endpoint> [via <points>] to <endpoint>` — paths | `river "The Vess" : from "The Serpent's Spine" at (720,240) to "Gull Bay"` |
| `along [<compass> edge of] <ref>` — path shape hint, feature-following line, or a feature-following stretch of an `area` boundary / a border's stretch selector (spec 05 §2, ADRs 0012–0013). The optional face qualifier names WHICH line of an areal referent to follow (`along south edge of westspine`); a line-needing reference to a crestless area without a face is ambiguous and fails loud | `road "Coast Road" : from "Argenport" to "Merrow's Rest" along coast` · `realm khar "Khar" : area (600,80) along spine (620,470) (900,420)` |

- `<ref>` is a bare id word or quoted display name; resolution is defined by [03 — Identity, References, and Links](03-identity-and-links.md).
- **Multiple relational placements constrain jointly**: `on coast 70mi north of argenport` means both hold. In particular, two `on` references to path entities place the entity at the **intersection of their bands** — the idiom for crossings (`ford : on redford on tollroad`), whose location is thereby derived rather than restated; see spec 06 §6. If the constraints are satisfiable in more than one place, the placement is ambiguous — a fail-loud error — and an `at <cell|point>` *chooses* among the candidates without redefining extent.
- `<endpoint>` is `<ref>`, `<point>`, or `<ref> at <point>`.
- **The `at` payload of `on` is interpreted in the referent's frame** *(from proposal [#34](https://github.com/Nossimonov/Chartdown/issues/34))*. A point is the gridless form (nearest point on the referent). A **cell, range, or edge token** is a *local* address: a structure's frame is its own footprint grid — bounding rect of the cell-union, **NW cell = A1**, axes as the document grid — so `table : on kitchen at C2..D2` arranges the kitchen by the kitchen, and moving the kitchen moves its contents (live anchors, §8.4). A path's frame is the document grid itself (paths have no local grid) — which is exactly the crossing chooser of spec 06 §6. A local address outside the referent's footprint, a referent with no footprint frame, or a referent on another level is an error. **Relative placement is the author's choice per line, never a mode**: absolute placement remains legal everywhere and both idioms coexist in one document — the designer arranges rooms in room coordinates while the table plays in absolute ones, so renderers surface the resolved absolute address (tooltip or equivalent) for relatively-placed entities.
- `<compass>` is the 8-wind set — `n s e w ne nw se sw`, full words equally legal (`north`, `northwest`).
- `<measure>` is a number with optional unit (`70mi`, `12`).

## 8. Resolution semantics — the never-reflow rules

1. **Order-bounded.** A placement may reference only entities declared earlier in the document. Forward references are errors. Appending lines therefore never moves an existing placement.
2. **Deterministic.** Placement resolution and organic shape rendering are pure functions of (document, seed, renderer version, theme). No unseeded randomness, ever.
3. **Fail-loud.** If a relational placement cannot be satisfied — no room `on "Gull Bay"`, ambiguous reference — that is an author-facing error naming the line. A renderer MUST NOT relocate other entities to make room.
4. **Anchors are live.** Placements re-resolve from source on every render. Deliberately moving an anchor moves the entities anchored to it: the map is written in terms of itself. Because of rule 1, only upstream author edits ripple, and only downstream — never a renderer decision.
5. **Well-formed output.** A renderer targeting an XML format (SVG, UVTT-adjacent XML) MUST emit well-formed markup for **every** valid document — user text (display names, `gm=` notes, labels) can never break the output, whatever characters it contains.

> **Authoring pattern — the remnant landmark** *(non-normative)*: when a landmark is deliberately moved or destroyed (the city dragged into the hells), preserve dependent placements by leaving a remnant entity at the former position — `ruin "Former site of Elturel" : at (410,220)` — and anchoring dependents (or the moved original) to the remnant. This keeps live anchoring's readability without surprise ripple through history-heavy maps.

## 9. Sketch shapes

Shape tokens whose geometry the renderer finishes organically (deterministically, per §8.2):

> *Non-normative — finishing is not inventing.* A renderer smooths and textures the author's sketch; it never fabricates geography the sketch doesn't contain, because determinism and additive stability (§8) forbid improvisation. Sketch density is therefore authorial: a two-point path renders as a near-straight line however organic the finishing, so give a landmark river as many `via` points as its story deserves — the same budget you'd give a coastline.

| Shape | Form | Meaning |
|---|---|---|
| `area` | `area <range \| cell/point list>` | polygon or block |
| `path` | `path <cell/point sequence> [width=N]` | polyline |
| `blob` | `blob <point \| cell> size=<measure>` | organic mass around a center |
| `ridge` | `ridge <point sequence> [width=<measure>]` | elongated organic mass along a spine; `width=` declares the mass's breadth — the belt, not the centerline, is the feature's footprint (a mountain range is terrain with dimensions, not a string of peaks). `ridge (…) area (…)` on one entity refines the extent while the crest survives for references — refinement is additive, never a swap (ADR 0013) |

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
           | ( "from" , endpoint , [ "via" , point , { point } ] , "to" , endpoint )
           | ( "along" , ref ) ;
endpoint   = ref , [ "at" , point ] | point ;
ref        = word | string ;
```

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
