# Gumdrop Vale, Sigma-5-5

**Status: spec-aligned** — valid under spec v0.8 (sections 01–08). Added with [spec 04](../../docs/spec/04-vocabulary-and-archetypes.md) (via [#16](https://github.com/Nossimonov/Chartdown/issues/16)) as the **candyland test**: proof that the vocabulary model imposes no setting.

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

## The lollipop test (spec 08)

[candyworld.theme.cd](candyworld.theme.cd) is one half of the proof of the theme format — the half that **cannot travel**, since three of its subjects (`gumdrop-hills`, `hovercart`, `sugar-silo`) are this document's own words. [Ink and vellum](../ink-and-vellum.theme.cd) is the other half: keyed only on standard-library words, it restyles every example in this directory without knowing any of them. Both are needed to state the contract. Candyworld it restyles this map — lollipop glyphs scattered over the licorice forest (variant pool, position-hashed), edge-zoned gumdrop hills, a candy-banked river, custom cart/silo glyphs — **without touching `gumdrop-vale.cd`**. Rendered output: [gumdrop-vale-candy.svg](gumdrop-vale-candy.svg), or `chartdown render gumdrop-vale.cd --theme candyworld.theme.cd`.

## With the alternative theme

[`gumdrop-vale-vellum.theme.cd`](gumdrop-vale-vellum.theme.cd) renders this map in **ink and vellum** — sepia on aged paper, hatched rather than flat:

```sh
chartdown render gumdrop-vale.cd --theme gumdrop-vale-vellum.theme.cd
```

It is a three-line overlay on [the travelling theme](../ink-and-vellum.theme.cd), which is keyed entirely on standard-library words and restyles all seven examples without knowing any of them. `use:` is not decoration here: it makes the base an **inherited** layer, which is what spec 08 §6 exempts from the dead-declaration lint — a shared theme deliberately styles words no single map uses, and selected directly it reports every one of them (69 on Brenmark). Three of this map's words are its own — `gumdrop-hills`, `licorice-forest`, `taffy-river` — so the overlay names them. This is the map with **two** alternative themes: candyworld below, which cannot travel, and ink and vellum, which can.

No themed SVG is committed; the theme is live in [the playground](https://nossimonov.github.io/Chartdown/) under the Theme selector.
