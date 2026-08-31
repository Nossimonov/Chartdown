# 0052 — A stair is a way in: `stairs` and `ramp` become load-bearing words

- **Status:** Accepted
- **Date:** 2026-08-31
- **Issue:** #301

## Context

Spec 06 §10's `unreachable-room` lint warns when a footprint has no opening on its perimeter and no connector inside it. It counted a connector only if the entity carried `to=<level>`, following spec 06 §8's rule that *any* feature carrying `to=` connects levels. `stairs` and `ramp` had no standing of their own — `stairs : feature` in the standard library, and nothing anywhere attaching meaning to the word.

On a multi-level document that is correct and sufficient. On a **single-level** one it cannot be satisfied at all. A cellar written the way a GM would write it —

```chartdown
[structures]
building cellar "The Cellar" : B2..F6

[features]
stairs up : on cellar at A1
```

— warns that nothing can reach it, and the two ways to silence it are to add a door the map does not have, or to add a `levels:` header and a second level for the stair to point at. Both change the map to satisfy a check, which is the wrong direction. There is no third option, because `to=` names a declared level and a single-level document has none to name.

The deeper problem is that the language had no opinion about what a stair is. `stairs` rendered as a glyph and meant nothing, so the lint had nothing to consult. That is the same gap ADR 0016 was written for, and #266 answered the same class by refusing a word rather than inferring meaning for it.

## Decision

**`stairs` and `ramp` join spec 04 §2's table of load-bearing words. A feature deriving from either, standing inside a footprint, is a way into that footprint — with or without `to=`.**

Being an **entrance** and being a **level connector** are separate facts, and only the second is what `to=` states. Spec 06 §8 is unchanged for connection: any feature carrying `to=` connects levels, `ladder : stairs` still works identically to `stairs`, and no word is privileged there. What is new lives in §3, where reachability is defined. The two rules meet only in that a stair carrying `to=` satisfies both, as it always did.

Because the behaviour is keyed to a standard-library word, ADR 0016 governs it: it is **inherited**, so `ladder : stairs` is an entrance too, and a renderer matching the literal word is non-conforming.

**`slope` is excluded**, though spec 06 §5 groups all three as traversable connections. A slope is a graded surface *within* one level — the standard library sorts it that way already, `slope : terrain` against `stairs : feature` and `ramp : feature` — and walking up one does not arrive from a storey the document never drew, which is the entire reason the other two count as entrances to a room with no door.

## Alternatives considered

- **Soften the lint instead: any connector-shaped feature inside a room suppresses the warning.** Cheaper — no ADR, no spec change, one predicate. Rejected because it leaves `stairs` meaning nothing in particular, which is the state that produced this bug, and the next word with the same problem needs the same patch again. It also has to define "connector-shaped" somewhere, which is this decision wearing a disguise and written down nowhere an author can read.
- **Do nothing; the warning is correct.** A room whose only entrance is a stair to nowhere is arguably an incomplete map. Rejected: the warning is unsatisfiable on a single-level document, and an unsatisfiable diagnostic teaches authors to ignore the diagnostics.
- **Infer a level.** Treat a `to=`-less stair as pointing at an implied storey. Rejected as the most invasive option, inventing declared content from an omission — against the language's own rule that extent is declared, never derived (spec 06 §5).
- **Make "is an entrance" a declarable facet** (`stairs : feature entrance`) rather than keying it to words. Genuinely attractive, and the same shape ADR 0016 deferred for surface behaviour. **Deferred, not rejected**, for the same reason and on the same terms: it is larger than this decision, this decision does not block it, and adopting the word-keyed rule now is forward-compatible with it.

## Consequences

A single-level map with a stair says what its author meant and checks clean. The lint keeps its teeth: a sealed room still warns, an ordinary feature inside a room is not an entrance, a stair outside the footprint does not count, and a stair on another level saying nothing about this one does not count either.

The cost is that spec 06 §8's "no word is privileged" is now true only of connection, and the section had to say so — a reader who remembered the old sentence and not the amendment would draw the wrong conclusion. This is the maintenance hazard ADR 0016 named when it said a spec section attaching behaviour to a word commits to that behaviour being inheritable; the load-bearing table exists so the commitment is discoverable, and this decision adds two rows to it rather than a special case somewhere only the renderer knows about.

Two rows is also the constraint: the table is now ten words, and it is the thing to check before attaching behaviour to an eleventh. The excluded `slope` is the useful precedent — the test is whether the word describes a **change of floor**, not whether the standard library files it near the ones that do.
