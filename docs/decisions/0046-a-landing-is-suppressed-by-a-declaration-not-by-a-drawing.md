# 0046 — A landing is suppressed by a declaration, not by a drawing: the far end yields to what the document said

- **Status:** Accepted
- **Date:** 2026-08-09
- **Issue:** [#319](https://github.com/Nossimonov/Chartdown/issues/319)

## Context

Spec 06 §8 gives a multi-level map one convenience: *"The destination panel shows the
reciprocal landing automatically unless an explicit connector is declared at that cell."*
Declare a stair once and both panels get their end of it; declare both ends yourself and the
automatic projection stands aside.

Spec 01 §6 gives it one guarantee: `player` mode is **fail-closed**, and `hidden` entities
are stripped before anything is drawn.

The two meet in the `occupied` guard at `battlemap.ts:378`, and there the guarantee eats the
convenience. The guard asks whether a connector is present in the *panel's rendered* entity
set — which player mode has already stripped. So a `hidden` connector is removed correctly,
the cell it occupied reads as empty, and the far end's projection immediately draws a stair
into it. **The strip removes the secret and the projection writes it back**, in the same
render, one loop apart.

That makes the failure an *addition*, not an omission, which is the hard direction:

```chartdown
levels: house cellar
[structures]
building house: A1..B2
stairs trapdoor : on house at A1 to=cellar hidden      # secret from above

[structures cellar]
building cellar: A1..B2
stairs trapdoor-below : on cellar at A1 to=house       # obvious from below
```

`chartdown render trapdoor.cd --mode player` draws **▼ cellar on the house panel** — the
secret trapdoor, on the players' sheet. `check` says `ok`. The GM render is correct. Only the
player render differs, and it differs by containing something *extra*, so nothing an author
looks at tells them the secret leaked.

The mirror is worse because it is silent. Mark the *cellar* end `hidden` instead and the
player output is byte-identical to the same document with the flag deleted — measured at
5186 bytes both, on `t2-visible.cd` and `t4-plain-near-hidden-far.cd`. The flag does nothing
whatsoever. That is [#295](https://github.com/Nossimonov/Chartdown/issues/295)'s signature —
a declared secret indistinguishable from never declaring it — reached down a different road.

This cannot be deferred to new syntax, because the double declaration **is** the spelling the
language already offers for one-sided secrecy, and §8's own word for the test is *declared*.
The language is not missing the feature; the renderer is asking the wrong question. And
[#124](https://github.com/Nossimonov/Chartdown/issues/124) has already claimed the
`hidden=<value>` slot that a bespoke "hidden from `<level>`" would want.

The exhaustive 2×2 over (near hidden?, far hidden?), plus both single-declaration cases, is in
#319. **No combination yields a one-sided secret today.** Either both panels show the
connector or neither does.

## Decision

**The reciprocal-landing guard reads the declared model; the projection source reads the
drawn one.** Spec 06 §8's *"unless an explicit connector is declared at that cell"* means
declared — a connector the document states at that cell suppresses the far end's projection
whether or not the current mode draws it.

The two halves of the rule read **different sets, on purpose**:

| Side | Set | Because |
|---|---|---|
| **Source** — does a connector on another level project a landing here? | **drawn** (stripped) | a hidden connector must project nothing anywhere; this is spec 01 §6 fail-closed and it already works |
| **Guard** — is a connector declared at the cell it would land on? | **declared** | this is §8's own word, and it is what makes each panel governed by its *own* end's visibility |

Each panel is then governed by the end declared on it. `hidden` on the house end hides the
trapdoor on the house panel and nowhere else; the cellar keeps its stair. The idiom means what
it reads as.

The guard's declared set is **filtered to the panel's level** before it is searched. That is
not incidental: the declared set spans the whole document, and the drawn set it replaces was
already per-panel (`index.ts:124`).

Mechanically this is one expression. The plumbing —
`LevelContext.declaredEntities`, built once per render — is already in the tree from
[ADR 0045](0045-a-redaction-is-not-the-document.md), which added it for the lints and said in
as many words that #319 would use it.

**This decision moves rendered output**, and that is the line it does not share with ADR 0045.
Measured over the folder's seven cases in both modes, exactly two renders move, both in
`player`, and both are the double-declaration idiom: `t3` (5187 → 4736) stops drawing the
secret on the house panel, and `t4` (5186 → 4736) stops being byte-identical to the document
with no secret in it. `t1`, `t2`, `t5`, `t6` and the three-level shaft `s1` do not move in
either mode; **GM mode does not move anywhere.**

## Alternatives considered

**Read the declared set on both sides.** The tidy symmetry — one set, one question, no
asymmetry to explain — and it is **catastrophically wrong**, which reading the code alone
would not have shown. Built and measured: `t1-hidden-near-end.cd`, a single `hidden` trapdoor
and nothing else, renders `▲ house` on the **cellar** panel in player mode (4217 → 4667), and
`t5`, hidden at *both* ends, draws the connector on **both** panels (4217 → 5118). A stripped
connector projecting a landing is spec 01 §6 fail-closed inverted: the secret is not leaked
onto one sheet, it is reconstructed on the other from the entity that was removed to keep it.
The asymmetry is the decision, not an artefact of it.

**Read the declared set on the guard, without filtering to the panel's level.** One clause
shorter, and it looks like a simplification because the declared set "obviously" contains the
right connectors. Measured: `t2-visible.cd` — a document with **no secrets at all** — loses
`▲ house` from its cellar panel (5186 → 4736), because the house's connector at A1 makes the
cellar's A1 read as occupied and suppresses the projection that was supposed to fill it. The
three-level shaft `s1` loses landings the same way (7443 → 6547). The drawn set being replaced
was already per-panel, so the filter is what preserves that; dropping it makes ordinary
multi-level maps lose stairs. Recorded because it is the mutation a later reader is most
likely to think is dead weight.

**Special-case the guard on the mode** — consult the declared set only when the mode is
`player`. Identical output, since in GM mode the declared model *is* the drawn one, so it is
strictly a way of writing the same behaviour with the mode named in it. Rejected because
naming the mode inside a geometry rule is the defect's own shape: it invites the next reader
to ask what *else* should differ per mode, and ADR 0045 has just finished removing exactly
that coupling one file away. The guard should not know what mode it is in.

**Stop stripping `hidden` connectors in `buildModel` and skip drawing them later instead.**
This would make both sides read one honest set and let the draw step do the withholding. Read
`model.ts:89-102` before rejecting it: the strip is a `break` out of the entity's construction,
so a hidden entity never acquires resolved placements, theme resolution, or an export record —
and that is what makes `player` fail-closed by *construction* rather than by a renderer
remembering to check. Every downstream consumer — UVTT export, occlusion, light, the lints
before ADR 0045 — would need its own check, and a consumer that forgets one leaks. Trading a
guarantee that holds by absence for a guarantee that holds by vigilance is the wrong direction
for a secrets feature. Rejected on the strength of the guarantee, not on effort.

**New syntax for per-landing visibility** — `hidden=<level>`, or a per-end flag on a `to=`
range. Rejected on three counts, in order of decisiveness. It is a syntax change, so it is a
proposal and not a bug fix (CONTRIBUTING rule 5). §8 already spells one-sided secrecy with the
double declaration, so this adds a second spelling for a thing the language can say. And #124
has claimed `hidden=<value>` for staged revelation, so the obvious spelling is not even free.
Worth noting the residue: with `to=<a>..<b>`, one-sided secrecy still means declaring a second
connector, which gives up the one-stair-one-id property
[#112](https://github.com/Nossimonov/Chartdown/issues/112) was built for. That is a real gap
and it is left open here rather than closed badly.

**Do nothing, and document the double declaration as unsupported.** Rejected because the
status quo is not "the feature is missing" — it is "the nearest correct attempt at the feature
ships the secret." An author who follows §8's invitation, declares both ends, and does not
diff the player SVG has published the trapdoor. Documenting a trap is worse than the trap
being unknown, because it certifies it.

## Consequences

**Easier.** One-sided secrecy is expressible, with syntax that already exists and reads as
what it means. A secret trapdoor can be secret from the house and plain from the cellar, which
is the ordinary case in a dungeon and was previously unavailable in any spelling — the
workaround was to hide it on both panels and explain the cellar in prose.

**Harder — and this is the real cost.** The reciprocal-landing rule now reads two entity sets
that differ, and a reader of `battlemap.ts` must hold both in mind to predict a panel. Before
this, "what is on the panel" had one input; now the answer depends on the drawn set for
*whether a landing projects* and the declared set for *whether it is suppressed*. Both call
sites are commented, and the wrong pairing is caught by a test in each direction — but this is
genuinely more to know, and it is the price of the two rules meaning different things.

**A `hidden` connector now has an effect the player render cannot show.** Its whole
contribution to the player sheet is to make a cell stay empty. An author diffing two player
renders to check that a secret is kept sees *nothing* in the place where the trapdoor is —
which is correct, and is also indistinguishable from the connector having been deleted. GM
mode remains the way to see what is there.

**Constrains.** `declaredEntities` now has two consumers with two justifications (lints, ADR
0045; this guard, here), so it is no longer removable by satisfying either one alone. Anything
else that must reason about *what the document said* rather than *what is drawn* should take
it and say why at the call site; anything reasoning about what is drawn — UVTT export,
occlusion, the projection source above — must keep the stripped set. The distinction is now
load-bearing in two files.

**Found while building, and recorded because the next reader will misread the evidence without
it.** All 34 corpus renders (17 examples × both modes) are byte-identical before and after, and the
58 corpus warnings are unchanged — but that is **not** evidence that this decision is safe, because
`examples/fairwater-manor` is the corpus's **only** multi-level document and neither of its two
connectors is `hidden`. **No document in `examples/` can express this defect at all.** The sweep was
shown to be capable of moving by mutation — dropping the guard's level filter moves
`fairwater-manor` in both modes and fails three pre-existing tests — so the empty diff means the
change is *contained*, not that it *works*. What shows it works is the seven-case matrix and the
five new tests. The corpus gap is a real hole in the project's regression cover and is worth an
example whose only entrance is a secret connector; that is a separate piece of work.

**Left open, deliberately.** Per-landing visibility on a `to=<a>..<b>` range still costs the
one-stair-one-id property (#112), because the only way to hide one landing of a shaft is to
declare a second connector there. This decision does not address it and does not foreclose it;
a proposal would.
