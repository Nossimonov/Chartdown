# 0050 — A pool that fills its field is reported, not redrawn

- **Status:** Accepted
- **Date:** 2026-08-09 (parked 2026-08-10, revived and renumbered 2026-08-21)
- **Issue:** [#290](https://github.com/Nossimonov/Chartdown/issues/290)
- **Builds on:** [ADR 0018](0018-fields-generalize-light.md), [ADR 0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md)

> **Why 0050, and why two numbers were skipped.** This began as 0045 on its branch. `preview`
> took 0045 for *A redaction is not the document* (#320) while this sat unmerged, and the index's
> rule is that whoever merges second renumbers. It was then **parked at 9999** on 2026-08-10 — a
> number outside the sequence, chosen so nothing could cite it as settled — because #290 was not
> expected to land soon and might never land.
>
> Revived 2026-08-21. `preview`'s highest is 0047, so 0048 reads as free and is **not**: 0048 is
> held by #321 on `issue-321-annotation-names-the-nearest-landing` with PR #337 open and green,
> and **0049** is held by the `Proposed` draft for #325 in `issues/via-cant-use-addresses/decisions/`,
> which is under review as this is written. Taking either would collide at merge — which is the
> exact failure that produced 9999 in the first place. **0050** is the lowest number no branch and
> no open draft has claimed.
>
> Re-check the number when the branch is cut and again when this is copied into
> `docs/decisions/`; a merge may take it while this sits.

## Context

[ADR 0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md) bounded everything a field draws to the map field of its own panel, and closed three of the four issues that came out of spec 04 §5's silence. It left one open on purpose, and said so:

> **[#290](https://github.com/Nossimonov/Chartdown/issues/290) is only half answered, deliberately.** Clipping the hole stops the wash being erased in the margin, but *inside* the field the hole is still the pool's own shape at full weight… That is a question about what a hole *means* rather than where it may be drawn, and it is not this ADR's to answer.

This is that decision.

The remaining case is small and ordinary. Six lines:

```chartdown
map: battlemap
grid: square 3x3
scale: 5ft
light : dark

[features]
lantern : B2 light=60ft
```

A `3x3` battlemap at `5ft` is a **15ft square room**. The lantern reaches 60ft. Rendered, the wash's mask is the field rect with an `r=384` hole in it — the hole covers the field, so the sheet carries no darkness anywhere, and a document that opens with `light : dark` renders as though that line were not there.

**The render is faithful.** A 60ft lamp does light a 15ft room, and spec 04 §5 fixes an emitter as a *pool of its range* cut into the wash — a model the renderer has followed since [#106](https://github.com/Nossimonov/Chartdown/issues/106) and which [#263](https://github.com/Nossimonov/Chartdown/issues/263) leaned on when it fixed `daylight`'s weight. Nothing here is a geometry bug: `60ft ÷ 5ft × 32 = 384`, and the field is 96 across. The arithmetic and the model both hold, and the sheet still contradicts what the author was picturing.

So the fault is not in the drawing. It is that **the document says two things that cannot both show**, and the renderer has to pick one silently. `check` passes, the map draws, and the author is never told which of their two declarations won.

## Decision

**A pool that fills its whole map field is reported, not redrawn.** The renderer draws exactly what it drew before — the pool at its declared range, the hole at the pool's shape and full weight — and additionally **WARNS**, naming the emitter and the field it erased.

This is the ruling spec 04 §5 already makes one bullet earlier, for [#287](https://github.com/Nossimonov/Chartdown/issues/287)'s ambient on a region map:

> Declaring one is not an error and the map still renders, but it **WARNS**: an author who writes `light: dark` is picturing a dark sheet, and silence would let them keep picturing it.

Every word of that applies here, so it is the same answer rather than a new one. The document is not wrong. The ambient it declares is not visible at the range it also declared, and only the author can say which of the two they meant — shorten the lamp, or drop the `light:` line. A renderer that chose for them would be guessing at content, which spec 04 §4 forbids for exactly this class of question.

The report is at **panel** granularity, because a level is a different place ([ADR 0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md)): a lamp that fills the cellar warns about the cellar and says nothing about the floor above.

## Alternatives considered

**A pool lightens the wash rather than deleting it** — cut the hole at partial weight so a dark map keeps a floor of residual darkness under every lit area. The most direct reading of [#290](https://github.com/Nossimonov/Chartdown/issues/290)'s own second point, and rejected on three counts. It contradicts the settled model that an emitter is *a hole cut in that wash*, which is load-bearing well beyond darkness. It moves **every** render of every map that declares an ambient, where this decision moves none. And it re-opens the inversion [#263](https://github.com/Nossimonov/Chartdown/issues/263) was filed for: once a hole is partial, the pool's appearance depends on the wash's weight, and a campfire on a `daylight` map becomes the brightest thing on the sheet again. A rule whose correctness has to be re-derived per ambient state is not one rule.

**Bright and dim rings — falloff.** The honest answer to "a hole should be the hole the light makes", and out of scope for a bug: `light=60ft` currently means one radius, and giving it two is a syntax change that goes through the proposal process (CONTRIBUTING rule 5), not a renderer fix. Recording it here so it is clear it was considered and deferred rather than missed.

**Clip the hole geometry to the field.** What [#290](https://github.com/Nossimonov/Chartdown/issues/290) asks for in its first point, and what the issue's own investigation expected to be the fix. Measured on `preview` after [#289](https://github.com/Nossimonov/Chartdown/issues/289) shipped, it is a **no-op**: the mask already carries `maskUnits="userSpaceOnUse"` with the field rect as its region, so SVG discards mask content outside the field without being asked. The change would be real bytes and zero pixels, and it closes nothing.

**Do nothing.** The status quo, and the shape of wrongness the bug template exists to catch: a document that checks clean and renders against itself. [ADR 0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md) is explicit that its own rule "binds the renderer, not the author… no diagnostic is added" — which is precisely why the author-facing half was left for here.

## Consequences

**No render moves.** Not one byte of SVG changes for any document, which is the strongest property this decision has and the reason it can ship without touching the corpus. No committed example declares `light:` at all ([ADR 0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md)), so nothing in `examples/` newly warns either.

> *Re-confirmed 2026-08-21 on `preview @ ab1690d`, before revival.* Of 17 `examples/**/*.cd`, none
> declares an ambient header. The single grep hit — `light : fill=#e8c98a` in
> `examples/ink-and-vellum.theme.cd` — is a **theme subject**, not an ambient, and cannot warn.
> The premise of this consequence therefore still holds; the *conclusion* is still unproven
> against this build, and the corpus sweep is the gate on accepting this ADR.

**A new warning is a compatibility surface.** Under [ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md) a clean document must keep checking clean, and a warning is not an error — `check` still exits 0. But a document that renders a filled field now prints a line it did not print before, and anyone grepping `check` output for silence will see it. This is the intended cost.

**The renderer has to answer "is any of the wash visible?", which is a coverage question, not a geometry one.** Union-of-shapes against a rect has no exact closed form the renderer can afford — `packages/render-svg` carries no runtime dependencies ([ADR 0007](0007-typescript-stack.md)) — so it is decided by sampling the field. That is a real limitation and it is admitted rather than hidden: a surviving filament of darkness thinner than the sample step goes unreported. The threshold is chosen so that what goes unreported is also what would not read as darkness on the sheet.

**It generalises with the vocabulary, as [ADR 0018](0018-fields-generalize-light.md) requires.** The rule is written for fields, not for light: a `radiation: heavy` map whose one reactor irradiates every cell gets the same report, in the same words, without the renderer knowing what radiation is.

**Falloff, if it ever lands, supersedes part of this.** A `light=` that carried a bright radius and a dim one would make "the pool fills the field" a less interesting condition, since the dim ring would still shade the edges. That would be a new ADR, and this one would narrow rather than fall — the report still has something to say about a field filled to its corners by bright light.
