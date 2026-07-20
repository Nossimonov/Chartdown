# 0006 — No bestiary; elevation as emergent terraces; orthogonal footprints with renderer smoothing

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #18

## Context

The battlemap section (spec 06) is mostly enumeration under settled mechanisms, but three of its calls close off alternatives. First: whether the standard library ships creature words. Second: the original proposal deferred elevation past v0.1 on the grounds that no use-case narrative demanded it — the owner reversed this, identifying the gap as a failure of the narratives, not of the need ("treacherous drops and elevated sniper perches are a map designer's best friend; we would be hobbled out the gate"). Third: how far footprint geometry goes in v0.1.

## Decision

Per spec [06-battlemap-primitives.md](../spec/06-battlemap-primitives.md):

1. **No bestiary — a principled zero.** The library ships no creature words. Token inference (ADR 0005) renders any word; `size=`/`side=` carry tactics; `use:` libraries and themes carry settings and art. Grounds: mechanical (inference suffices), cultural (no implied canon), legal (nothing IP-adjacent).
2. **Elevation ships in v0.1 as emergent terraces**: `elevation=<measure>` as a generic parameter; ledges drawn automatically wherever adjacent elevations differ (the drop is the difference); transitions are vocabulary (`stairs`, `ramp`, `slope`); tokens carry no elevation (altitude is play-state). The use-case narratives were retrofitted with the elevation requirement so traceability stays honest.
3. **Footprints are orthogonal in v0.1** — rect ranges and cell unions, which fully cover L/T/U/courtyard shapes; only non-axis-aligned geometry (diagonal/curved walls via corner-point tracing) is deferred. Companion principle from owner review: a saw-tooth of cells at an angle *is* an angled wall, and renderers may smooth it — the syntax conveys cells, appearance is the renderer's, movement follows the cells.

## Alternatives considered

- **A starter bestiary** — every entry invites the next; canon and IP baggage; inference already renders any creature word. Rejected.
- **Deferring elevation** — the original proposal's position; reversed in owner review as above.
- **Explicit cliff/ledge tracing grammar** — emergent boundaries need no new syntax and can't disagree with the declared heights; rejected.
- **Corner-point footprints now** — real grammar weight (winding, corner selection, wall interpolation) against demand already covered by cell unions plus smoothing; deferred, not rejected.
- **Token elevation** — play-state, not map source; Chartdown is not a VTT (vision non-goal).

## Consequences

- Settings own their monsters; community creature vocabularies become a natural `use:` ecosystem.
- Terraced set-pieces (perches, drops, tiered arenas) are expressible in v0.1 with one parameter and two vocabulary words; UVTT export flattens elevation into the image, and richer multi-level export waits for ecosystem work.
- Renderer smoothing of saw-tooth geometry means visual quality can improve without any document changing — and two renderers may draw the same wall differently while agreeing perfectly on movement.
- The use-case narratives gained an elevation requirement after the fact — a recorded reminder that the narratives are living documents, not immutable evidence.
