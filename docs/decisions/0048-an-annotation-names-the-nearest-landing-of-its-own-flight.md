# 0048 — An annotation names the nearest landing of its own flight, on every panel

- **Status:** Accepted
- **Date:** 2026-08-17
- **Issue:** [#321](https://github.com/Nossimonov/Chartdown/issues/321)

## Context

Spec 06 §8, from proposal [#112](https://github.com/Nossimonov/Chartdown/issues/112), is
explicit about what a connector's navigational annotation says:

> The annotation on each panel names the **next landing in the direction of travel**, not the
> far end — standing mid-flight, the step about to be taken is what matters.

`renderConnector` computes that value, comments at length on why it matters, and then prints
something else. `battlemap.ts:855` binds `shown`; `:872` interpolates `to`. `shown` is dead.

The symptom on the folder's three-level probe `s1-shaft-range.cd` — `levels: top mid bot`,
`stairs shaft : on t at A1 to=top..bot` declared on `top` — measured on `preview` @ `ab1690d`,
both modes identical:

| panel | drawn | §8 requires |
|---|---|---|
| top | `▼ top..bot` | `▼ mid` |
| mid | `▲ top` | `▲ top` ✓ (coincidence) |
| bot | `▲ top` | `▲ mid` — §8: *not the far end* |

Two levels cannot show this at all: with one hop, the next landing and the far end are the
same level, so every two-level document in the project is correct by degeneracy. That is why
the corpus has never caught it — `examples/fairwater-manor` is the only multi-level document
and all three of its connectors are single hops.

**There are two defects here, not one, and only the first is visible from the issue.** The
declaring panel prints the raw `to=` string because `to` is passed through verbatim
(`battlemap.ts:1942`). But the *reciprocal* panels are wrong for an unrelated reason: the
reciprocal call site (`battlemap.ts:394`) passes `source.level` as `to`, so every panel served
by that path names **the level the stair was written on** rather than anything about the
flight. On `s1` that is `bot`'s `▲ top`. On #112's own four-level test document, the `low`
panel's stair annotates three other panels and gets two of them wrong.

The decision cannot be deferred to new syntax. Nothing about the spelling is in question — the
sentence exists, the value is computed, and the renderer prints a different variable. What
*does* need deciding is what the annotation names in the two cases §8's sentence does not
reach, and both are reachable from documents that already parse.

## Decision

**A connector's annotation names the nearest landing of its own flight other than the panel it
is drawn on — on every panel, whether the connector is declared there or projected there.**

A flight's landings are derived from the declaration, in one expression:

> **landings = (every level the `to=` range names) ∪ (the level the connector is declared on)
> − (every level the `through=` range names)**

and the annotation names whichever of those is nearest the current panel in `levels:` order,
with the arrow following the direction.

Three clauses, each load-bearing:

- **∪ the declaring level.** A connector declared on `house` with `to=cellar` lands on both,
  but only one of them is in the `to=` value. Without this the reciprocal panel of an ordinary
  two-level map has no landing to name but itself.
- **− the `through=` range.** §8 already says a `through=` level is "occupied without opening
  onto … and no landing". A level with no landing must never be named as one, or the
  annotation directs the party to step off where there is no step.
- **nearest, not the range endpoint.** This is §8's existing sentence; it is what `shown`
  was computed for.

**Where a panel is equidistant from a landing above and a landing below, the annotation names
the one above.** This is arbitrary and is written down *because* it is arbitrary: an interior
panel of a shaft genuinely has two next landings, "the direction of travel" does not pick
between them, and an unstated tie-break is one that lives in array-iteration order and changes
when someone reorders a loop. Up is chosen because panels render topmost-first, so a reader
scanning the sheet has already passed the level being named.

**This decision moves rendered output.** Measured over the folder's cases and #112's own test
document, in both modes:

| document | panel | before | after |
|---|---|---|---|
| `s1-shaft-range.cd` | top | `▼ top..bot` | **`▼ mid`** |
| | bot | `▲ top` | **`▲ mid`** |
| | mid | `▲ top` | `▲ top` |
| `to=top..bot through=mid` | top | `▼ top..bot` | **`▼ bot`** |
| #112's four-level doc | top | `▼ pit` `▼ low` | `▼ pit` **`▼ mid`** |
| | mid | `▼ low` | **`▲ top`** |
| | low | `▲ top..pit` | **`▲ mid`** |
| | pit | `▲ top` `▲ low` | `▲ top` `▲ low` |
| `examples/fairwater-manor` | all three | unchanged | unchanged |

No annotation that was already correct moves. Every annotation that moves was wrong.

**The suite is 973/973 before and after the code change alone** — the five tests below take it to 977. Not one *existing* test notices a change that moves
six annotations across two documents — including `render.test.ts`'s *"the annotation names the
NEXT landing, not the far end of the flight"*, which asserts `/[▲▼] (top|low)/` on a panel
served by the reciprocal path and so passes on both the broken and the fixed renderer. That
test is the reason the defect survived #112.

## Alternatives considered

**Print `shown` and stop — the fix [#321](https://github.com/Nossimonov/Chartdown/issues/321)
itself proposes.** One character of diff, and it is the alternative I expected to take. Built
and measured, it is wrong in two directions:

- It does not satisfy the issue's own required table. `s1`'s bot panel stays `▲ top`, and
  #112's four-level document keeps `▼ low` on both `top` and `mid`. The reciprocal path never
  reaches the range logic, because `source.level` arrives as `to` and a single level name has
  no range to walk. Roughly half the wrong annotations in the table above are on that path.
- On `to=top..bot through=mid` it replaces a wrong answer with a **worse** one: `▼ top..bot`
  becomes **`▼ mid`**, and `mid` is the level the shaft passes through without opening onto.
  The annotation would name a landing that spec 06 §8 says does not exist, on a panel that
  correctly draws no landing at all. Today's raw-range output is at least visibly broken;
  this one is plausible and false.

Recorded first and at length because it is what the issue asks for, it is what a reader of
`battlemap.ts` will propose again, and neither failure is visible without running it.

**Pass the source connector's raw `to=` value at the reciprocal call site, and keep the
existing `span.length > 1` branch.** The obvious repair for the reciprocal half. It breaks
every ordinary two-level map: with `to=cellar` on the cellar panel, `levelSpan` is a
one-element span, the `else` branch takes `levels.indexOf("cellar")`, and the target is the
panel itself — `▼ cellar` drawn on the cellar panel, pointing at the floor it is standing on.
The `span.length > 1` branch is what has to go, not what has to be fed better; the declaring
level belongs in the landing set, and once it is there the branch has nothing left to decide.

**Draw both annotations on an interior panel** — `▲ top` and `▼ bot` where a shaft passes
through a level it lands on. This is arguably what a navigator wants and is the honest reading
of a panel with two next landings; the tie-break above exists only because we draw one. It is
rejected here as out of scope rather than as wrong: it is a rendering change with a layout
problem attached (both texts anchor at the same cell centre, `c.y + CELL * 0.72`), it moves
output on documents this issue is not about, and #321 is a bug about dead code. **This is the
clause of this ADR most likely to be revisited**, and a proposal is the way to do it — not a
later reader quietly widening the fix.

**Tie-break downward instead of upward.** Equally defensible — dungeons are descended, and
the interesting landing is usually the one below. Rejected on the weaker of two reasons and
the honest one is the weaker: upward is what the current implementation already produces for
`s1`'s mid panel, so choosing it moves no annotation for the tie-break alone and keeps the
measured delta to annotations that were provably wrong. If someone later prefers down, the
cost is one line and a superseding ADR, which is the right price for a coin-flip.

**Leave the reciprocal panels alone and fix only the declaring panel, filing the rest.** The
workspace rule is that an adjacent defect gets filed, not fixed, and this was tested against
it. It fails the test: this is not an adjacent defect but the same sentence of the same
section, misapplied on two code paths, and #321's own table already lists a reciprocal panel
(`cellar` → `▲ upper`, requires `▲ ground`) as part of the bug. Splitting it would leave a
filed issue that its own fix does not close.

**Do nothing.** The annotation is navigational and renders even under `labels: none` (§8) —
it is the one piece of connector text the spec refuses to let an author suppress, on the
grounds that a party needs it. A shaft is the case #112 was built for, and on a shaft it is
currently either a raw range expression (`▼ top..bot`, which is not a level) or the wrong
level. Rejected because the feature is worse than absent: an author who reads `▲ top` on the
bottom panel of a four-level stair has been told a fact, and it is false.

## Consequences

**Easier.** A shaft annotates correctly for the first time since #112 landed, on every panel,
and the `through=` interaction — the one that makes shafts worth having — is handled by
construction rather than by the accident of a one-element span.

**Harder.** `renderConnector` now takes the declaring level as a parameter, because it can no
longer be inferred from the value it is handed. Both call sites pass it and the reciprocal one
passes a *different* entity's level than the panel being drawn, which is exactly the kind of
argument that gets "simplified" to `levelCtx.level` by a later reader. It is commented at the
call site and pinned by a test.

**The landing-set expression is the clause most likely to be deleted as redundant.** Each of
its three terms looks superfluous from a different starting document: `∪ declaring level` looks
redundant when reading a `to=a..b` range that already includes it (as `s1` does), and
`− through` looks redundant on every document without a `through=`. Dropping either is silent
on most documents and wrong on the ones that matter. This is ADR 0046's level-filter problem
in a new place, and it is recorded for the same reason.

**Constrains.** The annotation is now a function of the *flight* rather than of the panel that
drew it, so anything that later wants a per-landing property — per-landing visibility, which
[#319](https://github.com/Nossimonov/Chartdown/issues/319) left open and which
[#124](https://github.com/Nossimonov/Chartdown/issues/124) has taken the obvious syntax for —
inherits this landing-set expression rather than inventing a second one. That is intended; two
definitions of "where does this stair stop" is the thing to avoid.

**A tie-break now exists in the spec that did not before**, and it is the first place in §8
where the renderer is told to pick between two equally correct answers. Written down it is
one sentence; unwritten it was an array-iteration order that no test pinned.

**Found while building, and it is the reason the tests in this change matter more than the
fix.** The corpus does not move and cannot: `fairwater-manor` is the only multi-level example
and every one of its connectors is a single hop between adjacent panels, which is precisely
the case that is correct by degeneracy. The empty corpus diff therefore means *contained*, not
*works* — the same reading ADR 0046 had to write down, from the same hole in the same example
directory. [#333](https://github.com/Nossimonov/Chartdown/issues/333) is already filed against
that hole; a multi-level example with a genuine shaft would have caught this the day #112
landed, and would catch the next one.
