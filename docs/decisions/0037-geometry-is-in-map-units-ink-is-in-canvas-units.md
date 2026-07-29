# 0037 — Geometry is in map units, ink is in canvas units

- **Status:** Accepted
- **Date:** 2026-07-29
- **Issue:** [#203](https://github.com/Nossimonov/Chartdown/issues/203)
- **Builds on:** [ADR 0023](0023-detail-is-data-not-noise.md), [ADR 0025](0025-a-blob-declares-an-extent-not-an-outline.md), [ADR 0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md)

## Context

A region map renders into a canvas 820 units wide whatever its `extent:`, so a rendered unit is a *fraction of the sheet* rather than a distance. The organic finishing that turns a declared outline into a drawn coast carried two constants in those units — skip an edge under 8, cap the nudge at 16 — and [#180](https://github.com/Nossimonov/Chartdown/issues/180)'s "is there water beyond this shore" probe carried a third.

The consequence is that **the document header became an input to the shape**. Measured on the Puget Sound exercise map, changing only `extent:`:

| | 100mi | 200mi | 350mi |
|---|---|---|---|
| declared `coastline` | 3705 pts, centroid (49.340, 65.461) | identical | identical |
| declared `island` outline | 80 pts, centroid (38.617, 100.899) | 50 pts, (38.590, 100.948) | 40 pts, **(38.711, 101.054)** |

The island's drawn centroid moves **0.16mi** and its bounding box grows 1.3%. Pickering Passage, which separates it from the mainland, is 0.1mi wide — so at 350mi the two shapes touch and `check` reports a welded island on a document that is clean at 100mi. The declared coastline beside it is bit-identical at every extent, which is both the proof that this is achievable and the reason it went unnoticed.

[ADR 0023](0023-detail-is-data-not-noise.md) already says a feature's geometry is a pure function of its own data, and spec 05 §4 already forbids quiet resizing. Neither anticipated `extent:`, because nobody had thought of the header as data the shape could depend on.

## Decision

**A drawn shape is a pure function of its declaration, and `extent:` is not part of that declaration.** Every threshold governing organic finishing is expressed in map units or as a fraction of the shape itself. This binds coherence checks as well as geometry: a rule about whether two landmasses touch may not have a different answer at a different `extent:`.

**The converse is equally binding, and is why this is a split rather than a blanket rule: ink is in canvas units.** Coastline stroke widths, font sizes, marker radii and [ADR 0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md)'s legibility floor stay exactly as they are. They are symbols whose job is legibility at the drawn size, and in map units they would be invisible on a 3000mi map and overwhelming on a 30mi one.

So the rule is a question about what a number *does*, not about where it lives:

> **Anything that decides where the land is, is in map units. Anything that is ink laid on top is in canvas units.**

**The thresholds are relative to the shape, not restated in miles.** Miles was the first proposal and it does not survive contact with the corpus: the committed examples run from a 12mi survey to a 1600mi continent, where the old 8-unit gate works out at 0.12mi and 15.61mi. No single distance serves a 133x spread. A fraction of the shape's own extent works at every scale and is the model `organicMass` already uses for the same job — [ADR 0025](0025-a-blob-declares-an-extent-not-an-outline.md) calls that texture "a pure function of the arguments".

Concretely: the edge gate is gone (an edge too short for its texture to be *seen* still gets it — sub-pixel wiggle costs two vertices, where skipping it moves the land), the amplitude cap becomes a fraction of the outline's own diagonal, and the probe step is floored at `QUANTUM`. **The only legitimate absolute floor is the output's own precision**, because below it the geometry cannot be expressed at all ([#176](https://github.com/Nossimonov/Chartdown/issues/176)).

## Alternatives considered

**Express the thresholds in miles.** What #203 proposed and what the issue's own reasoning implied. Rejected on the corpus, above. Recorded because it is the obvious reading of "why would a map reckoning in miles sample in something else", and the answer is that the *unit* was never the problem — the **canvas-relative** part was, and shape-relative fixes it without picking a distance nobody can defend.

**Accept it as approximation.** A coastline is an approximation and coarser sheets may legitimately draw it more coarsely. But 0.16mi of displacement and a coherence warning that appears and disappears is the declaration changing meaning, not the drawing getting coarser — and the invariant coastline in the table shows the standard was already being met elsewhere in the same renderer.

**Keep the gate for output size.** It saves two vertices per short edge. Measured across the committed examples the change rewrote exactly one SVG, and a scale-free gate makes the vertex count *more* predictable, not less: it is now a fixed function of the declaration's own complexity.

**Drop organic finishing on declared outlines.** It exists because a raw polygon reads as a surveyed boundary (spec 02 §9, [#96](https://github.com/Nossimonov/Chartdown/issues/96)), and a traced coastline is exactly where that matters.

## Consequences

Outlines that go through the organic path change shape slightly: every edge is now textured, where short ones were skipped. Of the committed examples only `gumdrop-vale` moves, because the others declare their masses with `blob`, which goes through `organicMass` and was already scale-free. The visible result is that a shaped wood reads as a wood rather than as a rounded rectangle, which is what spec 02 §9 asks for.

**Islands drawn from a framed outline now behave the same at any extent**, and the Puget Sound map is clean at 100mi, 200mi and 350mi where it previously reported a welded island at the widest.

A regression test renders one document at three extents spanning 20x and asserts every drawn shape is the same shape in map units — vertex count exactly, centroid to well inside the printed quantum, bounding box within it, and the diagnostics identical. It is the sweep this ADR promises rather than a spot check: anything that reintroduces a canvas constant into a geometry path now fails there rather than on someone's map. Verified red against the old constants before being relied on.

What remains scale-dependent, correctly: the number of channels [ADR 0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md)'s floor symbolises, which rises as the sheet widens. That is ink doing its job, and it is the clearest illustration of the split this ADR draws.
