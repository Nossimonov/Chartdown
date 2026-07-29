# 0034 — A border lies on one side of its line, and is clipped to the region that owns it

- **Status:** Accepted
- **Date:** 2026-07-28
- **Issue:** [#185](https://github.com/Nossimonov/Chartdown/issues/185)
- **Builds on:** [ADR 0027](0027-an-island-is-separate-or-it-is-a-peninsula.md)

## Context

A coastline stroke is centred on its line, so half its ink lands on the water and half on the land — and *which* half is not a question the model can answer. When two shores approach, the two water-side halves meet and fill the passage between them. The channel is not thin; it is painted over.

That ambiguity is structural rather than anybody's choice, and it is why [#180](https://github.com/Nossimonov/Chartdown/issues/180)'s warning cannot catch the whole problem: that check reasons about geometry, so a theme can erase a channel the checker has just certified.

Measured on a 200mi map, where a coastline strokes at 1.2 user units:

| | ink into the water, per shore | a 0.20mi channel |
|---|---|---|
| centred, as it was | 0.146mi | 0.29mi from two shores — **painted shut** |
| clipped to the water | 0.293mi | 0.59mi — **worse** |
| clipped to the land | **0** | **survives exactly as declared** |

The geometry was correct at every width the whole time. This is entirely a drawing problem.

## Decision

**A border is drawn on the land side, the water side, or both — and never centred on the boundary.** The theme property is `bank=`, with a closed value set of `land`, `water`, `both`.

**There is deliberately no spelling for a stroke whose midline is the coastline.** That is the ambiguity that loses channels, so it is removed rather than defaulted. An author who wants that look declares `bank=both` and owns the result.

**Each stroke is clipped to the region it belongs to.** This is what makes a theme's freedom safe: a bold vignette on the water side may bleed across a narrow channel, but it is painting water-coloured ink onto water, so the passage darkens and never becomes land. The theme can make a map ugly; it cannot make it wrong.

**The default is `land`,** and the arithmetic above is what decides it rather than cartographic convention. A coastline's line is dark ink, not a vignette. Put it on the water and it fills channels faster than the centred stroke it replaced; put it on the land and no stroke paints land colour onto declared water at all, which is spec 08's rule in its strongest form. A theme wanting the conventional water-side vignette says so, and is safe because clipping confines it to water.

Implemented by **clipping a double-width centred stroke**, not by offsetting the line — which would need an outward normal at every vertex and an answer at every join. The mask keeps the half that belongs to the region and the visible width is the one that was asked for. The machinery already existed: [#165](https://github.com/Nossimonov/Chartdown/issues/165)'s land-union masks, and its own observation that clipping an island's shore to water "comes out half-width" — the same fact, recorded there as a problem.

## Alternatives considered

**Default to the water side.** Recommended and provisionally accepted before the arithmetic was done; it is wrong. It reads as right because the conventional vignette *is* on the water — but a vignette is water-coloured decoration and a coastline is a dark line, and putting the line where the vignette goes doubles the ink in every channel.

**Reduce the coastline stroke globally.** Helps a little, costs legibility everywhere, and leaves centred strokes ambiguous — the erasure returns the moment a theme asks for a bolder coast.

**Warn only, as #180 does.** That was the state before this. It tells an author their map is broken without giving them a way to draw it correctly, when the geometry was right all along.

**Widen the channel geometry below a threshold.** Rejected in the issue and worth restating: it makes the drawn map disagree with the document, and it is wrong at every zoom rather than at one.

## Consequences

Every coastline on every map moves by half its stroke width, and the six committed example SVGs are re-rendered. That is the change doing its work rather than a side effect.

A channel narrower than the stroke now survives as far as the geometry allows. What this does **not** do is make a *sub-pixel* channel visible: below about a pixel at the rendered size, correct geometry is invisible however it is clipped. That is the second half of #185 and it is a different mechanism — a legibility floor in device space — which this ADR does not decide.

`bank=` applies to any bounded region's border, not only coastlines, though the coastline is the case that forced it. Where a word has no water to be clipped against, the property has nothing to do and is inert rather than an error.
