# 0043 — An address form a slot cannot consume is refused, never quietly reinterpreted

- **Status:** Accepted
- **Date:** 2026-08-08
- **Issue:** [#281](https://github.com/Nossimonov/Chartdown/issues/281)
- **Builds on:** [ADR 0038](0038-a-placement-form-means-the-same-thing-on-every-map-kind.md), [ADR 0039](0039-an-archetype-name-is-grammar-not-a-type-word.md)

## Context

Spec 02 §5 makes two things addressable and gives one of them a job:

> Walls, doors, and windows live on cell **edges**. An edge or corner is a single token, `<address>.<dir>`:
> - Edges: `O6.s`, `N4.w` — directions `n e s w`.
> - Corners: `K5.nw` — directions `ne nw se sw`.

Corners are addressable and **nothing in the language consumes one**. No spec section gives a corner a meaning, and no committed example writes one. Rather than saying so, the renderer answers by accident, and the accident is silent in two different directions. Measured on cell `C3`, which spans x 88–120 and y 88–120:

| slot | a cardinal edge | a corner |
|---|---|---|
| freestanding barrier (`wall w1 : C3.e`) | drawn correctly | **all four corners draw the EAST edge**, `(120,88)–(120,120)` |
| structure detail (`door : at A1.n`) | drawn correctly | **the east edge**, so a door at `C3.nw` opens on the far wall |
| any other entity line (`statue s1 : C3.n`) | **renders byte-identically to an empty section** | same |

Two root causes, both a missing case rather than a wrong one. `edgeSegment` switches on `n`, `s`, `w` and returns the east edge from `default:` — so `"e"` is served by the fallthrough, correct by luck, and the four corners ride along with it. And the placement paths for features, tokens and terrain simply never look at an edge placement, so the line evaporates.

**Neither is a geometry error.** Both are the language failing to say that a slot cannot take what it was given.

## Decision

**An address form a slot cannot consume is refused where it is written. It is never reinterpreted as a different address, and never dropped.**

Concretely, and testably:

- **A corner token is refused wherever it appears**, naming the four cardinal edges. Nothing in the language consumes a corner, so there is no slot in which one can be honoured — and until a proposal gives corners a job, an author writing one has made a mistake that should be reported at the line they wrote.
- **An edge token is consumed where a wall lives**: a freestanding barrier, a structure detail's opening, wall state or barrier word. Everywhere else — a feature, a token, terrain, a zone — it is refused, naming the cell form.
- **`edgeSegment` handles `"e"` by name.** A `default:` standing in for a real case is how four tokens became a fifth; an unhandled direction must be a loud failure, not an east edge.

**Corners stay addressable in spec 02 §5**, and the section now says outright that no slot consumes one yet. That is the honest state of the language: the coordinate form exists, it is reserved, and the day something needs it — a post at a corner, a token facing a diagonal — a proposal gives it a meaning without re-litigating the address form.

This is [ADR 0039](0039-an-archetype-name-is-grammar-not-a-type-word.md)'s reasoning applied to addresses instead of words. There, a name the language is made of had no business in a type-word slot, and the fix was to refuse it by name rather than let inference guess. Here, an address form no slot consumes has no business being silently converted into one that is.

## Alternatives considered

**Give a corner a meaning.** The obvious candidates are a post or pillar at a cell corner, and a diagonal facing for a token. Both are plausible and neither is specified, so implementing one would be inventing behaviour the spec does not have — which CONTRIBUTING rule 2 forbids, and which is how the east-edge fallback came to exist in the first place. A proposal may still do this; refusing now does not foreclose it, and makes the moment it happens visible rather than silent.

**Remove corners from the grammar.** Honest about the present, and the cheapest thing to enforce: if the form does not parse, nothing can misread it. Rejected because spec 02 §5 is normative and defines the address form deliberately alongside edges, and because deleting a coordinate form is a larger break than refusing its use — it would also lose the vocabulary a future proposal needs.

**Let a feature on an edge place itself at the edge's midpoint.** A wall sconce is a real thing a GM wants, and `statue : C3.n` reads naturally. But it is an enhancement wearing a bug's clothes: nothing in the spec says a point-placed archetype may take an edge, and quietly making it work would put a second unspecified behaviour where the first one just came out. If someone wants sconces, that is a proposal, and a refusal is what makes them notice they need one.

## Consequences

**BREAKING under [ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md)**: a document writing `statue : C3.n` or `door : at C3.nw` checks clean today and will error. Both currently produce a map that contradicts the document — a vanished statue, a door on the wrong wall — so what breaks is a document that was already not getting what it asked for.

No committed example uses a corner or places a non-wall entity on an edge, so the corpus does not move.

The `default:` hardening is the part most likely to matter later. Four tokens became a fifth because a switch had somewhere convenient to fall; naming `"e"` means the next direction added to spec 02 §5 fails at the door instead of quietly becoming an east edge.
