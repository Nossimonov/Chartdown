# 0031 — A bank the document did not choose is refused, not picked

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [#191](https://github.com/Nossimonov/Chartdown/issues/191)
- **Builds on:** [ADR 0024](0024-a-feature-takes-its-bearing-from-the-water-it-sits-in.md), [ADR 0026](0026-shape-is-declared-data.md)

## Context

An arm hangs off another feature — Dabob and Quilcene off Hood Canal — and takes its water side from that host, because the canal *is* the arm's water and `sea : west of hood` is not a sentence about a canal. The side is therefore the direction from the arm's anchor toward its host's own centerline.

Where the anchor **is** a point on that centerline, that direction is the zero vector. And that is the anchor an author reaches for: one of the host's own `via` controls, because that is the point on the canal they mean.

The arm was then left with no side at all, and its bank fell to the local winding of whichever outline vertex the anchor happened to snap to. Measured on a 2mi canal, the two rails sat **0.752mi from the anchor apiece** — equidistant to three decimals — and answered differently: one bank drew, the other drove the bite into the canal and was honestly refused as a fold. Swept along the canal's own controls the refusals **alternated** — ok, NO, ok, NO, ok — while ignoring the feature's size entirely, down to a third of the one asked for. A refusal that does not move when the feature is shrunk is not about the feature's size, and a placement fact does not alternate down the length of a canal.

The die had been rolling since arms existed. [#189](https://github.com/Nossimonov/Chartdown/issues/189) changed the sampling and so changed the outcome, which is how it was found: three tests were pinned to an anchor that happened to land heads.

## Decision

**Where the anchor lies on its host's centerline, the arm is refused and the ambiguity is named.** The document has not said which bank the arm leaves from, and the renderer does not decide it.

```
error: 'Dabob Bay' (sound) cannot be drawn on 'hood' — its anchor lies on the
       centerline of 'hood', which does not say which bank it leaves from.
       Move it to one: about (41.3,65.3) or (42.7,66.7) (spec 05 §4)
```

- **Both banks are offered**, because naming one would be the silent pick this refuses. They are positions the author chooses between, not a suggestion the renderer promises will draw — though as it happens both do.
- **The threshold is float noise and nothing more.** Swept perpendicular to a 2mi canal, an anchor off the centerline by **0.001mi** — five feet on a hundred-mile map — already answers stably, and the same way at every distance out to the bank. A coordinate states a side as soon as it is not on the line, so refusing any wider would refuse documents that do say which bank they mean.
- **The host's answer wins over the map's.** This resolution ran only for an arm that had no side yet, so the map's global guess — the direction to the nearest water body's centre — got there first and the host was never asked. Spec 05 §4 already required the opposite. Fixing it also removed an asymmetry that was being read as geography: with the side taken from a distant sea, one of a canal's two banks refused every arm, because the global vector drove the bite inward on that side.

## Alternatives considered

**Pick the snapped bank deterministically** — take the side from the point the anchor snapped to rather than from the declared anchor. No author change needed, and it never folds. Rejected because the bank is still arbitrary: it is chosen by the host outline's vertex sampling, so an unrelated feature elsewhere on the map could move the snap and switch a named bay to the other side of a canal without a word. That is the failure [#179](https://github.com/Nossimonov/Chartdown/issues/179) exists to prevent, arriving as a shape instead of as a refusal — and a bay silently changing banks is worse than one that will not draw, because nothing in the document says it moved.

**Take the bank from the arm's own `via`, where it declares one.** Correct as far as it goes — it is [#175](https://github.com/Nossimonov/Chartdown/issues/175)'s rule, that a declared centerline states its own direction, and it already applies. It is not an alternative to this decision but a case that never reaches it: an arm that says where it runs has said which bank.

**Infer the bank from the arm's name or the map's other features** — the side with more room, the side away from the nearest neighbour. Rejected as guessing dressed as geometry. Which bank Dabob Bay leaves from is a fact about the world, and the map either states it or does not.

## Consequences

An author who anchors an arm at the point on the canal they mean now gets an error where they previously got a bay, on a bank chosen by rounding, roughly half the time. That is the intended trade: the error names the ambiguity and gives two coordinates, and either one is a single edit.

The three tests pinned to a centerline anchor have been re-pointed at a bank. They were testing [#175](https://github.com/Nossimonov/Chartdown/issues/175) and [#179](https://github.com/Nossimonov/Chartdown/issues/179), and the anchor was carrying an unrelated ambiguity into both.

This does not settle the wider defect that produced the asymmetry above: a feature's water side is still one global vector where no host supplies one, which is wrong on a wrapped shore and undecidable where the coast turns square to it ([#178](https://github.com/Nossimonov/Chartdown/issues/178)). Arms no longer consult it. Everything else still does.
