# 0021 — A map is the sum of its files; cross-document references are in scope

**Status: Accepted** (owner, 2026-07-25). Settles the question [#109](https://github.com/Nossimonov/Chartdown/issues/109) raised and deferred: *"worth an ADR on whether cross-document resolution is in scope at all, since spec 02 §8.1's order-bounding rule is stated within a single document."*

## Context

`detail=` points a parent entity at a sub-map. #109 made that pointer checkable by adding `detail-at=`, but stopped short of the reciprocal — the child declaring which parent it is a window onto — on the grounds that it would make a child document's meaning depend on an edit in another file.

That objection came from a reusability instinct: a component that depends on its consumer is coupled to it, and coupling is what decades of programming teach you to avoid.

**The instinct does not apply, because an inset is not a component.** A sub-map is not a reusable part that several maps might include; it is *a close-up at a unique point on one map*. There is exactly one Chamber of Mazarbul and exactly one place it belongs. Nothing is gained by keeping it ignorant of where that is, and something real is lost: the two files hold one geometry between them and neither can check the other.

The language already works this way elsewhere and did not notice. A theme document is meaningless alone; it describes a map it does not name. Asset references reach outside the file. **The map is the sum of the files that make it up, each contributing its own detail** — that is the model the format has had all along, and `detail=`/`inset:` is the case that makes it explicit.

## Decision

**Cross-document references are in scope, in both directions.** A parent may declare `detail=` and `detail-at=`; a child may declare `inset: <document> at <entity>`.

**The reciprocity is validated.** Where both documents are available, a disagreement between them is an error naming both files — a child claiming a parent that does not point back, an entity that does not exist, an anchor that contradicts. The relationship being declared twice is what makes it checkable at all; two declarations that can drift silently would be worse than one.

Order-bounding (spec 02 §8.1) remains a **within-document** rule. A cross-document reference is not resolved during parsing and cannot create a forward-reference cycle inside either file.

## Consequences

- A child document is no longer self-contained, and that is now a stated property rather than an accident. Opening `mazarbul.cd` cold tells you where you are.
- Checking either end can validate the seam, so the off-by-one #109 caught from the parent is equally catchable from the child.
- It unblocks the two things #109 left undone, both of which need the relationship known from both sides: **coincident walls across the seam** (the parent's `CP26.w` and the child's `C14.w` are one arch, so a door barred on one sheet is barred on the other) and **edge continuity** (a party leaving the child's west edge resolves to a parent cell instead of dead-ending).
- **Tooling must not assume one file is one map.** Anything that validates, renders or publishes a document may need its siblings — which the injected-sources design already anticipates: the parser reads no files, and callers supply what they have.

**Costs accepted:** a document can now be wrong because of an edit somewhere else. The fail-loud reciprocity check is the whole mitigation, and the reason the decision is contingent on it.

**Reversal condition:** if the validation proves unable to catch a class of drift in practice — two files that disagree and both check clean — the premise of this ADR has failed and the reciprocal declaration should go rather than the check.
