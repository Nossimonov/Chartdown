# The Chartdown Specification

**License:** the contents of this directory are licensed [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (not MIT like the rest of the repository) — see [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md). Spec files should carry a CC-BY-4.0 notice as they are added.

**Status: sections 01–07 are drafted — all content sections of v0.1. Only 08 (theme file format) remains planned.** This directory is the single source of truth for the Chartdown language; anything not written here is not part of the language, including the illustrative sketch in the project README.

## How the spec grows

1. A [syntax proposal issue](../../CONTRIBUTING.md#syntax-proposals) is opened with worked examples.
2. Discussion happens on the issue; contentious outcomes get an [ADR](../decisions/).
3. On acceptance, the proposal is merged into the spec files here **and** a matching example lands in [examples/](../../examples/) in the same PR.

## Planned structure

As sections are accepted they will land as numbered files so the spec reads in order:

| File | Covers |
|---|---|
| [`01-document-model.md`](01-document-model.md) | File format, fenced-block embedding, metadata, sections, comments |
| [`02-coordinates-and-grids.md`](02-coordinates-and-grids.md) | Addresses, edges, gridless points, relational placement, resolution |
| [`03-identity-and-links.md`](03-identity-and-links.md) | Entity identity, references, anchors, crosslinks, `[gm]` attachments |
| [`04-vocabulary-and-archetypes.md`](04-vocabulary-and-archetypes.md) | Archetypes, open vocabulary, derivation, inference, theme contract |
| [`05-map-primitives.md`](05-map-primitives.md) | The topographic standard library; region and hexcrawl map types |
| [`06-battlemap-primitives.md`](06-battlemap-primitives.md) | Battlemap type: structures, openings, props, tokens, elevation |
| [`07-labels-and-legends.md`](07-labels-and-legends.md) | Derived labels, placement hints, keyed mode, generated legend/furniture |
| `08-styling.md` | Theme file format |

This table is a plan, not a promise — Phase 1 proposals may reshape it.
