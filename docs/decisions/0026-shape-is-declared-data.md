# 0026 — A feature's shape is declared data: an outline for what is detached, a centerline for what deforms

- **Status:** Accepted
- **Date:** 2026-07-26
- **Issue:** [#172](https://github.com/Nossimonov/Chartdown/issues/172)

## Context

[ADR 0023](0023-detail-is-data-not-noise.md) says anything a story can attach to must be declared. A placed feature's **shape** was the one thing about it that could not be: it came out of `size=`, `reach=` and `taper=`, and an outline supplied alongside them was silently discarded.

Three numbers produce a lozenge. That is right for the anonymous mid-river islet the ADR is written around, and wrong for **Whidbey Island**, which doglegs at Coupeville, or for Hood Canal, which turns hard east at the Great Bend. Those are precisely the landforms a campaign attaches itself to — which is the ADR's own test for what has to be data. On the Puget Sound exercise map every island came out the same rounded oval at a different scale and angle, and every inlet the same trench.

There was already a half-path, and its incoherence is the clearest statement of the problem. Measured on `0.4-dev` at 5b98bf5, the same island declared three ways:

| declaration | drawn |
|---|---|
| `near shore at (20,55) size=8mi reach=0.5` | 70 pts, 32.7 × 65.5 |
| `… size=8mi reach=0.5 area (16,48) (…)` | **identical** — the outline discarded |
| `… area (16,48) (…)` (no `size=`) | 4 raw points, **plus a bogus "has no size=" warning** |

Three behaviours and no rule: the outline was honoured only when the dials were absent, drawn raw rather than finished, while the renderer complained the feature had no extent.

[ADR 0025](0025-a-blob-declares-an-extent-not-an-outline.md) settled the neighbouring question — a `blob` declares an extent, and `size=` now means exactly what it says. That made this one answerable rather than urgent: a declared outline is an *addition* to a language whose extents can be trusted, where it would have been a *rescue* of one whose extents could not.

## Decision

**A feature's shape is declared data, in the spelling its `morph=` can carry.**

**A detached feature declares an OUTLINE.** Its shape is self-contained, so it can simply be given, as an `area` on the entity line — already parsed, so no new grammar:

```chartdown
island whidbey "Whidbey Island" : near shore at (40,100) area (-2,-40) (3,-30) (1,-20) (6,-8) (5,4) (10,18) (7,32) (2,26) (-1,10) (-5,-6) (-6,-24)
```

- The points are **framed** — offsets from the anchor in map units, the same referent-frame rule ADR 0009 sets for `on … at` and [#142](https://github.com/Nossimonov/Chartdown/issues/142) sets for shapes. Moving the island stays **one coordinate** rather than a transform of the whole set, and the feature remains attached to its host, which is what makes it a placed feature at all.
- The outline is **organically finished**, like any declared silhouette (spec 02 §9, ADR 0025). Left raw it reads as a surveyed polygon, strangely angular against every other coastline on the map.
- An outline **and** the dials together is an **error**. Honouring either means discarding the other, and a renderer that silently picks is the exact failure this phase exists to remove. Only pairs written on the *entity line* count — a `reach=` inherited from the vocabulary (`skerry : island reach=0.2`) is not a conflict.
- Fewer than three points is reported.

**A jut or bite declares a CENTERLINE.** Its shape is *not* self-contained: it has to join its host at two points and stay joined when the host moves, so an outline is the wrong lever. What it needs is intermediate controls — [#169](https://github.com/Nossimonov/Chartdown/issues/169)'s `via` — with `size=` and `taper=` continuing to give the width. This is a small generalisation rather than a new model: the geometry ADR 0025's neighbour introduced is already *half-width as a function of distance along a centerline*, and that centerline merely happens to be straight today.

## Alternatives considered

**More dials.** A fourth and fifth parameter buys a slightly better lozenge and never buys Whidbey. The dials are the right abstraction for the common case and the wrong one for the named case; this keeps both.

**One spelling for both morphs.** An outline on a bite would have to be re-joined to the host on every edit, and a centerline on an island means nothing. The split is not a compromise — it is what each shape can support.

**Absolute outline points.** Far nicer to author, and they leave the island behind when its host moves, which costs the feature the one property that distinguishes it from ordinary terrain.

**A warning rather than an error for outline-plus-dials.** Rejected on the owner's argument: a warning implies the render is still what the author asked for, and here it cannot be — something has been discarded.

**Author the landform as ordinary terrain.** Works today, and is what the exercise did for Whidbey. It costs the entity everything that makes it a placed feature: it no longer moves with its host, and it is back to a wall of absolute vertices.

**Do nothing, and say Chartdown draws schematic maps.** Defensible, and it would have to be said plainly in the vision doc because it decides what "accurate" is allowed to mean. Rejected: the language already promises that a named thing is declared data, and shape was the exception.

## Consequences

A recognisable landform can be a first-class entity — a stable id, `gm=`, `detail=`, promotion that does not move it, a pure function of declared data — which is what ADR 0023 promised and could not deliver for shape.

The short form stays the common case. Nobody outlines a mid-river islet, and nothing about the dials changes.

**Two ways to say a shape now exist**, and an author has to know which their feature can take. That is a real increase in surface area, mitigated by the fact that the wrong one is an error rather than a silent choice.

**Framed points are harder to author than absolute ones.** Tracing a real coastline means subtracting the anchor from every vertex, and nothing helps with that yet. The trade buys single-coordinate moves and host attachment; a tool that converts a traced absolute outline into a framed one would remove the sting and is not in scope here.

The centerline half is **not yet built**, so #169, #170 and #171 remain open. This ADR commits to the shape of their answer rather than delivering it: #170's arm currently draws *nothing at all* — not a feature facing the wrong way, an absent one — because a bite has no course for a hosted feature to attach to, and that is the same missing centerline.
