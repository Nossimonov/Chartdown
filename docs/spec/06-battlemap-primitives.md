# 06 — Battlemap Primitives

**Status: Draft** (accepted from proposal [#18](https://github.com/Nossimonov/Chartdown/issues/18) as amended: footprint scope clarified; elevation included in v0.1). Defines the `battlemap` map type: sections, the battlemap slice of the standard library, structure details (de-provisionalizing spec 01 §4's parked construct), tokens, and elevation.

## 1. Sections

Known battlemap sections: `[terrain]`, `[structures]`, `[features]`, `[tokens]`, plus the universal `[vocab]` and `[gm]`, and `[labels]` (section 07). Paths (rivers, roads) live in `[terrain]`; shape tokens distinguish them.

## 2. Standard-library additions (battlemap slice)

```chartdown
; structures, barriers, openings — the interop-critical triad
building : structure states=ruined
wall : barrier states=ruined
fence : barrier sight=all               ; blocks passage, not sight
pillar : barrier
door : opening passes=closed sight=none
gate : door
window : opening passes=none sight=all
arrow-slit : window
stairs : feature

; tactical terrain
mud : terrain states=difficult
sand : terrain
grass : terrain
snow : terrain
ice : terrain states=difficult
water : terrain states=difficult
rubble : terrain states=difficult

; elevation transitions
ramp : feature
slope : terrain

; props
wagon : feature states=overturned
crates : feature
barrel : feature
chest : feature
table : feature
altar : feature
statue : feature
well : feature
boulder : feature
tree : feature
pit : feature states=difficult

; light-emitting props (light= is generic; these carry overridable defaults)
campfire : feature light=20ft
torch : feature light=20ft
lantern : feature light=15ft
brazier : feature light=20ft

; play aids
start : zone
```

`light=<range>` is a **generic parameter** — any entity may emit light; the props above merely carry defaults (`campfire : O7 light=30ft` overrides).

## 3. Structure details

An indented line beneath a `structure` entity is a **structure detail**, interpreted in the parent's frame:

```chartdown
building tollhouse "Ruined Toll House" : N3..Q6
  ruined : north east          ; wall-state : side words — whole walls
  door : O6.s                  ; opening : edge token on the perimeter
  window : N4.w
```

- **Side words** (`north east south west`) address whole walls of the footprint; **edge tokens** (spec 02 §5) address specific cell edges. Wall-state lines mark sides or edges; opening lines place doors/windows/gates on the perimeter.
- Details are anonymous by default and may take ids like any line (`door back-door : Q5.e`).
- **Footprints** are a rect range (`N3..Q6`) or a cell list — the union of the listed cells and ranges. Odd *orthogonal* shapes are therefore fully in scope: an L-shaped hall is `building : K5..M8 K9..K12`, perimeter derived. Only **non-axis-aligned geometry** (diagonal walls, curved keep walls, corner-point-traced footprints) is deferred beyond v0.1.
- **Smoothing note** *(non-normative)*: an angled wall is representable today as a saw-tooth of cells at the appropriate angle, and a renderer MAY render stair-stepped footprints and wall runs as clean diagonals or curves — provided movement and occupancy semantics follow the declared cells. The syntax conveys cells; appearance is the renderer's.
- **Coincident walls are one wall**: when structures share a wall line (a room built against the courtyard's wall, adjoining rooms' party wall), the coincident edges form a single wall — an opening declared in *either* structure opens the shared edge for sight, light, and passage.
- Freestanding walls need no parent: `wall : K5.e K6.e K7.e` (edge runs, spec 02 §5), with `ruined` available as a state.

## 4. Tokens — no bestiary, by design

The standard library ships **zero creature words**. Creatures are setting content: an unknown word in `[tokens]` infers the token archetype (spec 04 §3) and renders as a labeled token; `size=<n>` (cells per side) and `side=<word>` (themed to colors) carry the tactics. Communities publish creature vocabularies via `use:`; themes supply art. The zero is mechanical (inference already renders anything), cultural (no implied canon), and legal (nothing IP-adjacent to police).

A token-archetype word with an **area placement** renders as a staging zone: `party start : J14..L15` marks where the PCs begin.

## 5. Elevation

- **`elevation=<measure>`** is a generic parameter on areas, zones, structures, and features; default `0`. A sniper perch is a zone at height: `ledge perch "The Old Wall" : zone N2..Q3 elevation=15ft`.
- **Ledges are emergent, not drawn**: wherever adjacent placements' elevations differ, the renderer draws a theme-styled edge, and the drop is the difference — precisely the number the table asks for. There is no cliff-tracing grammar.
- **Transitions are vocabulary**: `stairs`, `ramp`, and `slope` are traversable connections, placed spanning a boundary.
- **Tokens carry no elevation** — a creature's altitude is play-state, which is VTT territory (vision non-goal: Chartdown is not a VTT).

## 6. Crossings and terrain layering

*(Added from proposal [#24](https://github.com/Nossimonov/Chartdown/issues/24); rewritten by [#25](https://github.com/Nossimonov/Chartdown/issues/25).)* Where a road meets a river, the result is a ford or a bridge — and the crossing replaces both at the overlap. A crossing's **location is a consequence, not a fact**: the canonical form derives it —

```chartdown
river redford "The Redford" : path A9 F9 K9 P10 T10 width=2
road tollroad "Old Toll Road" : path K1 K15
ford : on redford on tollroad difficult
```

- **Derived region**: a crossing placed `on` two path entities occupies the **intersection of their bands**. Battlemap bands are exact (polyline through cell centers, width in cells, no organic finishing), so the crossing's cells — tactical extent, difficult-terrain footprint, render region — are a pure function of the two paths and can never disagree with them.
- **Rendering**: crossings render above the paths they join, regardless of declaration order. A ford is a restyled segment of the water's own band (shallow tone plus its `difficult` hatch); the road runs to the band's edge on both sides. A bridge restyles the road's band across the water, with edging.
- **Ambiguity fails loud**: if the bands intersect in more than one place, the derived placement is an error naming the crossing cells; `at <cell>` chooses among them (it never redefines extent).
- **Explicit cells remain legal** for crossings with nothing to derive from (a ford over area-shaped water); when two `on` references resolve to paths, the derived region is authoritative.
- **Implied-crossing warning**: a water-path × road band overlap not claimed by any crossing produces a renderer warning naming both entities and the cell — the render would otherwise imply a bridge nobody declared.
- **Implied-crossing warning**: a water-path × road overlap not covered by any crossing's cells produces a renderer warning naming both entities and the cell — the render would otherwise imply a bridge nobody declared.
- **Layering**: within `[terrain]`, area terrain renders beneath path bands, and paths beneath crossings; declaration order breaks ties within a kind. Consequently, a declared terrain cell grazed by a river's band reads as its bank (mud shows through at the water's edge). *Extent is always declared, never derived*: a "fill to the river" mechanic was considered and rejected — geometric fill would make tactical cells depend on renderer finishing, and cell-space fill would make one entity's extent silently track another's edits. Authors declare the bank cells they mean.

## 7. Label conduct

At battlemap scale, table legibility outranks self-description: **fallback word-labels render as hover tooltips**, not visible text (spec 04 §4's chain-terminal label is satisfied by the tooltip). Visible text labels are reserved for display names, token identifiers, and zones; `nolabel` opts any of those out. Region-scale conduct is unchanged — an anonymous generic marker there carries its word as text (spec 04 §4).

## 8. Export note (non-normative)

The archetype facets map 1:1 onto Universal VTT: barrier and wall geometry → `line_of_sight`; `opening` with its `passes`/`sight` facets → `portals` (closed state, window-ness); `light=` → `lights`; grid and `scale:` → `resolution`. Elevation flattens on UVTT export (ledges bake into the rendered image; walls are unaffected); richer multi-level export targets (e.g. Foundry scene levels) are ecosystem-phase work. This mapping is why the triad is modeled first-class: export is a transform, not an interpretation.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
