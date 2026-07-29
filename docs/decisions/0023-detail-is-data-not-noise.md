# 0023 — Detail is data, not noise: anything a story can attach to must be declared

- **Status:** Accepted
- **Date:** 2026-07-26
- **Issue:** [#93](https://github.com/Nossimonov/Chartdown/issues/93)

## Context

Matching a hand-drawn coast today costs hundreds of `via` points. The wall of coordinates is real, it is the most-reported friction on region maps, and the obvious remedy is to generate the detail: rough the spine, and a smooth eleven-point skeleton becomes a rugged coastline for free.

That remedy was **built and rejected**, on two grounds — one aesthetic, one fatal.

The aesthetic one: it did not look right. Applying the renderer's own `meander()` to a coastline produced generic fractal crenellation, and the *smooth* rendering read as by far the more Tolkien-like of the two. His coasts are sparse, deliberate features joined by long clean curves, which is what spec 02 §9's noise-free spine already draws. The generator made the map look less like the thing it was imitating.

The fatal one is the reason this is an ADR rather than a rejected experiment. **A fantasy map's dozen unnamed peninsulas and mid-river islets are where play happens.** Empty space is space for stories, and those unnamed features are *prone to becoming named*: a player is intrigued by the island in the river, and a character claims it. If that island was a byproduct of "meander the river a bit," its existence is tenuous — one seed change, one parameter tweak, one renderer version, and it is gone. It was never a thing. **A map exists to hold what stories attach to, and noise cannot hold anything.**

The owner's framing, recorded because it names what this is for: *determinism in details is arguably what distinguishes this tool from every other approach to AI-assisted map building.* A generated map that reshuffles under regeneration cannot accumulate a campaign's history. One whose every feature is declared data can.

## Decision

**Chartdown does not generate features. It generates only finishing.**

The distinguishing test is: **would anyone ever name it?**

- A **feature** is anything a story can attach to — a cape, a cove, an island, a peak, a confluence. It must be **declared**, and therefore **addressable, persistent, and promotable**. It may carry an id, a name, a `gm=` note, a `detail=` sub-map. It is a pure function of the data that placed it (kind, anchor, size), independent of `seed:` and of every other entity, so it never drifts under an unrelated edit.
- **Finishing** is the texture that makes a declared shape read as hand-drawn rather than plotted — the wobble along a wood's edge, the spline through a river's controls. Nobody names a bump on a forest boundary. Finishing may be generated, must be deterministic given the seed, and must never *create* something a reader would take for a feature.

Two corollaries the implementation is bound by:

**Promotion is geometry-stable.** Adding an id or a name to an anonymous feature MUST NOT move it. `island : near coast at (95,250) size=8mi` and `island himling "Himling" : near coast at (95,250) size=8mi` render identically. Naming adds a story, not a shape — otherwise the moment a feature earns a name, the map changes under the campaign that named it, which is the same failure as generating it in the first place.

**A coastline may not cross itself.** Where a placed feature deforms its host spine, the renderer MUST keep the curve simple. Clamping the amplitude until the result verifies non-self-intersecting is acceptable; failing loud because a feature is too large for its stretch is acceptable. Silently drawing a crossing is not — a map that folds over itself is wrong in a way no reader can repair.

## Alternatives considered

**Generate roughness on the spine.** Built, measured, rejected — see Context. It is worth recording that this was not rejected on taste alone; the persistence argument would stand even if the output had looked perfect.

**The wall of `via` points (status quo).** Rejected, but not because it is verbose. A bare vertex is **not a nameable thing**: you cannot hang a `gm=` note or a `detail=` map on "the third wiggle." The status quo does not merely cost keystrokes, it produces coastlines with no features in them at all — only geometry.

**Do nothing beyond spec 02 §9's smooth curve.** Rejected as leaving the wall in place. But §9 itself is **affirmed, not revised**: the connecting curve stays a noise-free spline through the declared controls, and placed morphology is a discrete layer on top of it.

**Draw the line at "generated is never allowed."** Rejected as too strong, and it would contradict shipped behaviour. Issue [#96](https://github.com/Nossimonov/Chartdown/issues/96) organically finishes terrain area outlines, and that is the *complementary* case rather than a counterexample: a wood's edge is texture. The existing gate already encodes this line — organic finishing is refused for `[water]` sections and for any outline with `along` spans, so coasts and feature-following borders stay literal. Under this ADR that gate is not an implementation detail but the boundary itself.

## Consequences

**Easier:** a coast gains features at roughly one line each, and every one of them is a thing — pointable-at, annotatable, promotable. A proof of concept placed seven features on an eleven-point spine and produced sparse deliberate detail on clean curves from **eighteen addressable entities rather than four hundred vertices**. Campaign history can accumulate against those entities safely.

**Harder, and accepted:** the renderer takes on a geometric obligation it did not have. Deforming a spine locally while guaranteeing the result stays simple is real work, and the failure mode is visual rather than diagnostic — which means this feature cannot be verified by tests alone and must be reviewed by eye, in rounds. It was sequenced late in Phase 4 for exactly that reason.

**A limit worth stating:** this ADR makes the *language* responsible for every feature, which means an author who wants a genuinely rugged coast still writes a lot of lines. That is the trade, taken deliberately: fewer features that persist beat many that do not. If the line count becomes the dominant complaint, the answer is better authoring ergonomics — not a generator.

**Constrains:** any future proposal to synthesise map content is measured against the naming test above. Generating a *texture* is open; generating a *thing* requires a new ADR superseding this one, and an answer to what happens to the campaign that named it.
