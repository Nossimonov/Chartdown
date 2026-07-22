# 0012 — Borders are relationships; realm edges may follow features

- **Status:** Accepted
- **Date:** 2026-07-22
- **Issue:** [#81](https://github.com/Nossimonov/Chartdown/issues/81)

## Context

The original blessed idiom, `border : along <ref>` (a path re-tracing a feature), gave one political fact two independent geometries: the shared edge of two realm `area` polygons, and a border overlay copying the followed feature's polyline — drawn directly on the feature, wandering near-but-never-on the plate edges. Owner review of the Sundered Reach stress test (#73) found the result incomprehensible, and identified the structural smell as the same one the crossing rules fixed for fords (spec 06 §6): a second location describing a fact that already has an emergent primary location. Any "snap the seam" refinement keeps the double definition — redundant when the two geometries agree, conflicting when they don't.

Two further owner requirements shaped the design: border *states* are wanted on frontiers that abut no rival realm, per direction ("goblin camps east raise that specific border to contested while the north stays empty wilderness"), with a blanket form still supported; and facing must be well-defined on concave realms — a C-shaped realm's "north" border is its very top, not also the top of its lower arm, so long as the interior stretches stay addressable.

## Decision

Chartdown separates border **geometry** from border **meaning**:

1. **Realm boundaries own their geometry, including feature-following stretches.** Inside an `area` point list, `along <ref>` between two vertices makes the boundary trace the referenced feature's rendered curve between the projections of those vertices — the same following as `from A to B along X`. One definition; moving the feature moves the border (the referent-frame principle of ADR 0009).

   ```chartdown
   realm valemark "Valemark" : area (110,240) along westspine (552,540) (350,530) (160,600) (100,320)
   ```

2. **`border` attaches a state to a stretch of one realm's boundary — never a location.** Selectors, most-specific-wins: none (blanket — every frontier stretch), a facing word, `along <ref>` (feature stretch), or a second realm (sugar for both realms' shared stretch). States are ordinary vocabulary through the theme chain; `gm=` annotates the relationship.

   ```chartdown
   border : valemark contested
   border : valemark east contested
   border : valemark along westspine sealed
   border : valemark carrowen contested gm="The Accord line."
   ```

3. **Facing is per edge, by outward normal** (the direction an outsider crosses from), eight sectors, ties clockwise. A bare facing word selects only **open** edges — the outward-normal ray from the edge midpoint escapes without re-entering the realm; `inner` selects the complement (bay shores). A C-shape's `north` is its very top; `inner north` is the bay's south shore; the bay's back wall stays open toward the mouth it faces.

4. **Overlapping realm claims are legal** — a disputed march conveys the relation between realms; tints blend and both boundaries draw. Asymmetric states on a shared seam are permitted (each side declares separately), not specially promoted.

`border` moves from the path family to the zone family. A border whose realms never abut or don't resolve styles nothing; renderers SHOULD warn and MUST NOT invent geometry.

## Alternatives considered

- **Do nothing** — the overlay reads as a glitchy re-stroke of the feature it follows, and the double geometry never converges.
- **Snap the realm seam to the border's feature** — rejected by the owner: two definitions of one edge; redundant when they agree, biting when they don't.
- **Drop `border` entirely** (realm edges are the only borders) — loses the state/relationship channel and the natural home for boundary `gm=` notes.
- **Offset-and-restyle the overlay** — cosmetic; both geometries survive.
- **Vertex IDs on area points** (border = stretch between two ids) — creates a namespace of referenceable sub-locations, dragging spec 03 anchor machinery into non-entities, at surveyor granularity where GMs think in facings and features. May return as a future proposal if a real map defeats both selectors.
- **Positional facing** ("the edges located in the realm's north") — undefined for concave shapes; outward normal is local, total, and matches invasion semantics.

## Consequences

- Border rendering mostly *deletes* code: the border-as-path branch disappears; states are styling on strokes realms already draw.
- Realm boundary strokes render per stretch (runs of constant state), so seams can carry state styling and GM tooltips; half-plane realms participate in abutting seams but draw no outline along the viewport rim.
- The renderer computes edge facings (outward normal, open/inner ray test) and abutting stretches (midpoint proximity) — all deterministic and spec-stated, so bucketing disputes are arguable in advance, never surprising at render.
- Documents using the old idiom must migrate (done for `examples/vessany` and `examples/sundered-reach` in the same change); the old form now renders nothing rather than a stray line.
- Supersedes the "Political boundaries" paragraph of spec 05 §2 as originally written; spec 02 §7's `along` row now covers the area-boundary use.
