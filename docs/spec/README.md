# The Chartdown Specification

**Status: no spec exists yet.** This directory is the single source of truth for the Chartdown language; anything not written here is not part of the language, including the illustrative sketch in the project README.

## How the spec grows

1. A [syntax proposal issue](../../CONTRIBUTING.md#syntax-proposals) is opened with worked examples.
2. Discussion happens on the issue; contentious outcomes get an [ADR](../decisions/).
3. On acceptance, the proposal is merged into the spec files here **and** a matching example lands in [examples/](../../examples/) in the same PR.

## Planned structure

As sections are accepted they will land as numbered files so the spec reads in order:

| File | Covers |
|---|---|
| `01-document-model.md` | File format, fenced-block embedding, metadata, sections, comments |
| `02-coordinates-and-grids.md` | Square grids, hex grids, gridless positioning, units |
| `03-map-primitives.md` | Terrain areas, paths, points of interest, regions |
| `04-battlemap-primitives.md` | Tokens, walls, doors, elevation |
| `05-labels-and-legends.md` | Text, legends, scale indicators |
| `06-styling.md` | Themes, style separation from content |

This table is a plan, not a promise — Phase 1 proposals may reshape it.
