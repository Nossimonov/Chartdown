# 0024 — A detached feature takes its bearing from the water it sits in, read from that water's own declaration

- **Status:** Accepted
- **Date:** 2026-07-26
- **Issue:** [#167](https://github.com/Nossimonov/Chartdown/issues/167)

## Context

Six of Puget Sound's named islands do the same thing: each one **separates two arms of the sea**. Hartstene is what makes Case Inlet and Pickering Passage two inlets rather than one bay; Squaxin divides Totten Inlet from Peale Passage; Herron, Ketron, McNeil and Anderson each split a reach of the South Sound in two.

[#167](https://github.com/Nossimonov/Chartdown/issues/167) was filed as a **syntax proposal**, on the grounds that the language could not express this at all:

> Today an inlet is a *deformation of the shore*: a bite pulls the coastline landward, so the water it creates is a single lobe with land on both sides. There is no water **between two fingers** to put an island in, because the fingers are not channels — they are dents.

That was true when it was written. It stopped being true one commit later. [#163](https://github.com/Nossimonov/Chartdown/issues/163) replaced the displacement model with an outline spliced into the host, so an inlet became a real channel with real depth and near-parallel sides. An island placed inside one with the syntax that already exists now renders as land with water on either side of it, and reports nothing.

What survived was smaller and sharper. [ADR 0023](0023-detail-is-data-not-noise.md) and [#159](https://github.com/Nossimonov/Chartdown/issues/159) established that a detached feature's long axis is **inferred, not declared** — "a long island in a sound parallels the shore it sits off, because the same ice cut both" — and implemented that as *the tangent of the host line*. Inside an inlet the host line is the coastline, whose direction runs **across** the inlet rather than along it. So Hartstene rendered as a bar damming the channel instead of an island splitting it: measured, a bounding box of 22.9 × 156.1 in a channel running the other way.

The inference was right and its proxy was wrong. An island parallels **the water it sits in**; on an open coast that water happens to run parallel to the shore, which is why the proxy held everywhere it had been tried.

## Decision

**A detached feature's long axis follows the axis of the channel its anchor lies in; where there is no channel, it follows its host's local course as before.** A channel is a `morph=bite` feature whose footprint contains the anchor, and its axis is the direction it runs landward — read from the `seaward` vector the water's own declaration already supplies.

```chartdown
[water]
coastline shore : from (30,0) via (28,40) (29,80) to (30,120)
sea "South Sound" : west of shore
sound case "The Embayment" : on shore at (28,40) size=6mi reach=3 taper=0.15
island hartstene "Hartstene Island" : near shore at (36,40) size=13mi reach=0.14
```

`hartstene` lies **along** the embayment, with a channel of water either side of it joining around both ends. No new placement form, no new facet, and nothing declared that the map did not already know.

Where two channels contain the anchor, the **smallest** wins — an inlet inside a sound is the more specific statement about where the island actually is. Ties break on declared position and then on line, so the result never depends on iteration order.

The bearing is read from the **inlet's declaration**, never from the rendered water.

## Alternatives considered

**Measure the principal axis of the drawn water.** Tried first, and it works: sampled within one island-length of the anchor, the water inside the inlet has a principal axis along the channel and an elongation of 2.81, while open water is detectably round (elongation 1.00) so the fallback is decidable rather than guessed. It lost on [ADR 0023](0023-detail-is-data-not-noise.md): it makes an island's shape a function of *rendered geometry*, so editing the coastline half a map away could change the sea polygon and silently re-point an island a campaign had already named. ADR 0023 requires geometry to be a pure function of the placed data. Two declarations are exactly that; a rendered polygon is not.

**`island … : in <water>`, the form the issue proposed.** Rejected *as the fix for this*, because the geometry it was proposed to unlock already works — and the subtraction it described is unnecessary, since the island paints over the water and the channels are simply what is left. It retains one genuine virtue that has nothing to do with bearing: `near shore at (36,40)` anchors Hartstene to the *shore*, so moving the inlet leaves the island behind on dry land. That is the same tradeoff already weighed and deferred for the passage in [#162](https://github.com/Nossimonov/Chartdown/issues/162) — *"it simply requires two features be moved when the user would prefer to move one"* — so it is deferred to the same decision rather than settled twice.

**Declare the bearing.** An `angle=` or `bearing=` facet. Refused on the spec's own terms: "Direction is inferred from the host, not declared." An author who has already said where the water is should not have to say it again per island, and a declared angle would go stale the moment the inlet moved.

**Do nothing.** Six named islands stay uncarryable in the map's headline region, or get drawn as bars across their own channels. The issue's own done-state names all six.

## Consequences

The Puget Sound archipelago becomes drawable with no syntax anyone has to learn: the six islands that divide water are ordinary `island` declarations. #167 stops being a syntax proposal and becomes a corrected inference.

**No existing render moves.** Open water yields no containing channel, so the host-tangent path is unchanged — which is the whole reason this could be taken as a fix rather than a breaking change.

The cost is a **second rule where there was one**, and an author now has to know that placing an island inside an inlet changes what it aligns to. That is defensible because it matches what the words mean, but it is a genuine increase in the surface area of "inferred, not declared" — and inference that is right nine times and surprising the tenth is harder to debug than a declaration. If that surprise shows up in practice, `in <water>` (above) is the escape hatch, because naming the water makes the alignment explicit without declaring an angle.

It also entrenches the containment test as a thing the renderer knows how to do. That is reusable — #162's passage needs the same geometry from the other side — but it means a future change to how an inlet's footprint is computed silently changes which islands are considered "in" one.
