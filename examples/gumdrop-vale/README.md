# Gumdrop Vale, Sigma-5-5

**Status: spec-aligned** — valid under spec draft v0.1 (sections 01–07). Added with [spec 04](../../docs/spec/04-vocabulary-and-archetypes.md) (via [#16](https://github.com/Nossimonov/Chartdown/issues/16)) as the **candyland test**: proof that the vocabulary model imposes no setting.

## The scene

A survey map of a candy planet in the year 3742 — gumdrop hills, a licorice forest, a taffy river, a crashed hovercart. Precisely zero of these words exist in the standard library, and the map renders anyway.

## What this example asserts (syntax under test)

1. **Word derivation** (spec 04 §2): `licorice-forest : forest` — *treat it like a forest; a theme draws lollipops instead of trees*. Semantics inherited in source, motif swapped in theme. `hovercart : wagon states=overturned,parked` derives and declares states.
2. **Archetype binding** for words with no useful base: `sugar-silo : feature`.
3. **The escalation ladder's bottom rung**: `zorbleflax : (8,7)` is defined *nowhere* — usage inference (lone point → feature) renders a generic glyph labeled "zorbleflax". Delete the whole `[vocab]` section and the map still renders; every word falls through the chain.
4. **Shape/identity orthogonality**: the hills are a `blob` because these hills are round, not because "hills" implies a shape.
5. **Identity rules compose** (spec 03): the hills carry a display name so the village can anchor to them; the anonymous forest is unreferenceable by design; the hovercart demonstrates `link=` pointing at prose.
6. **No suffix magic**: `gumdrop-hills` derives from `hills` because line 8 *says so* — not because of how it's spelled.

## Intended render

With no theme: generic-but-legible — organic blob and polygon terrain in default fills, a meandering river, labeled point glyphs. With a candyworld theme: same geometry, gumdrop and lollipop motifs. The render never blocks on either.
