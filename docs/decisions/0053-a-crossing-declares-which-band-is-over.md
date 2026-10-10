# 0053 — A crossing declares which band is over: the overlap hint is a facet, not a word

- **Status:** Accepted
- **Date:** 2026-08-31
- **Issue:** [#398](https://github.com/Nossimonov/Chartdown/issues/398)

## Context

`ford` and `bridge` entered the standard library to answer a rendering question. The maintainer's account of their origin is the whole of it: a road drawn across a river looked wrong, and the renderer needed a hint deciding **which band is drawn on top** — does the road pass over the water (a bridge), or the water over the road (a ford)? With the hint, the overlap can be drawn well every time. Without it, the renderer is guessing at every intersection.

The words were a good way to carry that hint, because a GM writing a map already reaches for them. But a word carries more than the job it was hired for, and these two acquired three others:

- **They became the gate on crossing-hood.** `gridplacement.ts:170` reads `chain.includes("ford") || chain.includes("bridge")` to decide whether `on <water> on <road>` resolves at all. Any other word is refused outright — `'on redford' names no cell on a battlemap` — including an unknown word, which spec 04 §3 permits outright — *"The word itself is **never inspected**"*. The form is not in question either: spec 06 §6’s table of which placement forms a grid answers has the row `on <ref> on <ref>` → *"a crossing, at the intersection of the two bands"*, with no condition on the word.
- **They became the test the §6 warning applies.** A road over water with no `ford` or `bridge` warns that the render implies a crossing.
- **They came to mean things.** A causeway is not a ford. A ferry, a culvert, a line of stepping stones, a lock, a weir with a plank across it — each is a real thing a GM writes, none is a bridge, and all of them cross water.

So an author whose crossing is neither must pick a word that is semantically wrong to obtain a hint that is orthogonal to it, and is otherwise told their placement names no cell. #398 measured all three symptoms from one document; changing `causeway : feature` to `causeway : bridge` cleared every one.

Underneath, the word is doing two unrelated jobs. **Is this a crossing?** is geometry. **Which band is over?** is a two-valued fact. Neither wants a word, and the language already says so elsewhere, twice. Spec 05 §4 separates them for coastal morphology in one sentence — **"`morph=` says what the geometry does; the word says what the thing is"** — so `cape`, `headland`, `peninsula` and `spit` are four words a GM can choose between for meaning, over one closed facet that decides what the geometry does. And spec 06 §3 says it for barriers: **"the facet decides and the word does not"**, which [#396](https://github.com/Nossimonov/Chartdown/issues/396) had to repair in the same week this was filed.

## Decision

**A crossing declares which band is over, with the closed facet `over=`, and the placement — not the word — is what makes it a crossing.**

Three parts:

1. **The placement shape resolves the geometry.** `on <water> on <road>` lands on the intersection of the two bands for **any** feature word, as spec 06 §6's resolution table already promises and spec 04 §3 requires of an unknown word. No vocabulary is consulted.

2. **`over=` decides the overlap**, with values `path` and `water` — the band that ends up on top. Only an entity carrying it, declared or inherited, **owns** the overlap and restyles the bands. An entity without it sits at the intersection and draws no deck, so `statue : on redford on tollroad` is a statue where the road meets the river rather than a crossing of it.

3. **`over=` satisfies the §6 warning.** The warning's real question is *"I do not know how to draw this overlap"*, so the thing that answers it is the thing that silences it. Its message stops naming `ford` and `bridge`.

The standard library declares the hint the words were invented to carry, and nothing else changes about them:

```chartdown
ford   : feature states=difficult over=water
bridge : feature over=path
```

Authors then say what a thing **is** and how it **stacks**, separately:

```chartdown
[vocab]
causeway : feature over=path       ; not a bridge, and no longer has to claim to be
culvert  : ford                    ; inherits over=water (ADR 0016)
```

**The default is `over=path`, applied silently.** The placement has already declared the intent to cross; a road continuing over water is the common case; and a wrong default is visible on the page and one word to correct. The two rulings here — the facet's name and this default — are the maintainer's.

Values are closed (`path`, `water`), so a typo is caught rather than silently defaulting, as `passes=`, `sight=` and `morph=` already are.

## Alternatives considered

- **Register `ford` and `bridge` as load-bearing words** in spec 04 §2's table and write the word requirement into spec 06 §6. The smaller change, and it makes the current behaviour honest — it is the other half of what [#401](https://github.com/Nossimonov/Chartdown/issues/401) proposes. Rejected because it *documents* machinery this decision *removes*: it leaves the author of a causeway with the same two bad options, and it entrenches a word as the carrier of a rendering hint at exactly the moment the project decided the opposite for barriers (#396).

- **Let the placement shape decide everything, with a fixed z-order.** `on <water> on <road>` always draws the road over the water; a ford becomes ordinary vocabulary with no hint. Simplest of all, and it fixes the refusal. Rejected because it discards the thing the words were created for: the renderer is back to guessing, and the ford — water washing over the road, the reason the hint exists — cannot be drawn at all.

- **A `crossing` archetype.** Give crossings their own archetype and let the archetype carry the behaviour. Rejected as heavier than the problem: the archetype list is closed at nine and deliberately small (spec 04 §1), the thing that varies here is exactly one bit, and a facet is what the language already uses for one bit attached to a placement.

- **Warn when a crossing states no `over=`.** More in keeping with [#376](https://github.com/Nossimonov/Chartdown/issues/376), which refused rather than guessed. Rejected as noise: it would fire on every hand-written causeway to report something the default gets right most of the time and that the author can see. Revisit if real documents show the default guessing wrong often.

- **Do nothing.** The author writes `causeway : bridge` and accepts the lie. Rejected: it is the state that produced #398, and it teaches that the vocabulary means whatever the renderer needed.

## Consequences

**Nothing breaks.** `ford` and `bridge` keep rendering exactly as they do, because the standard library now declares the facet they were standing in for. A document using an unknown word with `on <water> on <road>` previously errored and now resolves, which is addition rather than displacement — so this is **not BREAKING** under [ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md).

**Machinery is removed, not documented.** `ford` and `bridge` stop being load-bearing, so `isCrossing` no longer consults a word and #401 loses two of its rows. That is the useful shape of this decision: the registry got shorter by answering the question rather than by writing the answer down.

**A new closed facet is permanent surface.** `over=` joins `passes=`, `sight=` and `morph=`, and every future reader of the standard library has one more thing to know. That is the real price, and it is paid once. It also sets the precedent this decision should be judged by: **a rendering hint belongs in a facet, not in a word** — the next hint that arrives should not get a vocabulary word of its own.

**Themes gain a seam that needs watching.** The deck fill and the water fill currently follow the `isBridge` branch. They should follow the word's theme entry, with the facet deciding only stacking order — otherwise `over=` quietly becomes a colour switch and the separation this decision draws is undone from the theme side.

**One judgement is deferred rather than settled**: whether an entity with `over=` that is *not* placed on two bands means anything. Nothing in this decision gives it meaning, and it should stay that way until a document wants it.
