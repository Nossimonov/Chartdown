# The Chartdown Specification

**License:** the contents of this directory are licensed [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (not MIT like the rest of the repository) — see [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md). Spec files should carry a CC-BY-4.0 notice as they are added.

**Status: sections 01–08 are all drafted — the complete content of spec draft v0.1.** This directory is the single source of truth for the Chartdown language; anything not written here is not part of the language, including the illustrative sketch in the project README.

## Machine-ingestion artifacts (issue #12)

Three artifacts keep the spec agent-consumable, and they are **mandatory maintenance**: any commit that changes a spec section MUST update the first two in the same commit.

1. [`grammar.ebnf`](grammar.ebnf) — the consolidated grammar of all drafted sections. Informative: prose sections are normative and win on conflict; the grammar exists as the cross-section consistency check and the parser-writer's map.
2. [`digest.md`](digest.md) — the single-file language reference (llms.txt-style), compressed for dropping into an agent's context, ending in a few-shot micro-corpus. Every snippet in it must be valid — it teaches by example.
3. **The example corpus convention**: every spec section includes worked source examples; every [`examples/`](../../examples/) directory pairs a `.cd` source with a README describing the intended render. Together they are the paired source↔render corpus; agents (and humans) learn the language from them as much as from prose.

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
| [`08-styling.md`](08-styling.md) | Theme documents: appearance vocabulary, zones, glyphs, variant pools, inheritance |

This table is a plan, not a promise — Phase 1 proposals may reshape it.
