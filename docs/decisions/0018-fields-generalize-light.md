# 0018 — Ambient conditions are content; the vacant `light` archetype becomes `field`

- **Status:** Accepted
- **Date:** 2026-07-25
- **Issue:** #106

## Context

`light=<range>` was purely additive: any entity could emit, and props carried defaults, but nothing could say what the light level was **where nothing is emitting**. For a dungeon that is the wrong default in the most consequential way — the entire tactical identity of a Moria crossing is that it is pitch dark, and a renderer had no basis to draw a lamp as a pool in blackness rather than a glyph on a lit page. The same document held an open summit in daylight and a hall eight hundred feet down, with no way to express either. The UVTT export said the opposite of the document: `ambient_light` was hardcoded fully lit, so a lightless dungeon arrived in a VTT brightly lit with lamps sitting in it.

During review the owner asked that the *advanced* case be accounted for at the same time: a setting should be able to define its own ambient-light-like effects. Investigating that turned up a fact that changed the design — **`light` was already one of the nine closed archetypes** (spec 04 §1: "emits light; `range=`, `color=`") and **nothing had ever bound to it**. No standard-library word derived from it, no example, no renderer branch. The language had reserved a slot for "the thing that emanates" and never spent it.

## Decision

**Ambient condition is content, not presentation.** It states a fact about the place, exactly as an entity's `light=` does; spec 08 §6 already forbids themes from altering semantics, which is the same line drawn from the other side. The header key `light:` names it, with **one optional level qualifier** (`light celebdil: daylight`) — the first header key to take one, reusing the shape `[structures upper]` already establishes. Absent `light:`, behaviour is unchanged.

**The vacant `light` archetype is renamed `field`**, and the standard library ships `light : field`. The nine archetypes stay nine — a closed set worth protecting — and `radiation : field` reads correctly where `radiation : light` would claim radiation is a kind of light. A **field word** earns four affordances, each reusing existing machinery: an emitter parameter whose key is the field word, an ambient header key, a regional override (range placement plus a state), and theme subjects (`word` / `word.state`). Field **values are states**, which composes with #108's declared-states rule: any value renders, a declared one is documented and silent, a typo warns.

**`occluded=`** distinguishes fields that matter stops (`sight`, the default — what light does) from those it does not (`none` — antimagic, a radiation hazard). Without it every declared field would silently inherit light's occlusion. **`color=` is dropped** from the archetype row: it put appearance in content, nothing implemented it, and the theme owns colour.

The emitter-parameter namespace is therefore **derived from the vocabulary**: declaring `radiation : field` is what makes `radiation=40ft` meaningful.

## Alternatives considered

- **Let themes decide darkness.** Rejected: whether a chamber is dark survives changing themes, and spec 08 §6 exists to keep semantics out of themes.
- **A `dark` flag on entities.** Rejected: it inverts the common case — in a dungeon almost everything is dark and the exceptions are few, so flagging every room is the same failure as flagging every pillar.
- **Derive darkness from map type.** Rejected: one battlemap routinely holds both conditions, which is the ordinary case for any dungeon with a door to the outside.
- **A tenth archetype for fields.** Rejected once the vacant slot was found; spending a reservation beats growing a closed set.
- **Keep the archetype named `light` and derive user fields from it.** Rejected: `radiation : light` is semantically false, and the rename costs nothing because nothing was bound.
- **A generic `ambient:` mechanism** taking any field. Rejected as machinery where a word suffices: the emitter half already generalizes for free (`radiation=40ft` is an ordinary pair), and the ambient half costs one whitelisted header key per field, which is consistent with the closed header-key set.

## Consequences

A setting expresses radiation, silence, antimagic, blight, or sanctity in one `[vocab]` line with the same four affordances light gets — no renderer change and no spec change per field. UVTT exports finally carry the declared ambient, so a dark map arrives dark.

The costs, stated plainly. **Header-key validation is now deferred** to the end of parsing, because a field declared in a `[vocab]` section below is a legal ambient key and the header is read first — unknown keys still warn, just later. **A renderer must decide what to do with a field it has never heard of**; the spec's answer is geometry plus a theme lookup, degrading through spec 04 §4's fallback chain, with tracing-against-blockers a privilege for the field a renderer understands rather than a semantic difference.

And the one the owner named in review: **the abstraction must not reach the simple author.** The authoring surface for "I just want a daylit map" is byte-identical — `light: daylight`, `campfire : B2 light=20ft`, `light : fill=…` — and the rename, the stdlib line, and optional value declarations all sit below the waterline. That makes the cost purely one of *teaching order*, which is a binding constraint on the spec text: spec 06 §2 introduces `light:` concretely where a GM is already reading, and only spec 04 §1's archetype table and §5 carry `field`. Nobody meets the abstraction unless they want a second field.
