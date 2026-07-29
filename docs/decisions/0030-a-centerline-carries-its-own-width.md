# 0030 — A centerline carries its own width

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [#190](https://github.com/Nossimonov/Chartdown/issues/190)
- **Builds on:** [ADR 0023](0023-detail-is-data-not-noise.md), [ADR 0026](0026-shape-is-declared-data.md)

## Context

A placed feature's shape was `size=` — its mouth — and `taper=`, how far along it converges. That is a ribbon whose width falls **monotonically** from the opening, so the mouth is always the widest part and the shape is always a tube.

Real water is not a tube, and [#181](https://github.com/Nossimonov/Chartdown/issues/181)'s measurement finally made that checkable rather than arguable. Hood Canal, read off georeferenced imagery at 0.05mi per pixel, runs **2.2, 3.9, 1.3, 5.8 and 1.1 miles across** down its own length: narrowest 0.50, median 1.64, widest 5.84, and not monotone anywhere. It is a chain of basins joined by narrows, which is what a drowned glacial valley is. Fitting the declared model to that measurement **misses the true width by up to 4.04mi against a median of 1.64** — an error two and a half times the typical width of the thing being drawn.

That gap is why six rounds of the exercise produced what were described as platonic ideals: internally consistent, obedient to the spec, and resembling no actual inlet. It is also why measuring more accurately changed nothing. `chartdown-measure` computed the entire width profile and then discarded it, because a declaration had nowhere to put it — so both the remembered and the measured versions were squeezed through the same two-parameter bottleneck and came out the same shape.

## Decision

**A centerline control may state the channel's width there**, and the shape follows the stated profile:

```chartdown
fjord hood "Hood Canal" : on shore at (52,50) via (51,57)@3.9mi (46,64)@1.5mi (42,68)@4.7mi (30,84)@1.3mi size=1.8mi
```

`@` reads as "at" and binds to the point it follows, so a profile skims as one thing: where the channel goes, and how wide it is there, in the order a person would say it.

- **`size=` is the profile's first point** — the mouth — rather than a competing mechanism.
- **A control may omit its width**, and it is interpolated from its neighbours, so an author states the widths that matter and leaves the rest.
- **Interpolation is eased, not straight.** Linear interpolation draws the basins as a row of facets — a surveyed polygon, against a spec whose first value is that a coast reads as though it were drawn. Cosine easing meets each control level and, unlike a cubic, cannot overshoot; an overshoot here is a negative width.
- **`taper=` governs the generated case only.** Where widths are stated they are the shape, and the head closes on the last width stated, so a channel that ends broad ends broad. This is [ADR 0026](0026-shape-is-declared-data.md)'s rule again: two mechanisms for one quantity is how a renderer comes to pick one silently.
- **A mouth narrower than the water behind it is a NARROWS**, and the rails flare from it. The mouth fillet only ever closes: its square-root profile has an infinite slope at the opening, which is exactly right when the channel narrows — the rail leaves running *along* the coast, which is what makes an inlet's mouth a corner with a radius — and running that curve backwards sent the rail *into* the coast, measured at 148° on a widening of under two tenths of a unit.

The spelling is additive. A feature that declares no widths renders exactly as before.

## Alternatives considered

**Declare each basin as its own `bay` on the canal.** The most Chartdown-ish answer — everything addressable, everything nameable — and it was the runner-up. It fails on the trunk: an arm *adds* to its host rather than modulating it, so the canal's own width still could not vary between the basins, and Hood Canal's trunk alone runs 1.1 to 3.9mi. It also makes a naming decision out of a geometric one; not every widening is a place with a name.

**Accept the schematic** — say Chartdown draws a diagram of a waterway rather than a tracing, and a GM's map does not need the basins. Coherent, and it was the honest alternative to putting more syntax in. Rejected because it is in tension with what this release is for: a map that reflects real geographic features. If that goal is not being met, the goal should be restated rather than quietly missed.

**A width function on the entity** (`profile=1.8,3.9,1.5,4.7`). Compact, and it divorces the numbers from the places they describe — the reader has to count commas against `via` points to know which width is where, and inserting one control silently re-points every width after it.

## Consequences

The measurement loop closes: `chartdown-measure` now emits the profile it always computed, and a measured declaration says what it measured.

What it does **not** buy is that every real waterway becomes drawable. Hood Canal's measured profile is still refused, and for an honest reason: at the Great Bend the shape asks a channel several miles wide to make a hairpin turn of smaller radius, and an offset curve folds when its radius drops below its half-width — the condition [#177](https://github.com/Nossimonov/Chartdown/issues/177) established, now binding on a real feature rather than a synthetic one. Part of that width is Dabob and Quilcene, which the measurement folds into the trunk because it floods everything behind the mouth. So the remaining work is in measurement, not in the language: separating a trunk from its arms.

The renderer gains a second sampling path, since the stops for a stated profile cannot be spaced by radii derived from `taper=`. That is real duplication and a real place for the two to drift; it is bounded by both paths ending in the same rails, rails, and checks.
