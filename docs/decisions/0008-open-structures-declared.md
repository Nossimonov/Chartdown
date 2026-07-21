# 0008 — Unroofed structures are declared with the `open` flag, not derived from the level stack

- **Status:** Accepted
- **Date:** 2026-07-21
- **Issue:** #33

## Context

A courtyard declared as a `building` rendered identically to a roofed room: on the Fairwater Manor ground floor there was no visual cue that the courtyard is open to the sky. The distinction is not cosmetic — whether a cell is open or enclosed decides whether flight is an escape route, whether a lobbed shot can reach its target, whether weather applies, whether something can fall in from above.

The information *partially* exists already on multi-level maps: the upper level declares `air` over the courtyard and `roof` over the rooms (spec 06 §5). But single-level documents — the majority of battlemaps — carry no signal at all, and spec 06 §5's ground rule is that level ground-truth is *declared, never derived*. Export can't rescue it either: Universal VTT's vocabulary is `line_of_sight`, `objects_line_of_sight`, `portals`, `lights`, `environment` (ambient/baked lighting), grid `resolution`, and the image — there is no open/enclosed field to round-trip through.

## Decision

A structure MAY carry the **`open` flag**: walls without a ceiling.

```chartdown
building courtyard "The Courtyard" : D2..V10 open nolabel
```

- The renderer distinguishes open interiors from roofed ones; the appearance is an ordinary themable state (`building.open : fill=…`, spec 08 machinery, like `ruined`).
- On multi-level maps, an open structure's **sky cells** — its footprint minus sibling structures on its own level — should see `air` on the level above. A floor above open ground is a contradiction and draws a renderer **warning** naming both entities and a cell. The derivation direction is never silent inference; it is a consistency check on two declarations.
- The flag flattens on UVTT export, exactly as elevation does (spec 06 §9). Roof-aware targets (e.g. Foundry scene levels) are ecosystem-phase exporters' business.
- A stdlib `courtyard : structure open` sugar word is deferred until usage demands it; the flag is the primitive.

## Alternatives considered

- **Derive openness from the level above** (`air` over the cells = open): works only for multi-level documents, silently inverts spec 06 §5's declared-never-derived stance, and makes a ground-floor fact depend on edits to a different level's terrain list. Lost. Its useful residue survives as the consistency warning.
- **A stdlib `courtyard` word with no flag**: bakes one use case into vocabulary while leaving pens, arenas, ruins, and walled gardens unexpressible without new words. The flag composes with every structure word, present and future. The word can still be added later *on top of* the flag.
- **Terrain-side declaration** (declare the courtyard's ground as terrain, no structure): loses the walls, which are real, sight-blocking, and the reason the courtyard exists.
- **Do nothing**: leaves a mechanically meaningful distinction unrepresentable and the flagship example visually misleading.

## Consequences

Single-level maps can now state openness at all; multi-level maps get a contradiction check between two declarations instead of an inference. Themes gain a state hook (`building.open`) with zero new machinery. The cost: one more reserved flag word an author can collide with, and UVTT consumers never see the distinction — the flag is honest about being a Chartdown-and-better-exporters feature. Future exporters that target roof-aware formats are constrained to read `open` (and `air`/`roof`) rather than re-deriving coveredness themselves.
