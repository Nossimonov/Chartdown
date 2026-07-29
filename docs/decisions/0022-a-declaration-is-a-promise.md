# 0022 — A declaration is a promise; the file that made it for this map is the one that is checked

- **Status:** Accepted
- **Date:** 2026-07-26
- **Issue:** [#116](https://github.com/Nossimonov/Chartdown/issues/116)

## Context

Spec 04 §3 promises that **unknown words never fail**. That promise is about *authoring freedom*: an author who writes `gazebo : F4` without ever defining `gazebo` gets a sensible default and an unblocked render, because the language knows no nouns and refuses to make you declare one before you can draw.

That promise has silently been read as a second, much larger one: *a declaration that matches nothing never warns.* These are not the same thing. The first protects an author who **never promised anything**. The second protects an author who **promised something and got nothing** — and that is not protection, it is silence about a broken promise.

The cost is on record. Every bug in the 0.3.3 conformance batch was invisible for this reason: the fallback chain produced something plausible and nothing warned. The Moria exercise shipped a theme with **19 of 80 entries inert** and the author found out by reading the render. Issue [#103](https://github.com/Nossimonov/Chartdown/issues/103) puts the failure mode plainly — it is "worse than nothing: an unstyled generic marker would at least be visible." A misspelled `mountian : fill=#ff0000` is a perfectly legal line that styles, derives, and validates nothing, and today it says nothing.

The reason this needed a decision rather than an implementation is that the obvious rule is wrong. A theme and a vocabulary library are **deliberately reusable**: a shared theme styles words no single map uses, and a library exists to offer more words than any one map spends. Warning on everything would make the noisiest documents the best-written ones.

## Decision

**A declaration that matched nothing warns — in the file that made it, for this map.** The unit of scope is not the declaration kind but the *relationship* between the file and the render:

| Checked | Not checked |
|---|---|
| The **selected theme** — the one chosen for this render | Themes it inherits through `use:`, and the built-in default |
| The document's own **`[vocab]`** section | Words from `use:`-imported vocabulary libraries |
| — | A **vocabulary document's** own words: they are its product, not its spending |

The line is *"was this written for this map?"* A file written for this map and doing nothing in it is a broken promise. A file written to be reused is doing exactly its job when a given map spends only part of it.

Four warnings follow, all warning-level and never errors, consistent with spec 01 §3's unknown sections and with the typo-hole-closing history in spec 03 §5 and spec 02 §8.3:

- a `[theme]` entry whose subject styles zero entities in this document;
- a `[theme]` entry whose subject *is* styled but whose **properties are never read for it** — `glyph=` on a battlemap's area terrain, which is filled rather than marked. These are different author mistakes and get different messages: one says "no entity resolves to it," the other "the property does not apply to this kind of subject."
- a `[glyphs]` entry no `glyph=`/`asset=` in any layer references;
- a `[vocab]` word this document never carries and never derives from.

**Liveness is measured per property, not per subject.** The default theme and the user's may both carry a `water` line, and the merged record holds both their pairs; asking only "was `water` touched?" would call a dead `glyph=` live because the default's `fill=` was read.

**Which theme is "selected" needs no calling convention.** Spec 08 §5's shadowing requires the theme chosen for this render to be merged *last*, or its own entries would lose to the ones it inherits. Last-in-the-layering and selected-for-this-render are the same position by necessity.

## Alternatives considered

**Do nothing — keep spec 04 §3 covering both readings.** Rejected on evidence rather than principle. This is the status quo that shipped 19 inert theme entries and an entire conformance batch of invisible bugs. "Unknown words never fail" survives intact under this decision: an undeclared word still renders, still needs no definition, and still warns about nothing. What changes is only the case where the author *did* write a declaration.

**Warn on every non-default source, including inherited themes and imported libraries.** Rejected because it inverts the incentive: the author of a well-factored shared theme would see a warning for every word this particular map does not use, and the only way to silence it would be to stop sharing. Correct-by-design output must not be reported as a defect — the same reasoning that killed three false positives in [#123](https://github.com/Nossimonov/Chartdown/issues/123).

**Gate everything behind a `strict` flag, silent by default.** Rejected as the most plausible-looking wrong answer. The motivating bugs were all found *by reading a render*, which is precisely what happens when the diagnostic is off by default: the author who most needs the warning is the one who does not know to ask for it. A warning that costs a line of output and blocks nothing does not need an opt-in. (A `strict` input that makes `verify` *fail* on these remains open and is a separate question — that one does need opting into.)

**Warn only for a misspelled subject, not for an inapplicable property.** Rejected once the property case turned up on its own during implementation: a fixture written as a *negative* — `water : glyph=…`, expected silent — warned, correctly, because a battlemap's area terrain is filled and never asked for a glyph. That is the same class of dead promise wearing a different shape, and dropping it would have kept exactly the bug the issue was filed about.

## Consequences

**Easier:** the failure mode this phase has spent its length removing — a document that says one thing while the render does another, with no diagnostic — loses its last large hiding place. A theme author now learns at `check` time what they learned before by squinting at a render.

**Harder, and honestly so:** diagnostics now carry a line number belonging to a *different file* than the document being checked. `Diagnostic` grew an optional `source` field and the CLI resolves it against the theme path, because a warning that points at line 22 of the wrong file is worse served than no warning at all. Any consumer that formats diagnostics — the action, the Obsidian plugin, the MCP server, the playground — now has a field it can get wrong.

**A real limit:** theme liveness is measured by what the render *asked for*, so it is only as complete as the render. A property consulted on one code path and not another is live if any path ran. Rendering one level of a multi-level battlemap, or a player-mode render of a GM-only entity, can leave a genuinely useful entry looking dead. This is why these are warnings and why there is no suppression syntax yet: the first real false positives should argue for the shape of the escape hatch rather than have it guessed in advance.

**Constrains:** if a `strict` mode is added later (issue #116 raises it, and `verify` is the obvious home), it inherits this scope rather than redefining it. Widening the scope to inherited files would need a new ADR superseding this one, and would need an answer to the shared-theme incentive problem this decision was written to avoid.
