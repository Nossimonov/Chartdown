# 0016 — Derivation carries behaviour attached to a standard-library word

- **Status:** Accepted
- **Date:** 2026-07-25
- **Issue:** #115 (settles #111; the theme half was the defect class fixed in 0.3.3)

## Context

Several spec sections attach behaviour to a **specific standard-library word** rather than to an archetype or a facet: spec 06 §5's level surfaces `earth`/`air`/`roof`/`terrace` (declared ground truth — what is solid, what is unfloored, what is a lower room's ceiling), spec 06 §4's `start` (staging zone), and spec 07 §2's `note` (free text, "a feature whose rendering *is* its text").

Spec 04 §2 promises derivation inherits "the base word's archetype, facets, states, and theme hooks." Word-keyed *behaviour* is none of those four. So `void : air` had no defined meaning: unfloored, or merely a terrain word styled like air? The spec did not say, in either direction — and the implementation answered inconsistently, matching some behaviours on the literal word (`note` in `[labels]`, opening appearance) and others through the chain.

The cost of silence was concrete. The Moria exercise **backed away from derivation near anything important**, using bare `air` for the Chasm of Khazad-dûm with a source comment explaining why, because guessing wrong would have made the map's largest geometry silently inert. That hollows out the escalation ladder (spec 04 §3) exactly where it matters most — a language whose central promise is that unknown and derived words always just work.

## Decision

**Behaviour attached to a specific standard-library word is inherited through derivation, exactly as archetype and facets are.** A word deriving from `air` is unfloored; a word deriving from `note` is free text; a word deriving from `start` is a staging zone. Renderers that match these behaviours on the literal word are **non-conforming**.

Two arguments carried it. First, it *extends an existing pattern rather than inventing one*: spec 04 §2 already promises theme hooks are inherited and spec 04 §4's fallback chain already says rendering walks "the base word's chain (for derived words)" — the rule generalizes what the language already does in the neighbouring case. Second, **inheritance is a broadly understood concept**, so authors can predict the answer without consulting the spec, which is the property that makes a rule cheap to live with.

The normative sentence lands in spec 04 §2, and spec 07 §2 gains the matching clause for `note` (#111).

## Alternatives considered

- **Not inherited — word-keyed behaviour matches the literal word only.** Rejected: it is the answer the implementation gave by accident, and it means the escalation ladder stops at exactly the words that carry machinery. An author who writes a textbook derivation gets a parse error citing a section that appears to permit it.
- **Say nothing and let each section decide.** Rejected: silence is the only outcome that cannot be authored against, and it demonstrably caused a careful author to avoid derivation entirely.
- **Make surface behaviour a declarable facet** (`void : terrain surface=unfloored`) instead of keying it to words. Attractive and more general — it would let a setting invent its own ground-truth kinds and makes the inheritance question answer itself. **Deferred, not rejected:** it is the right long-term shape and deserves its own proposal, but it is larger than this decision and this decision does not block it. Adopting inheritance now is forward-compatible with it.

## Consequences

One rule covers `earth`, `air`, `roof`, `terrace`, `start`, and `note`, and any behavioural word added later inherits it for free — which is also the constraint: **a spec section that attaches behaviour to a word is now committing to that behaviour being inheritable**, and should say so deliberately or use a facet instead. Renderers must walk the vocabulary chain wherever they currently string-compare; the 0.3.3 conformance batch fixed that class at the theme and opening call sites, and the remaining ones (`[labels]` free text, level surfaces) follow from this ADR. Because derived words now carry semantics, a typo'd derivation base is more consequential — mitigated by the existing fail-loud rule that a derivation base must already exist, and by the dead-declaration warnings of #116.

Two questions from #115 stay open and are **not** settled here: whether to add `void` as an underground-spelling sibling of `air`, and the discoverability table of which stdlib words carry machinery.
