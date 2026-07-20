# Ambush at Redford Crossing

**Status: aspirational** — not valid under any spec draft; exists to drive syntax design. Fulfills [#3](https://github.com/Nossimonov/Chartdown/issues/3), authored against Sarah's battlemap narrative in [docs/use-cases.md](../../docs/use-cases.md) §1.

## The scene

A goblin ambush at a river crossing: the Old Toll Road runs north–south across the Redford at a muddy ford. A ruined toll house on the north bank hides two goblin archers; two more goblins wait in the forest southwest, and the ogre Gruk lurks hidden in the reeds. The party escorts a wagon north; the trap springs when it's mid-ford.

## Intended render

A gridded 20×15 tactical map, 5 ft per cell, printable at one inch per cell. ASCII mock (one character per cell):

```
   ABCDEFGHIJKLMNOPQRST
 1 ..........:.........
 2 ..........:.........
 3 ..........:..##.#...
 4 ..........:..wax....
 5 ..........:..#.a#...
 6 ..........:..#+##...
 7 ..........:...c.....
 8 ..........:.........
 9 ~~~~~~GG~~==~~~~~~~~
10 ~~~~~~~~~~==~~~~~~~~
11 &&&&&&.%%%W.........
12 &&g&&&....:.........
13 &&&&g&....:.........
14 &&&&&&...PPP........
15 &&&&&&...PPP........
```

`~` river · `=` ford · `%` mud · `&` forest · `:` road · `#` wall · `+` door · `w` window · `x` crates · `c` campfire · `W` overturned wagon · `g` goblin · `a` goblin archer · `G` Gruk (GM render only) · `P` party start zone

In a real render: the river meanders organically within its two-cell band rather than running ruler-straight; the ruined walls draw as broken segments; the campfire casts a 20 ft light radius and the toll house interior reads as dark; difficult terrain (ford, mud) is visibly marked. The **player render** omits Gruk and the entire `[gm]` section.

## What this example asserts (syntax under test)

1. **Markdown-style title, then `key: value` header** — map type, grid, scale declared up front; everything after is positioned content.
2. **Chess-style cell addresses** (`K11`, ranges `N3..Q6`) as the coordinate surface — compact, table-speakable ("goblin at E13"), unambiguous about orientation. The `(x,y)` alternative stays on the table in [#8](https://github.com/Nossimonov/Chartdown/issues/8).
3. **`[section]` grouping** by content kind (terrain / structures / features / tokens / gm) — the skim structure.
4. **Sparse shapes, renderer finishes**: the river is five points and a width; the forest is a rect; the renderer owes organic-looking output (vision principle: approximate, low-effort shapes).
5. **Topological relations where they read better than coordinates**: `ford : on river at …`, `road : … crossing ford` — the ford belongs to the river; the road knows it crosses.
6. **Semantic structures over traced walls**: `building N3..Q6` + `ruined : north wall, east wall` + door/window placements, instead of wall-segment polylines. Four lines describe what a UVTT export must turn into ~12 wall/portal primitives.
7. **Windows block traversal, not sight** — carried by the semantic type, not stated per-instance.
8. **Token batches and properties**: two goblins in one line; `size 2` for the ogre; `hidden` as a per-entity GM-only flag; `party start` as a zone rather than tokens.
9. **`[gm]` section + `hidden` flag** — the GM/player render split at both granularities (whole-section and per-entity).
10. **Names are anchors**: `tollhouse`, `ford`, `Gruk` are addressable identities. Prose in Sarah's prep note would link `[the toll house](#tollhouse)`; the `[gm]` section attaches notes to entities *by name* from a distance.
11. **Light as a feature property** (`light 20 ft`) rather than a separate lighting layer.

## Requirements traceability

Against Sarah's checklist (use-cases §1): grid+scale ✓ · semantic terrain from sparse shapes ✓ · difficult terrain ✓ · path with width + ford ✓ · walls/ruined walls/door/window ✓ · props with facing ✓ · token batches, sizes, start zone ✓ · light source ✓ · GM-only annotations ✓ · named entities for crosslinks ✓ · ~30 lines, one fact per line ✓. Not exercised here (renderer concerns, not syntax): print-at-scale output, UVTT export fidelity. Not needed by this scene: hex-gridded battlemap, elevation.

## Open questions this example deliberately raises

- **Topological relations are contested.** `ford : on river at …` and `road : … crossing ford` read nicely but flirt with pseudo-English — the AppleScript trap: syntax that looks like prose, inviting users to type *other* prose that doesn't parse. Alternatives: a small closed set of relation keywords with rigid grammar, or no relations at battlemap scale at all (`ford : K9..L10 (difficult)` works; the only loss is the renderer knowing ford and river should visually merge). Region maps genuinely need relations ("road from A to B along the coast"), so the decision lives in [#8](https://github.com/Nossimonov/Chartdown/issues/8) with region-map needs in view.
- **Name vs. property is ambiguous and must not stay so.** Is `wagon (overturned)` a feature *named* "wagon (overturned)" or a `wagon` in an overturned state? Intended reading: bare word = semantic type, quoted string = display name, trailing/parenthesized words = properties — but nothing in the syntax enforces one reading yet. Relatedly, the property forms are inconsistent *on purpose* — `(overturned)`, bare `hidden`, `width 2`, `light 20 ft` — so [#7](https://github.com/Nossimonov/Chartdown/issues/7) settles one canonical form with concrete material.
- **What does the language "know"?** Does `wagon` mean anything to a parser, and how can `facing south` work if not? Position to test in proposals: a standard vocabulary of semantic types whose variant states (`overturned`) renderers understand; unknown types are legal and render as a generic glyph + label; and *generic* properties — `facing`, `size`, `hidden`, `light` — are pure geometry/visibility, applying to any entity regardless of vocabulary. Extensibility of the vocabulary is [#9](https://github.com/Nossimonov/Chartdown/issues/9)'s question.
- Are `[gm]` entries that reference entities by name (`tollhouse : "…"`) attachments or redefinitions? Resolution rules belong to [#11](https://github.com/Nossimonov/Chartdown/issues/11).
- `building` is rect-based here; non-rectangular structures (L-shaped ruin) will need either polygon footprints or composition — battlemap-primitives proposal territory.
- Comment character (`;` here) and token allegiance modeling — minor, parked in [#7](https://github.com/Nossimonov/Chartdown/issues/7)/[#9](https://github.com/Nossimonov/Chartdown/issues/9).
