# 0033 — A channel's width is its cross-section, square to the centerline

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [#192](https://github.com/Nossimonov/Chartdown/issues/192)
- **Builds on:** [ADR 0023](0023-detail-is-data-not-noise.md), [ADR 0030](0030-a-centerline-carries-its-own-width.md), [ADR 0032](0032-a-measurement-emits-a-line-that-draws.md)

## Context

[ADR 0030](0030-a-centerline-carries-its-own-width.md) gave a control a width — `via (46,64)@1.5mi` — and called it "the channel's width there". Spec 05 §4 said the same and no more, and **width** turns out to admit several readings that are each self-consistent and disagree badly. Measured down Hood Canal, on the same water:

| reading | median | min | max |
|---|---|---|---|
| largest circle that fits at mid-channel | 1.45mi | 0.52 | 2.75 |
| narrowest crossing through the point, any direction | 1.70mi | 0.50 | 2.95 |
| cross-section square to the centerline | 1.80mi | 0.55 | 6.00 |

Half again, between two defensible readings of one word in the spec. Worse, the choice was load-bearing in a way that invited fixing it by outcome: width feeds the fold condition, and a narrower reading also shrinks the allowance [ADR 0032](0032-a-measurement-emits-a-line-that-draws.md) gives to easing, so which reading was in force decided whether a real waterway drew at all.

## Decision

**The width a control states is the channel's cross-section, measured perpendicular to the centerline at that control** — the distance between the two rails.

The reason is that this is the only reading that is a fact about the drawn map. A renderer offsets the rails square to the line at plus and minus the half-width; if the declared number means anything else, the channel on the map is a different width from the one in the document. That is the objection spec 05 §4 already makes to quietly resizing a feature, arriving as a definition rather than as a clamp: it makes `size=`, and now `@`, stop determining what is on the map.

It is **not the largest circle that fits**. That reads low wherever the line sits off-centre, because the nearer bank caps the circle, and high at a bend, where the circle settles into the corner and touches both outer banks at once — 1.17x the true half-width on a square elbow, and more as the turn sharpens. So it made a channel widest exactly where it turns hardest, which is the one place an offset curve cannot afford it.

It is **not the narrowest crossing in any direction**. That is the right reading at a **mouth**, where the chord *is* the opening and `size=` already means it; anywhere else it finds whatever short crossing happens to lie nearby.

Checked against ground truth rather than argued: a channel built to a known 2.00mi width and turned through a square corner measures **2.10mi along its whole length, corner included** — a pixel of rounding, which is the resolution a raster has — where the inscribed circle reaches **2.34mi** at the elbow.

## Alternatives considered

**Keep the inscribed circle.** It was committed, it is immune to arms, and it had no junction artefact to fix. Rejected because it is a proxy: it answers "how much water is there here", which is a real question and not this one, and its error is worst precisely where the geometry is tightest.

**Leave the term undefined and let each implementation choose.** Rejected on the same ground as every other closed value set in this spec. An undefined term in a normative document is not neutrality, it is a decision deferred onto whoever writes the second renderer, and the two maps then differ by half again with both implementations conforming.

**Settle it after 0.4.0.** Tempting, since it touches a shipped tool. Rejected because the declarations being produced now are the ones authors will keep, and a width that changes meaning later silently rewrites every map that used it.

## Consequences

The measurement reads about 25% wider down Hood Canal than the inscribed circle did. That was expected to cost it: a wider channel folds sooner, and the prediction on record was that adopting the honest definition might push the canal back to being refused. It did not — the trunk corridor of [ADR 0032](0032-a-measurement-emits-a-line-that-draws.md) removes enough of the junction inflation that the true widths still fit, and the 6.00mi maximum above, which was the perpendicular ray escaping up Dabob Bay, is gone with it.

An arm is not part of its host's width. The crossing stops where the trunk does, so a bay hanging off a canal is measured as the feature it is rather than as a bulge in the canal.

This does not make every real waterway drawable, and it slightly narrows the margin on the ones near the edge. The Great Bend still sits close to the limit of what a ribbon can express — a channel turning with a radius near its own half-width has an inner bank that is a corner rather than a smooth offset, and real coastlines have exactly that. Adopting the truthful width means that limit is now met with truthful numbers instead of being masked by a measurement that read narrow.
