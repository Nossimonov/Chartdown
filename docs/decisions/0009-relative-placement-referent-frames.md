# 0009 — Relative placement rides `on … at`: the `at` payload is interpreted in the referent's frame

- **Status:** Accepted
- **Date:** 2026-07-21
- **Issue:** #34

## Context

On a battlemap, a room's arrangement was declared in world coordinates: the Kitchen's table at `F8..G8`, its barrel at `E9` — none of it mentioning the kitchen. Move the kitchen and its contents stay behind. The region model already solved this class of problem with live anchors (`on coast at (160,470)`, spec 02 §8): moving an anchor moves its dependents. Battlemaps had the anchors — structures with footprints — but no way to place against them. The same gap existed inside structure details, which spec 06 §3 defines as "interpreted in the parent's frame" while addressing them absolutely: a moved building silently stranded its own doors and windows.

Two constituencies pull in opposite directions. The map *designer* wants room coordinates — the kitchen's arrangement should be a property of the kitchen. The *DM running that same map* wants absolute coordinates — positions are called out from the rendered grid ruler ("the assassin is at O4") and characters move through absolute space. Both are right, so neither idiom can displace the other.

## Decision

The closed relational grammar gains **no new form**. The existing `on <ref> at <payload>` form's payload widens: a **point** remains the gridless nearest-point form; a **cell, range, or edge token** is a *local address interpreted in the referent's frame*.

```chartdown
building kitchen "Kitchen" : D7..H10
  door : at E2.e                    ; parent-frame detail: = H8.e
[features]
table : on kitchen at C2..D2        ; kitchen-local: = F8..G8
ladder : on kitchen at C3 to=cellar
```

- A **structure's frame** is its footprint grid: bounding rect of the cell-union, NW cell = `A1`, axes as the document grid. A **path's frame is the document grid itself** (paths have no local grid) — which makes the crossing chooser of spec 06 §6 (`ford : on redford on tollroad at K9`) the *same form*, not a special case.
- **Detail lines** use an `at`-prefixed placement for the implicit parent frame (`door : at E2.e`); a bare address stays absolute.
- **Coexistence is a rule, not an accident**: relative placement is the author's choice per line, never a mode. Absolute placement remains legal everywhere and both idioms mix freely in one document. The rendered map is always the absolute frame; renderers surface the resolved absolute address for relatively-placed entities (tooltips), so play-time callouts never require mental math.
- Resolution reuses the anchor rules unchanged (order-bounded, live, deterministic, fail-loud). Errors: local address outside the referent's footprint; referent without a footprint frame; referent on another level.

## Alternatives considered

- **A tenth relational form** (`in <ref> <local>`): a heavier grammar for the same meaning; the closed nine-form grammar is a load-bearing promise (ADR 0003) and the existing form already carried referent-relative semantics in its point payload.
- **Contents as indented detail lines**: conflates furnishing with construction and still needs the local-address story — it is half of this decision without the other half.
- **Offset parameters** (`dx=2 dy=1`): un-chess-like, unreadable, breaks placement-as-predicate.
- **Editor tooling only** (move-the-room refactors): the document itself would still not express the dependency; hand edits and merges strand contents silently.
- **Do nothing**: rooms move rarely, but the structure-detail frame inconsistency was already in the spec's own words.

## Consequences

Rooms become self-contained, movable units; details finally live in the frame the spec always claimed for them; the crossing chooser is retroactively explained rather than special-cased. The costs: two coordinate spaces exist in source (mitigated by the explicit `on <ref> at` / `at` markers — a bare address is always absolute — and by resolved-address tooltips), and local addresses are only as stable as the parent's *shape* — reshaping a footprint remaps its local grid, which is the same live-anchor ripple rule 02 §8.4 already governs. Exporters see only resolved absolute geometry; relativity is authoring-time structure.
