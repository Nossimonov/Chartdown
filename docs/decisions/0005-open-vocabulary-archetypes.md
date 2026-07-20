# 0005 — The language knows no nouns: closed archetypes, open vocabulary, usage inference, theme-owned appearance

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #16 (spawned from #9)

## Context

The vocabulary is the language's most enabling and most limiting feature, framed by the project owner as the candyland test: grounding the model in medieval/fantasy terms works until someone maps a candy planet in 3742 — and the reverse failure is worse: "there can't be a wagon, because wagons aren't a well-defined concept in our universal map-model." Meanwhile some semantics are behavioral, not cosmetic (a window passes sight but not movement; UVTT export needs that with no theme in sight), so a fully open free-for-all loses real meaning. During review, a second question surfaced: whether unknown compound words should inherit from their last segment (`gumdrop-hills` → `hills`).

## Decision

Spec section [04-vocabulary-and-archetypes.md](../spec/04-vocabulary-and-archetypes.md), summarized:

- The language defines only **nine closed, setting-free archetypes** carrying behavioral semantics; every noun — including the shipped medieval-fantasy **standard library** — is unprivileged, shadowable vocabulary content.
- Vocabulary entries bind a word to an archetype **or derive from another word with overrides** (`licorice-forest : forest` — "treat it like a forest, but draw lollipops instead of trees"). Sources: standard library → `use:` imports → in-document `[vocab]`, later silently shadowing earlier.
- **Unknown words are legal and never fail**: archetype inferred from usage (shape token → section context → `feature`), rendering as a generic labeled glyph. The word's spelling is never inspected.
- Themes own all appearance behind a mandatory fallback chain ending at the archetype's generic shape + label; asset references live only in themes; themes cannot alter semantics or geometry.

## Alternatives considered

- **Closed standard vocabulary** — the failure the owner named; rejected as a matter of project identity.
- **No archetypes (fully generic words)** — loses behavioral semantics: no window sight rules, nothing for UVTT export, no theme hooks beyond string matching.
- **Vocabulary merged into themes** (Text Mapper's word = SVG model) — conflates meaning with appearance; maps must keep semantics across themes and with no theme at all.
- **Morphology/suffix inference** (`gumdrop-hills` inherits from `hills`) — rejected: fantasy naming is saturated with terrain words as proper nouns (Bakers-ford, Highkeep, Sparrowdown), so suffix matching renders silently wrong with no fail-loud moment. Word-derivation in `[vocab]` is the explicit one-line alternative.
- **Warning on unknown words by default** — punishes exploratory authoring; strict mode is opt-in.

## Consequences

- The candyland test passes at every rung of an optional escalation ladder: bare word → `[vocab]` line → shared `use:` library → themed art.
- The primitives sections become largely enumeration: filling the standard library in `[vocab]` terms.
- The archetype list is a bet, accepted with the owner's stance on record: "if more are needed we'll learn the hard way and adapt" — extension happens through spec sections, never through documents.
- Silent shadowing means a library can change a word's meaning under an unsuspecting document; accepted as the same deliberate-override philosophy as ADR 0004's duplicate names, with strict mode as the audit tool.
- Usage inference means shape and identity are orthogonal: a blob-shaped forest is a forest that happens to be round.
