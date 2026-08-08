# 0042 — Everything a field draws is clipped to the map field of its own panel

- **Status:** Accepted
- **Date:** 2026-08-08
- **Issue:** [#284](https://github.com/Nossimonov/Chartdown/issues/284), [#288](https://github.com/Nossimonov/Chartdown/issues/288)
- **Builds on:** [ADR 0018](0018-fields-generalize-light.md), [ADR 0037](0037-geometry-is-in-map-units-ink-is-in-canvas-units.md)

## Context

Spec 04 §5 says what a renderer owes a field it does not recognise:

> A renderer owes an unknown field only geometry and a lookup: **ambient as page treatment**, **emitters as pools of their range**, regions as their extent…

That fixes each thing's *shape* and is silent on where the paper ends. The implementation answered by accident, differently in each place, and five issues came of it. Measured on a `3x3` battlemap — a `144×144` page whose map field runs `(24,24)` to `(120,120)`, since `MARGIN` is 24 and `CELL` is 32:

| | drawn as | consequence |
|---|---|---|
| ambient wash | `rect 0,0,144,144` | covers the margin band: the title renders at **1.06:1** contrast and the coordinate letters are painted over entirely ([#285](https://github.com/Nossimonov/Chartdown/issues/285)) |
| emitter pool | `circle r=768` for a `light=120ft` torch | no clip of any kind — not to the field, not to the panel, not to the page ([#289](https://github.com/Nossimonov/Chartdown/issues/289)) |
| the pool's hole in the wash | the same `r=768` circle | masks out every pixel of the wash, so a `light: dark` map renders as though it were not dark ([#290](https://github.com/Nossimonov/Chartdown/issues/290)) |
| a level's panel | `<g transform="translate(0 162)">`, no `clip-path` | a lamp declared `level=cellar` lights the ground floor above it ([#291](https://github.com/Nossimonov/Chartdown/issues/291)) |

The radii are arithmetically right — `120ft ÷ 5ft × 32 = 768` — so nothing here is a geometry bug. Every one of them is the absence of a boundary that was never specified.

**The two halves must be answered together.** [#288](https://github.com/Nossimonov/Chartdown/issues/288) makes the point that decides the shape of this ADR: clip the wash to the field but leave the pool unclipped and a `light: dark` map grows a yellow smear on clean paper outside its own grid. A mismatched pair is worse than either alone, so one rule covers wash, pool and cut-out or none of them.

## Decision

**Everything a field draws — the ambient wash, an emitter's pool, and the hole that pool cuts in the wash — is clipped to the map field of the panel it belongs to.**

The map field is the area the grid or `extent:` occupies: the frame inset by its margin. On the measured example that is exactly `(24,24)`–`(120,120)`, which is the point of stating it this way — it is a coordinate bound a test can assert, not a sentiment about tidiness.

**The margin band is not part of the place.** Spec 04 §5 already says ambient is *"a fact about **the place**"*, and the margin is the paper the place is printed on. It carries the apparatus for reading the map — the title, the coordinate letters a GM calls out in play, the compass, the level caption. A printed battlemap of a lightless cellar does not have a black border, and the sheet does not become harder to read because the room drawn on it is dark.

**A pool's true extent is untouched.** What is bounded is the drawing, not the fact: UVTT export emits the radius in grid units and is not affected. This is [ADR 0037](0037-geometry-is-in-map-units-ink-is-in-canvas-units.md)'s split one storey up — *anything that decides where the light is* is world data and is preserved; *anything laid on the sheet* is a page treatment and is bounded by the sheet's own geometry.

**"Its own panel" is load-bearing.** A level is a different place, drawn in its own panel, and light in the cellar cannot fall on the ground floor. Clipping per panel rather than per page is what makes that true, and it is the only part of this rule that needs geometry the renderer does not already compute.

**Stated for every map kind, not for battlemaps.** [#287](https://github.com/Nossimonov/Chartdown/issues/287) reports `light:` as a silent no-op on region and hexcrawl maps. Whichever way that resolves, this rule is already written to cover it: a region map's field is its `extent:`, a hexcrawl's is its hex grid, and neither needs a separate sentence.

## Alternatives considered

**Clip to the page instead of the field.** The smaller change — it fixes the escaping pool and the level bleed and leaves the wash where it is. Rejected on [#285](https://github.com/Nossimonov/Chartdown/issues/285)'s measurement: a wash that reaches the margin renders the document's own title at 1.06:1 against its background, and paints out the coordinate labels completely, because they are emitted into `layers.grid` and draw *below* the wash. No colour rule rescues something that is painted over, so a page-wide wash forces a second mechanism for furniture that the field-wide rule does not need at all.

**Clip the wash but not the pool.** Rejected by [#288](https://github.com/Nossimonov/Chartdown/issues/288)'s argument, and recorded because it is the version most likely to be reached for while fixing [#285](https://github.com/Nossimonov/Chartdown/issues/285) alone: it produces a lit smear on bare paper outside the grid, which is a worse artefact than the one it removes.

**Leave it unspecified and fix each bug on its merits.** What produced four different answers in one subsystem. Spec 04 §5's silence is exactly what let the wash, the pool, the hole and the panel each acquire a different boundary.

## Consequences

[#285](https://github.com/Nossimonov/Chartdown/issues/285), [#289](https://github.com/Nossimonov/Chartdown/issues/289) and [#291](https://github.com/Nossimonov/Chartdown/issues/291) are answered by this rule and become implementation. [#284](https://github.com/Nossimonov/Chartdown/issues/284) and [#288](https://github.com/Nossimonov/Chartdown/issues/288) close with it.

**[#290](https://github.com/Nossimonov/Chartdown/issues/290) is only half answered, deliberately.** Clipping the hole stops the wash being erased in the margin, but *inside* the field the hole is still the pool's own shape at full weight, so an emitter large enough to span the field still means "this map is not dark" — a statement about lighting the document never made. That is a question about what a hole *means* rather than where it may be drawn, and it is not this ADR's to answer. It needs its own decision, and the issue should stay open with its second point.

No committed example declares `light:`, so the corpus does not move; a test asserting the bound is the thing that proves this shipped.

The rule binds the renderer, not the author. Nothing about a document changes, no diagnostic is added, and a map whose emitter out-ranges its own field is still a legal map — it simply stops drawing light on the page furniture.
