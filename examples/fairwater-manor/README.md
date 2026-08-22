# Fairwater Manor

**Status: spec-aligned** — valid under spec v0.6 (sections 01–08). Fulfills [#28](https://github.com/Nossimonov/Chartdown/issues/28): the flagship battlemap showcase, and the playground's opening document.

## The scene

A walled manor on the King's Road where it bridges the Fairwater. The road ends at the gatehouse — two doors, so it's a killing box — which opens into a walled courtyard holding four distinct rooms: the Great Hall (hearth-light striping out of its western windows), the Kitchen below it, the Solar, and the Barracks. Guards on the bridge and at the gate; Lord Fairwater at his high table; and in GM view, an assassin already in the Solar, an alarm trigger inside the gate, and what's really in that locked strongbox.

And it's three stories: the Lord's Chambers above the Great Hall (stairs up from the hall), and the Undercroft below the kitchen (a `ladder : stairs` derivation — themable as its own connector kind) — where, in GM view, the old steward Old Merek is locked away with what he knows.

## What this map flexes

Nearly the whole battlemap vocabulary, including **multi-level structures** (spec 06 §8: `levels:` in physical order, section qualifiers like `[structures upper]`, connectors via `to=` with automatic reciprocal landings, one panel per floor) plus: a **derived bridge** (`bridge : on fairwater on kingsroad` — the road carried over the water at their computed intersection, first rendered use of the bridge branch), nested structures (courtyard enclosing hall and wing, gatehouse straddling the road with doors north *and* south), windows, declared mud banks, visibility-clipped lights (the hearth glows through the hall's doorway, not its walls), grid coordinates, token sides, a staging zone, and the fail-closed GM layer (hidden assassin, trigger zone, attachment notes on the chest and the lord).

## Renders

[fairwater-manor.svg](fairwater-manor.svg) (player) · [fairwater-manor-gm.svg](fairwater-manor-gm.svg) (GM — the Whisper, the alarm zone, and the secrets appear).

## With the alternative theme

[`fairwater-manor-vellum.theme.cd`](fairwater-manor-vellum.theme.cd) renders this map in **ink and vellum** — sepia on aged paper, hatched rather than flat:

```sh
chartdown render fairwater-manor.cd --theme fairwater-manor-vellum.theme.cd
```

It is a three-line overlay on [the travelling theme](../ink-and-vellum.theme.cd), which is keyed entirely on standard-library words and restyles all seven examples without knowing any of them. `use:` is not decoration here: it makes the base an **inherited** layer, which is what spec 08 §6 exempts from the dead-declaration lint — a shared theme deliberately styles words no single map uses, and selected directly it reports every one of them (69 on Brenmark). `ladder : stairs` is this document's own derivation, and a ladder is not a stair — the overlay gives it its own rungs. It is also the map that proved the base's `earth` was wrong, by lifting the Undercroft out of the dark it is meant to sit in.

No themed SVG is committed; the theme is live in [the playground](https://nossimonov.github.io/Chartdown/) under the Theme selector.
