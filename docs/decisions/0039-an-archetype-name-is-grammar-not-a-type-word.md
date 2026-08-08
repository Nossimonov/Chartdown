# 0039 — An archetype name is grammar, not a type word: using one as a type word is an error

- **Status:** Accepted
- **Date:** 2026-08-05
- **Issue:** [#266](https://github.com/Nossimonov/Chartdown/issues/266)

## Context

Spec 04 §1 defines nine archetypes — `terrain`, `path`, `feature`, `structure`, `barrier`, `opening`, `token`, `zone`, `field` — as the closed set of behavioral categories a document may not extend. Spec 04 §2 defines how a word acquires one: `word : <archetype>` binds, `word : <other-word>` derives. Neither section says what happens when an author writes the archetype name itself where a **type word** goes, and until now the implementation answered by accident.

The accident was bad. `VocabTable.archetypeOf` resolves a word by walking the vocabulary table, and an archetype name is never in it — archetype names are only ever the *target* of a binding. So `archetypeOf("opening")` returned `null`, the word fell through to §3's usage inference as though it were an undefined word, and the document rendered something else. In a structure detail the something-else is the exact inverse of what was written:

```chartdown
[vocab]
arch : opening sight=all

[structures]
cellar "Cellar" : M14
  arch : at A1.w              ; cuts the wall — an opening
  opening : at A1.w sight=all ; ADDS a wall segment
```

Two lines naming the same archetype, the same facet, and the same edge, drawing opposite things, with no diagnostic. The reachability lint compounded it: it counted the `arch` line and stayed quiet, so the `opening` line's inertness was invisible until the `arch` line was deleted, at which point a document that had been "working" started warning about a room nothing can reach. This is the silent-wrongness failure the project treats as its most serious class of bug — the map draws, `check` passes, and the result contradicts the source.

Something has to be decided because §3's promise ("a type word with no vocabulary entry anywhere is **legal**") and §1's closed archetype table both have a claim on these nine words, and they give opposite answers.

## Decision

**An archetype name is grammar. Using one as a type word is a fail-loud error.** Chartdown reserves the nine archetype names in the type-word position — on entity lines, on structure detail lines, and as the word being defined by a `[vocab]` entry. The archetype names remain legal, and only legal, on the right-hand side of a vocabulary binding.

The error names the fix:

```
'opening' is an archetype, not a type word — declare a word for it
('[vocab] arch : opening') and use that (spec 04 §2)
```

Reserving the *definition* position too (`[vocab] opening : opening`, `[vocab] terrain : feature`) closes the obvious way around the rule: a document that could shadow an archetype name with a vocabulary entry could reintroduce every problem above and take the diagnostic with it.

This narrows §3, and the narrowing is stated there: "unknown words never fail" governs words the language has no opinion about. It never covered the nine words the language is *made of*.

## Alternatives considered

**Archetype names resolve to themselves** — `opening : at A1.w sight=all` would mean the archetype with its defaults, and the two lines above would become equivalent. This is the least-surprise reading, it is what the author who filed #266 expected, and it is a one-line change to `archetypeOf`. It lost on appearance, which is not a cosmetic concern here: spec 04 §4's fallback chain terminates at "the archetype's generic shape + **the word as label**", so a bare archetype has no theme subject and would render the literal text "opening" on the map. A theme cannot style it without styling the archetype itself, which spec 08 §6 does not permit as a subject. The standard library also never does this — every one of its ~90 lines is `word : archetype`, including `light : field`, where using the archetype bare would have been shorter. A form the language's own vocabulary declines to use in ninety opportunities is not the form to bless.

**Warn instead of error, and treat the word as its archetype** — keeps every existing document rendering while saying something. Rejected because it takes the worst half of both options: authors get a diagnostic they can suppress by ignoring it, and the language acquires a second spelling for every archetype that themes still cannot address. Spec 04's warnings are for *recoverable* mistakes where a defensible default exists (an out-of-set facet value falls back up the chain, an undeclared state still renders). There is no defensible default here — the whole finding is that the two spellings mean different things.

**Do nothing** — rejected on the evidence in #266. Silence is the one answer that is certainly wrong, the same reasoning that refused `area` on a battlemap feature ([#207](https://github.com/Nossimonov/Chartdown/issues/207)): a construct that rendered as though it were absent gave the author no way to discover the loss but to notice an absence.

## Consequences

Authors get a diagnostic exactly where they used to get wrong output, and the message carries the two-line fix, so the escalation ladder of §3 is where they land rather than where they have to be told to look. Nine words move from "silently inferred" to "refused", which is a smaller behavioural change than it sounds: nothing in `examples/`, `docs/` or the standard library uses a bare archetype word as a type word, so **no existing document moves**.

The cost is that the language now has a reserved-word list, which it did not before, and "the language knows no nouns" ([ADR 0005](0005-open-vocabulary-archetypes.md)) acquires a footnote: it knows nine, and it will not let you use them as nouns. That is the honest shape of the tradeoff — the archetype names were always reserved in effect, since binding to them is what gives every other word meaning, and this decision only makes the reservation say so. A future spec section that extends the archetype table (§1 permits this) therefore extends the reserved list too, and MUST expect documents in the wild to be using its new word as ordinary vocabulary. That is a real migration cost this decision creates, and it argues for extending the table rarely.

This does not touch words correctly *bound* to an archetype: `hatch : opening` stays legal and is the sanctioned spelling. A separate defect in that path — such a word not inheriting its archetype's facets — is [#267](https://github.com/Nossimonov/Chartdown/issues/267) and is decided independently of this ADR.
