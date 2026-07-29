# 0017 — Openings may perforate declared terrain; `passes=` is a closed value set

- **Status:** Accepted
- **Date:** 2026-07-25
- **Issue:** #113

## Context

Spec 04 §1 defined an opening as "passage **through a barrier**," and spec 06 §3 placed openings on a structure's perimeter or in a freestanding `wall`. Underground, the most important doors are cut into neither: the Doors of Durin are a hole in a mountainside, the Great Gates a hole in the other one, and a mine adit or cave mouth is the same shape of thing. The only ground truth for solid rock is `earth`, which is `terrain`, and there was no way to put a door in terrain.

Authors therefore wrapped every cave mouth in a structure that existed only to give the opening somewhere to live. That asserts three false things — a built chamber where there is a natural cave, a *west wall* of that chamber where there is a mountainside, and, on UVTT export, `line_of_sight` segments for a wall that does not exist. At Moria's scale the workaround appeared about a dozen times.

Separately, `passes=` appeared in exactly two places in the spec (`door`, `window`) and nothing enumerated its values — while spec 06 §9's UVTT export is **normative** and reads it. Worse, the implementation never consulted the vocabulary facet at all: it read only the entity's own pairs, so the effective rule was *"closed unless the line literally says `passes=open`."* `door` and `window` came out right by accident; `arch : opening sight=all` — the commonest opening in any dungeon — exported as a **closed portal**.

## Decision

**An opening may be declared with no parent structure** where its edge separates a passable cell from a **declared impassable surface**. Spec 06 §5 now states outright that `earth` (and any word inheriting it, per [ADR 0016](0016-derivation-carries-word-keyed-behaviour.md)) is impassable — a sentence the spec had only ever implied, and one the `door-onto-void` lint of #80 needs to test against. Rooms **carve** the rock: a structure's footprint is floor even where `earth` was declared across it, which is what §5's "fills everything outside the rooms" means. An opening with passable cells on both sides, or impassable on both, is a fail-loud error naming the cell and edge.

The impassable boundary is an **occluder**: it contributes `line_of_sight` geometry and blocks light exactly as a wall does. This is the change that makes a cave system export correctly — previously it exported with no occlusion at all except where an author had faked walls.

**`passes=` becomes a closed set** — `open` | `closed` | `none`, with **`open` as the default** — enumerated normatively in spec 04 §1 with its UVTT mapping. Unlike `side=`, it cannot be open vocabulary: `side=` feeds themes, where an unknown value degrades to a default colour, while `passes=` feeds a normative transform where an unknown value has no safe degradation. The value now resolves **through the vocabulary chain** (entity pair → word facet → base word's facet), which is what makes the enumeration meaningful rather than decorative.

## Alternatives considered

- **Add a `rock`/`cliff` barrier word** and trace the mountainside with it. Rejected: it duplicates `earth`, which already declares the same rock as terrain, so an author would maintain two representations of one thing that can silently disagree — the failure spec 06 §6 rejected "fill to the river" to avoid.
- **Reclassify `earth` as a barrier** rather than terrain. Rejected: it is area-filling ground cover and behaves like terrain everywhere else (it layers, it takes `area`, it tints); reclassifying would change §5 semantics for every existing underground map.
- **Keep wrapping cave mouths in structures.** Rejected — it is the status quo, it misstates the fiction, and it emits wall geometry for walls that do not exist.
- **Leave `passes=` open like `side=`.** Rejected on the normative-transform argument above.
- **Keep the accidental "closed unless `passes=open`" default.** Rejected: it makes the commonest opening in any dungeon export as a shut door.

## Consequences

A cave mouth, adit, or shaft head is written where it is, and UVTT export becomes correct for underground maps in the direction that matters: rock occludes, gates are portals. `earth` acquires stated mechanical meaning, which #80's lints build on.

The costs are real and worth naming. **The default flip changes export output** for any opening with no explicit `passes=` — an archway that exported as a closed portal now exports as a hole. That is a fix, but it is a behaviour change, and it lands in a minor for that reason. **Impassable-surface geometry is now computed on every battlemap render**, since the boundary must be derived to know whether an opening is legal. And a third representation question is deliberately left open: a shaft head in a floor has no *vertical* barrier at all, so it is not covered here — that case belongs to #112.
