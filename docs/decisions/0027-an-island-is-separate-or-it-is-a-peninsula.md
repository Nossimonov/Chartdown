# 0027 — An island is separate, or it is a peninsula

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [#180](https://github.com/Nossimonov/Chartdown/issues/180)
- **Supersedes:** the "partly on land is not reported" rule of spec 05 §2, introduced with [#164](https://github.com/Nossimonov/Chartdown/issues/164)

## Context

[#165](https://github.com/Nossimonov/Chartdown/issues/165) unions overlapping land, so an island whose outline reaches its shore is drawn welded to the mainland. [#164](https://github.com/Nossimonov/Chartdown/issues/164) then added a warning for an island whose footprint lies **wholly** on land, and explicitly exempted the partial case:

> An island **partly** on land is not reported — one half a mile offshore legitimately overlaps its shore at map scale, and belongs to the union rule rather than to a diagnostic.

The reasoning was that a sub-scale channel is thinner than the coastline stroke, so merging the two is the honest rendering. That reasoning is sound about **drawing** and does not license silence. Measured on the Puget Sound exercise map at `8736dd1`, Harstine Island was 70% surrounded by water and joined at its southern end, and `check` exited 0 with nothing to say.

What that costs is not cosmetic. Harstine is separated from the mainland by Pickering Passage, which boats go through. Drawn welded, the map states that you cannot get from Case Inlet to Totten Inlet that way. You can. **A map that denies a passage is not functional**, however plausible it looks — and this is precisely the silent-plausibility failure mode Phase 4 has spent its rounds removing, arriving as an omission rather than as a wrong number.

The exemption also had a gap between its stated justification and its shipped test. The justification describes a sub-scale **gap**; the test fixture sat the island **on** the coastline, overlapping it by fifteen miles. Those are not the same document, and only the first is defensible.

## Decision

**An island is separate, or it is a peninsula.** There is no third state, and a document that declares one while the map draws the other MUST be reported.

Conformance is stated on the **gap**, not on the overlap:

- an island with **any** open water between it and the shore is an island, however narrow the channel — a sub-scale gap is still a gap, and #165's union is confirmed as the right rendering for it;
- an island whose outline **reaches or crosses** the shore is welded, and MUST warn.

The renderer MUST NOT open a channel to repair it. Inventing water nobody declared is the same failure as quietly resizing a feature, which spec 05 §4 already forbids: *drawn as declared or reported*. The author's fixes are all real — widen the channel, move the island, or accept that at this scale the two are one landmass and declare a peninsula instead.

This is a **warning** rather than an error: the map still renders, and at map scale one merged landmass may genuinely be what the author wants. What is not acceptable is that they are not told.

## Consequences

`island half "Straddling the shore"` in #164's test suite was asserted **not** to warn and now does. The fixture is rewritten to a narrow-but-real channel, which is what its own comment always described, and the overlapping case moves to this decision.

The check is cheap where the union already happens: probe the ring just outside the outline and ask how much of it lies in water. Probing outside rather than on the outline matters, because a vertex on a shared boundary belongs to both and answers neither, and the outward direction is taken per edge rather than from a centroid — Harstine is a wishbone, and a centroid-based probe would sample its notch backwards.

It leaves an open question this ADR does not settle: a cartographer draws sub-mile channels **wider than scale** precisely to keep a map navigable, and the reference map shows Agate Pass, Rich Passage and Pickering Passage as visible water where all three are under a mile. Chartdown draws them to scale and they vanish. Whether a **minimum drawn channel width** belongs in the renderer or in the theme is a separate decision, and the warning above is what makes its absence visible in the meantime.

## Alternatives considered

**Leave it silent, as #164 decided.** The status quo. It relies on the author noticing at full-map zoom that a named island has become a lobe of the coast, which nine of fifteen islands on the exercise map demonstrate does not happen.

**Report it as an error.** Rejected: the render is not wrong in the way a fold is wrong, and at some scales a merged landmass is the correct picture. Refusing to draw it would force an author to edit a map that reads correctly.

**Open the channel automatically.** Rejected on the same grounds as clamping a feature's `size=`: the renderer would be inventing declared-looking geometry, and the width it chose would be a number the document does not contain.

**Widen the exemption instead — treat any overlap as intentional.** This is what the language did, and it makes `island` a word with no geometric commitment. If declaring an island cannot fail, it also cannot mean anything.
