# 0036 — A measurement reports what it consumed, not only what it produced

- **Status:** Accepted
- **Date:** 2026-07-28
- **Issue:** [#199](https://github.com/Nossimonov/Chartdown/issues/199), [#200](https://github.com/Nossimonov/Chartdown/issues/200), [#201](https://github.com/Nossimonov/Chartdown/issues/201), [#202](https://github.com/Nossimonov/Chartdown/issues/202)
- **Builds on:** [ADR 0028](0028-measurement-is-an-optional-package-in-typescript.md), [ADR 0032](0032-a-measurement-emits-a-line-that-draws.md)

## Context

Round ten of the Puget Sound exercise filed four bugs against `chartdown-measure`, and they are one bug wearing four coats. In each, the tool succeeded, emitted a valid declaration, and printed a number that looked like confirmation — while the number that would have failed was never computed or never shown.

- `coast --fill 2`, the default, removed **Puget Sound** rather than its inlets. The visible signal was the control count: 464 at `--fill 0`, 112 at 2. Both look reasonable. Nobody had rendered it.
- `feature` accepted a mouth that made four different named bays the same 69.8mi body — the whole sound in turn. The depth was printed, in a comment above a declaration that looked correct, and read past four times in one run.
- `island` reported "the nearest land is **0.0mi** away … and covers **0** sq mi", and suggested a point that, pasted back, produced the same message again.
- `inspect` reported a fit error whose meaning nobody could check, so a reader rebuilt the transform from the tool's printed replies, left out a 0.39° rotation nothing had disclosed, and measured half a mile of error that was their own reconstruction.

The shared failure is not accuracy. Three of those four numbers were correct. It is that **the output of a measuring instrument was chosen to describe the answer rather than to expose the mistake**, and a reader has no way to tell a good run from a bad one when the only thing that changes between them is a quantity nobody prints.

## Decision

**Every measuring verb states what it consumed, in the same units the author reasons in, whether or not anything looks wrong.**

- `coast` states **what share of the frame's water the fill turned into land**, and says so loudly past a quarter. A fill is for trimming inlets, and inlets are a modest part of any real sea.
- `feature` states **what share of the frame's water the mouth enclosed**, and **how much of the measured channel lies beyond the point the author called inside it**.
- `island` never offers land the tracer would itself refuse, and every point it suggests is **given in pixels**, which carry no rounding, and is a point the tool accepts.
- `inspect` reports **each landmark's own residual** beside their RMS, **always discloses the rotation and what it costs in miles at the frame's corners**, and **emits the fitted transform**.

**A default that can silently produce an empty result is not a default.** `--fill` becomes `0`. There is no safe radius to guess, because which water is a feature is the author's judgement, and 0 at least fails where it can be seen.

**Where no threshold can be honest, print the fact and skip the warning.** `feature`'s depth cannot be judged: Hood Canal really is 59mi deep from a 1.75mi mouth, so no bound on depth, or on depth against mouth width, separates a long fjord from a mistake — and the four fake bays each enclosed only 16% of this frame's water, well under the 90% at which the flood already refuses. Both numbers are now printed; only the lopsided-`--into` case carries a warning, and the reliable fix — **offer the tighter chord further in** — is deliberately left to a later change rather than approximated by a constant.

## Alternatives considered

**Warn when the depth is a large multiple of the mouth width.** Proposed in #200 and implemented first; it is wrong, and the issue says why in its own alternatives section. Sinclair's bad chord is 19× and Hood Canal is 34×, so every threshold that catches the mistake refuses the real fjord. Recorded here because the mistake was to implement the proposal without re-reading the paragraph that rejects it.

**Warn on the share of the frame's water.** Measured, and it does not fire: those four inlets are 16% of a frame that includes the Strait of Juan de Fuca. Kept as a printed fact, dropped as a trigger.

**Lower the `--fill` default rather than removing it.** Every value is wrong on some coast, because the closing acts at each channel's **narrowest** place rather than its median — the Tacoma Narrows is 2.19mi while Dabob Bay's median is 2.20, so any radius that fills Dabob pinches the sea shut. There is no number here, only a judgement.

**Snap a bad anchor automatically.** Rejected in #201 and worth restating: silently measuring a different island from the one asked for is worse than refusing.

**Report only on failure.** That is what produced these four. A number printed only when the tool already knows something is wrong cannot catch the case where it does not.

## Consequences

Every verb's output gets longer, and `inspect`'s roughly doubles. That is the trade: this is an instrument, and an instrument that prints only its reading is one a reader cannot calibrate.

`--fill 0` changes what the documented worked example produces — a traced shore contains every inlet, so a document that also declares those inlets draws them twice, which is the exact defect #198 was raised to fix. That remains the author's judgement to make, now with the consequence of each setting stated.

Two of the four fixes are **partial and say so**: `feature`'s mouth check catches three of the four inlets that motivated it (the fourth's inward point happens to lie deep inside the wrongly-measured channel), and the real answer is the tighter-chord suggestion this ADR declines to approximate.
