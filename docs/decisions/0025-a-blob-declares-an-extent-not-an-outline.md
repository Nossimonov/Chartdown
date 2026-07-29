# 0025 — A blob declares an extent, not an outline

- **Status:** Accepted
- **Date:** 2026-07-26
- **Issue:** [#173](https://github.com/Nossimonov/Chartdown/issues/173)

## Context

`blob <center> size=<measure>` let the renderer **invent an outline** and presented it as the entity's shape. Everything downstream then treated that invention as geometry: the footprint terrain is clipped to, the polygon a reference resolves to, the boundary `along` follows, the area a label is fitted inside.

The outline was fourteen points of radial jitter keyed on `(document seed, radius, id-or-word, ordinal among same-size siblings)`. Measured on `0.4-dev` at 8db5f18:

- **Naming a blob reshaped it.** Spec 05 §4 states the opposite rule for placed morphology — *"naming adds a story, not a shape"* — and [ADR 0023](0023-detail-is-data-not-noise.md) makes it a guarantee.
- **Swapping two lines in the file swapped two islands' outlines**, in different places on the map, with nothing else changed. Document order was load-bearing geometry.
- **Resizing redrew rather than resized.** From `size=40mi` to `41mi` the drawn extent moved 5.9% in x and 11.8% in y.
- **An unrelated `seed:` header reshaped every blob on the map.**
- **`size=` was not the size.** Three `size=40mi` blobs measured 42.5, 42.0 and 41.6mi across.

That last one is the sharpest, because spec 05 §4 already forbids it in terms: *"it makes `size=` a lie: the same 90mi cape would come out different lengths on different stretches of coast, so the number in the document would stop determining what is on the map."* The language was carrying two opposite contracts on one `size=` pair — enforced by a fail-loud error on one path and violated silently on the other.

Underneath the five symptoms is one mistake, and [#96](https://github.com/Nossimonov/Chartdown/issues/96) had already drawn the line it crosses: *"a wood's edge is texture, which may be generated; a cape is a feature, which may not."* `blob` generated the **silhouette**, not the texture. Practically, you could not put a harbour on an island's south shore, because there was no south shore until the renderer ran and it would be somewhere else next release.

## Decision

**A `blob` declares an extent.** `blob <center> size=<measure>` is a round mass measuring **exactly** `size=` across, organically finished.

The finishing is **texture the renderer owns and nothing may reference**, and it is a pure function of **the word and the extent** — carrying no document seed, no identity, no position, and no ordinal. The declared extent survives the finishing by construction: the boundary is perturbed inward only and the result is fitted to the declared measure, so `size=40mi` measures 40mi and the perturbation is free to be as organic as it needs to look without ever changing what the number means.

The same generator, and the same contract, now serves detached placed features, whose `size=`/`reach=` were overshooting by a few percent on the one path whose spec text promises exactness.

The spelling does not change, so no document needs editing.

## Alternatives considered

**Remove `blob`; declare points with `area`.** Honest, and it kills sketch-level authoring — a forest becomes eight typed coordinates, the wall of coordinates [#93](https://github.com/Nossimonov/Chartdown/issues/93) existed to remove, against a premise Vessany is built on: *the author sketches, the renderer draws*.

**Fix the keying only** — make the jitter a pure function of `(word, size)` and leave the shape a jitter. Fixes three of the five symptoms and leaves `size=` a lie, which is the one the spec already forbids elsewhere. A half-measure.

**Rename it** (`mass`, `extent`, `around`). If the semantics change materially, "blob" arguably invites the very reliance being removed. Rejected on churn: spec, grammar, digest and three examples, for a readability gain, when the definition now says plainly what it is.

**Do nothing.** Leaves the contradiction with 05 §4 in the language, and every island drawn with `blob` remains something a campaign can name and annotate but not rely on.

## Consequences

`size=` means one thing everywhere. A blob is promotion-stable, order-independent, position-independent and seed-independent, so the edits that used to silently redraw a named landform no longer can.

**`seed:` gets narrower, visibly.** It now re-rolls only what an author declared no dimensions for — an `area`'s roughening — so a document whose shapes are all extents renders identically under every seed. Vessany is such a document, and its render is now seed-invariant. That is the fix rather than a gap in it, but it does mean `seed:` does nothing on some maps where it used to do something, and the spec says so.

**Two same-word masses of the same size are twins.** ADR 0023 already took this trade for detached features on the same reasoning — it is the honest consequence of two identical declarations, and the escape is to differ the size. It is a real loss on a map with several same-size islands.

**Every existing blob render changes shape once.** Three examples use it (sundered-reach ×12, vessany ×2, gumdrop-vale ×1); no sources needed editing.

What this does **not** solve is [#172](https://github.com/Nossimonov/Chartdown/issues/172): a feature still cannot say what it actually looks like, and `size=` buys a *dependable* extent rather than a recognisable shape. This decision deliberately makes the short form honest instead of making it expressive, and leaves the question of a declared outline open — which is the right order, because an outline is an addition to a language whose extents can be trusted and a rescue of one whose extents cannot.
