# 0032 — A measurement emits a line that draws, and checks it the way the renderer will

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [#192](https://github.com/Nossimonov/Chartdown/issues/192)
- **Builds on:** [ADR 0023](0023-detail-is-data-not-noise.md), [ADR 0028](0028-measurement-is-an-optional-package-in-typescript.md), [ADR 0030](0030-a-centerline-carries-its-own-width.md)

## Context

`chartdown-measure` produced a centerline that the renderer refused, three ways over.

It **wandered into the arms**. Flooding behind a mouth captures Dabob and Quilcene as well as the trunk, and an arm's water sits at much the same distance from the mouth as the trunk beside it — so a band spanning both had its centre *between* them. Measured on Hood Canal the line doubled back through the bays and returned: six controls reversing on themselves, carrying widths of 0.14, 0.1 and 0.38mi on a channel whose median is 1.5. The tiny widths were the giveaway; mid-channel there is the gap between two bays rather than any channel at all.

It **checked a curve nobody draws**. Spec 05 §4 refuses a bend whose radius drops below the half-width there, and the tool validated its control polygon. An interpolating spline's curvature at a knot depends on its neighbours, so all 27 controls cleared the rule while the drawn line turned at 0.5mi carrying a half-width of 1.1.

And it **emitted the result silently**, leaving an author to paste a declaration in and discover from the renderer that it could not be drawn.

## Decision

**The tool's output is a declaration that draws, and it establishes that the same way the renderer does.**

- **The trunk is what the measurement follows.** Topology comes from the path of steepest descent back from the farthest water: it cannot enter a bay, because a bay is a dead end and nothing inside one is farther from the mouth than its own entrance. Position still comes from the depth-weighted band centroid — a steepest-descent path hugs the inside of every corner, which is a line no channel of any width could follow.
- **Water is on the trunk if going through it is barely a detour.** The field is grown a second time from the head, so a pixel's distance from the mouth plus its distance from the head is the length of the best route passing through it, and the excess over the direct run is what that way *costs*. Mid-channel water costs nothing; water a mile up a dead-end arm costs two, there and back. Connectivity alone cannot tell them apart, because an arm and its trunk are one body of water at the arm's own mouth. The allowance is the channel's own width, so the junction counts as trunk — which it is — and nothing past it does.
- **The spline lives in `@chartdown/core`.** The shape a `via` list means is not a rendering choice. Two copies of it is precisely how a measurement comes to check a line the renderer will never draw, which is the defect above. `@chartdown/measure` keeps no third-party runtime dependencies: core is ours and is itself dependency-free, and the published binary is bundled.
- **Bends the channel cannot follow are eased, bounded by the channel.** A centerline is only meaningful down to the scale of its own width; curvature finer than the half-width is measurement noise, not geography. A control may move anywhere within its own half-width of where it was measured and no further — inside that circle the line is still in the water it describes; outside it, easing would be inventing a course. The endpoints do not move: the first is the feature's anchor and the last is its head, and both are extents rather than shape.
- **Where it still cannot be drawn, the tool says so**, and reports how tight the worst bend is against the width there. Better to hear it from the tool that produced the line than from the renderer after pasting it in.

## Alternatives considered

**Emit the measurement raw and let the renderer refuse it.** Purest, and it was tempting on ADR 0023's logic that measured data is data. Rejected because the wander was not data: a centerline through the middle of two bays is not a worse measurement of the trunk, it is a measurement of something else. Easing is a different matter and is bounded accordingly.

**Ease without a bound, until it draws.** Rejected outright. It would make the tool's output a function of what the renderer happens to accept rather than of the place, and a channel that genuinely hairpins would come back as a gentle curve that no longer matches the water. The bound is what keeps this a measurement.

**Duplicate the spline in the measurement package** to keep its dependency list empty. Rejected: the whole failure being fixed is a second opinion about what curve a `via` list means.

**Tune the width measure until Hood Canal draws.** Three definitions were tried — the inscribed circle, the narrowest chord in any direction, and the cross-section perpendicular to the centerline — and drawability flipped between them at the few-percent level, partly because a narrower measured width also shrinks the easing allowance. Choosing among them by which one lets a particular canal through is how a plausible-and-wrong number gets shipped. The committed definition is unchanged here, and which one is *right* wants its own comparison against ground truth.

## Consequences

Hood Canal draws. Twenty-six controls, a width profile from 0.52 to 2.75 miles, measured from imagery and rendered without hand editing — the first time the exercise has produced that.

What this does **not** settle is how a channel's width should be measured. The inscribed circle at mid-channel under-reports where the centerline sits off-centre and over-reports at a bend, where the largest fitting circle settles into the corner and touches both banks; on a square elbow that is 1.17x the true half-width, and more as the turn sharpens. That it currently draws is not evidence the definition is right.

The Great Bend remains close to the boundary of what a ribbon can express. A channel turning with a radius near its own half-width has an inner bank that is a corner rather than a smooth offset, and real coastlines have exactly that — a pointed headland on the inside of a tight bend. The model has not been shown to be wrong, but it has been shown to have an edge, and Hood Canal sits near it.
