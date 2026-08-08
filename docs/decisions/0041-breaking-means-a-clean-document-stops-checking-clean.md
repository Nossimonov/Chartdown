# 0041 — Breaking means a clean document stops checking clean; breaking work rides `preview`

- **Status:** Accepted
- **Date:** 2026-08-08
- **Issue:** [#273](https://github.com/Nossimonov/Chartdown/issues/273)
- **Supersedes:** the `0.4-dev` lane described in CONTRIBUTING.md

## Context

CONTRIBUTING.md has said, since Phase 4 opened, that `preview` must stay **releasable as a patch at all times** and that anything breaking lands on a `0.4-dev` lane instead. That is no longer what happens, and has not been for some time:

| | |
|---|---|
| `0.5.0` (2026-08-02) | shipped **three** items marked BREAKING — [#248](https://github.com/Nossimonov/Chartdown/issues/248), [#239](https://github.com/Nossimonov/Chartdown/issues/239)/[#238](https://github.com/Nossimonov/Chartdown/issues/238), and [ADR 0038](0038-a-placement-form-means-the-same-thing-on-every-map-kind.md)'s reversal — all through `preview` |
| `0.4-dev` today | 82 commits behind `preview`, **0 ahead**, last touched 2026-07-28 |
| `preview` today | carries a BREAKING entry again ([#266](https://github.com/Nossimonov/Chartdown/issues/266), merged 2026-08-08) |

So the lane is empty, stale, and bypassed, while the rule naming it is the first thing a contributor reads when deciding where to target a breaking PR. [#273](https://github.com/Nossimonov/Chartdown/issues/273) was opened by the contributor it misdirected.

**The deeper problem is that "breaks existing documents" was never defined.** The rule turned on a phrase, and the phrase was interpreted by reading changelog entries and inferring the pattern. That inference is not reliable: reviewing these very issues, a change was classified BREAKING on the reasoning "something that did nothing now does something" — which sounds right and is wrong, because `0.5.0`'s own [#259](https://github.com/Nossimonov/Chartdown/issues/259) and [#252](https://github.com/Nossimonov/Chartdown/issues/252) are exactly that shape and shipped as fixes. A definition that has to be reverse-engineered will be reverse-engineered differently by each person who needs it.

## Decision

**A change is BREAKING when a document that used to check clean stops checking clean, when a declaration's meaning changes, or when a shipped tool changes a default or a contract. Nothing else is.**

The test is deliberately about the *document*, not about the picture. Every BREAKING entry shipped so far satisfies it, and the near-misses that shipped as fixes do not:

| change | breaking? | why |
|---|---|---|
| [#266](https://github.com/Nossimonov/Chartdown/issues/266) — a bare archetype word becomes an error | **yes** | a clean document now errors |
| [#248](https://github.com/Nossimonov/Chartdown/issues/248), [#239](https://github.com/Nossimonov/Chartdown/issues/239)/[#238](https://github.com/Nossimonov/Chartdown/issues/238) — unsiteable placements become errors | **yes** | same |
| [#207](https://github.com/Nossimonov/Chartdown/issues/207) — a battlemap feature with a drawn shape becomes an error | **yes** | same |
| [#121](https://github.com/Nossimonov/Chartdown/issues/121) — a staging zone has one spelling | **yes** | other spellings stop working |
| [ADR 0038](0038-a-placement-form-means-the-same-thing-on-every-map-kind.md) — `extent` may be derived | **yes** | a declaration's meaning changes |
| [#199](https://github.com/Nossimonov/Chartdown/issues/199) — `--fill` defaults to 0 | **yes** | a shipped tool's default changes |
| [#263](https://github.com/Nossimonov/Chartdown/issues/263) — `light: daylight` 0.82 → 0.20 | no | every such map is repainted, and every one still checks clean |
| [#259](https://github.com/Nossimonov/Chartdown/issues/259) — dropped `via` controls now shape the course | no | the drawing starts matching what the document already said |
| [#252](https://github.com/Nossimonov/Chartdown/issues/252) — discarded `[labels]` overrides now apply | no | same |

**A large visual change is not breaking.** A map may look completely different after a fix and still be the same document saying the same thing; that is what a *renderer* bug being fixed looks like. Conversely a one-word diagnostic change is breaking if a document that passed now fails, because that is what a *language* change looks like. The severity of the diff is not the question — whose promise was broken is.

**Breaking work rides `preview` into the next minor.** The `0.4-dev` lane is retired. It was created for a specific Phase 4 problem, its content reached `main` long ago, and its rule has been bypassed by every breaking change since. The "revert the revert" note is preserved as history rather than instruction: it describes a one-time operation that has already been carried out.

**What replaces "releasable as a patch at all times":** `preview` is releasable at all times, as a **patch when its `[Unreleased]` section carries no BREAKING entry and as a minor when it does.** The changelog is what says which, so the question is answered by reading the repository rather than by remembering the state of a branch — which is the property the old rule lacked and the reason it failed silently.

## Alternatives considered

**Refresh the lane and keep the discipline.** The constraint had real value: with it, a patch can always be cut without triage. Rejected because it costs a permanent second integration branch to buy an option that has been exercised zero times in two minors, and because it failed in the way unenforced rules fail — silently, while everyone did something else. `main`-only-from-`preview` is the counter-example: it survives because `gatekeeper` fails the PR, and nothing comparable can enforce a lane rule without knowing what "breaking" means, which is the very thing that was undefined.

**Define breaking by semver on the packages instead.** Tempting, and wrong for this project: the published surface is a *language*, and a parser change can be entirely additive to the TypeScript API while making thousands of documents error. The document is the interface.

**Say nothing and let the changelog carry it.** What happens today. It costs each reader an archaeology exercise and produces different answers, twice observed within one week.

## Consequences

`preview` may now legitimately carry breaking work, and does. The next release from it is a **minor**, and anyone can determine that by looking for BREAKING in `[Unreleased]` rather than by asking.

**A patch release from a `preview` carrying breaking work is no longer possible without cherry-picking.** That is the cost of retiring the lane and it should be paid consciously: an urgent fix shipping while a breaking change sits unreleased needs a branch from the last tag, not from `preview`. Named here so the next person meeting that case recognises it as known rather than as a bug in this decision.

The definition binds the changelog entry, not the merge. An author marks an entry BREAKING by the test above; nothing in CI enforces it, and this ADR does not pretend otherwise. What it removes is the ambiguity that made two reviewers reach different answers about the same change.

The `0.4-dev` branch is left in place, unreferenced, rather than deleted — deleting it would strand the revert note's history, and it costs nothing to keep.
