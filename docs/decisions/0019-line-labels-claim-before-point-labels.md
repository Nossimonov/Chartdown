# 0019 — Line labels claim before point labels

**Status: Accepted** (owner, 2026-07-25). Supersedes the ordering established informally in spec 07 §5 rule 1 and recorded in `region.ts` as *"Point labels move LAST — a point label's proximity IS its meaning"*.

## Context

Spec 07 §5 rule 1 gave point labels first claim on space, and had good reason to. A settlement's name is meaningful only beside its marker: displace it and the reader cannot tell which dot it names. A river's name, by contrast, has "room to roam" — its feature is long, so it was asked to yield.

[ADR-adjacent context] That reasoning rested on an unstated premise: **displacement destroys association**. It did, for as long as a displaced label had nothing connecting it to its subject.

Leader lines ([#133](https://github.com/Nossimonov/Chartdown/issues/133)) removed that premise for point markers. A settlement name in open space with a hairline back to its dot is unambiguous — the line says which dot. But a line feature gains nothing equivalent: a river's name reads as that river's name **because it lies along the river**. Set it aside with a connector and it becomes a caption pointing at water. The two label kinds stopped being symmetric the moment one of them acquired a way to move without losing its meaning.

Under the old order, that asymmetry ran backwards: the label kind that *could* move cheaply claimed first, and the kind that *could not* took what was left. On the Middle-earth map this put Khazad-dûm's name across the Bruinen's mid-course, leaving the river's name on a stretch that bends 1.2px of its 29px ([#137](https://github.com/Nossimonov/Chartdown/issues/137)), and pushed the Entwash and the Great East Road off their courses entirely onto horizontal captions.

## Decision

**Line-feature labels claim before point labels.** A point label displaced by that claim takes a leader (§5 rule 3) and keeps its association; a line label that loses its course has no equivalent recovery, so it claims first.

Rule 1's principle is unchanged in substance — *the label with the least ability to move claims first* — but the ordering that principle produces is now the reverse of what it produced before leaders existed.

## Consequences

Measured on `middle-earth-v3.cd`, inverting the order improves every metric at once:

| | points first (old) | lines first (new) |
|---|---|---|
| unplaced names | 0 | 0 |
| leader lines drawn | 9 | **7** |
| labels following their course | 20 | **21** |
| mean curvature-representativeness of course labels | 0.350 | **0.390** |

The Entwash and the Great East Road move from horizontal captions onto their courses. Fewer leaders are needed overall, because giving line labels their course removes the crowding that was forcing point labels to relocate — the two kinds were competing for the same ground, and the loser was the one that could not recover.

Celduin remains a horizontal caption; its course is genuinely full.

**Costs accepted:**

- More settlement names sit away from their markers on dense maps. The leader makes that legible, but a leader is still a small piece of visual debt, and a map with many is busier than one with few. The count went *down* here, but that is one corpus.
- The ordering is now less obvious to a reader of the spec than "important things first" was, so §5 rule 1 states the principle explicitly rather than leaving it to be inferred from the outcome.

**Reversal condition:** if leader lines are ever removed or bounded so tightly that displaced point labels routinely fail to place, this ADR's premise fails with them and the ordering should revert.
