# 0035 — A channel too narrow to see is drawn as a symbol, at a floor in viewport units

- **Status:** Accepted
- **Date:** 2026-07-28
- **Issue:** [#185](https://github.com/Nossimonov/Chartdown/issues/185)
- **Builds on:** [ADR 0027](0027-an-island-is-separate-or-it-is-a-peninsula.md), [ADR 0034](0034-a-border-lies-on-one-side-of-its-line.md)

## Context

[ADR 0034](0034-a-border-lies-on-one-side-of-its-line.md) stopped a coastline stroke from painting a passage shut, and left its own second half open in terms: *"what this does not do is make a sub-pixel channel visible: below about a pixel at the rendered size, correct geometry is invisible however it is clipped."* That is the other cause #185 names, and it is a different mechanism entirely. Clipping prevents erasure; nothing about clipping helps a channel that is simply smaller than a pixel.

Chartdown has already decided this question once, for rivers. A river's drawn width defaults to `2` user units, and user units scale with `extent:`, so the same declaration draws the same thickness on a 100mi map and a 3000mi one. **A linear water feature's drawn width is already a symbol rather than a measurement.** A channel cannot borrow that directly — a channel is negative space between two filled shapes rather than a stroked centreline — but the principle transfers, and the alternative does not: widening the *geometry* below a threshold makes the drawn map disagree with the document, and is wrong at every zoom rather than at one.

## Decision

**A channel narrower than the legibility floor is drawn as a symbol: a stroke down the medial line of the gap, in the colour of the water it lies in, at a minimum width in the SVG's viewport units.** The land does not move; nothing edits a polygon. The symbol is ink laid over the drawing.

**The floor is one number doing two jobs — the gate and the drawn width — and that is what keeps it honest.** At the map's intrinsic size a user unit *is* a viewport unit (`viewBox="0 0 w h"` with `width="w"`), so "narrower than the floor in user units" and "narrower than the floor on the reader's screen" are the same sentence. It follows that a channel already wider than the floor is never symbolised, because the symbol would be drawn strictly inside water it already matches, and would be invisible if it were drawn.

**The floor is `2`, by measurement.** 1.5 was the argued value — the smallest width at which a line ought to read as a gap. Rasterised against paper at a small pane's scale it is a hint rather than a passage; at 2 the island reads as separate. It remains narrower than the 1.2 + 1.2 of the two coastline strokes it lies between, so the symbol never dominates the shores it separates.

**Convergence is in viewport units, not device pixels, and that distinction is load-bearing.** `vector-effect="non-scaling-stroke"` holds a stroke constant against changes in the SVG's own user-space-to-CSS-pixel scale. So the symbol gives way to the truth when the map is given more room, or when a `viewBox` is narrowed onto a region. **Page zoom does not converge** — Ctrl+ scales CSS pixels, so the geometry and the symbol grow together and their ratio never moves.

**A gap that exists is drawn; a gap that does not exist is still reported.** Where two land outlines touch or overlap there is no channel, the midpoint between the two shores lands inside one of them, and nothing is found — so [ADR 0027](0027-an-island-is-separate-or-it-is-a-peninsula.md)'s welded island stays [#180](https://github.com/Nossimonov/Chartdown/issues/180)'s warning and is not quietly opened by the renderer.

**A symbolised channel is not reported.** This is the drawing convention applied uniformly and undone by zoom — the same standing the river's symbolic width already has — and a diagnostic on every narrow passage would bury the welded islands that *are* mistakes. What the symbol carries instead is a `<title>`: *"this passage is 0.05mi across — drawn wider so it can be seen, and narrowing to its true width as you zoom in."*

The floor is **not a theme property**. A floor a theme could lower is not a floor, and spec 08's rule is already that a theme may make a map ugly but not wrong.

## Alternatives considered

**Widen the channel geometry below a threshold.** Rejected in the issue and worth restating: the drawn map would disagree with the document, and SVG is specifically the format that holds fidelity at any zoom.

**A minimum width in user units.** Simpler, and wrong at depth in exactly the way this exists to avoid — user units scale with the map, so the widening would still be there when a reader magnified it.

**Bleed every water polygon outward by the floor, by stroking its own outline.** One attribute, no geometry, and it converges the same way. Rejected because it symbolises *everything*: an open coast has no legibility problem, and the bleed would eat the floor's width out of every coastline stroke on the map at low zoom, worsening the common case to fix the rare one.

**Symbolise every channel, wide or narrow, and let the wide ones self-hide.** Defensible — a symbol inside water it matches is invisible, so the gate is an optimisation rather than a correctness rule. Rejected for what it would cost in output size and render time on a traced coast, and because it makes the drawing depend on a fact nothing states.

**Calibrate the gate to the display size rather than the intrinsic size.** Not available — the renderer emits one file for every surface. Intrinsic size is the right calibration because it is the one *every other legibility decision in the renderer already uses*: label font sizes, marker radii and stroke widths are all chosen there. A map shown at half size is half legible everywhere, which is not the floor's problem to solve.

## Consequences

Where two land regions come within the floor of each other with water between them, a hairline of that water's colour is laid over both shores — up to half the floor onto each. **That is the bargain every paper map makes**, and it is acceptable only because the symbol provably converges to the geometry and the alternative is wrong at every zoom.

**Only a gap between two distinct land regions is covered.** A neck within one shore's own ring — a strait between two peninsulas of the same landmass, or a declared water body thinner than the floor along its whole length — is one ring approaching itself, which needs a medial axis rather than a nearest-neighbour. Neither is what #185 was raised about; both are named here rather than left to be discovered.

**A welded island gets no help from this.** On the Puget Sound exercise map the three passages the issue names are mostly *contact* rather than narrow water, so the floor finds only their almost-touching fringes. Those channels become visible when the islands stop overlapping the mainland — a finer classification — not when the drawing changes. The two halves of #185 fix drawing problems, and a welded island is not one.

A segment of a water body's ring lying along the picture's edge is not a shore, and is excluded — the same lesson [#198](https://github.com/Nossimonov/Chartdown/issues/198) learned about a traced coastline's arc and its ends, met a third time.

Measured on the heaviest document available — a traced Puget Sound coast with fifteen islands, 1.2MB of SVG — the pass costs nothing distinguishable from noise against a 240ms render.
