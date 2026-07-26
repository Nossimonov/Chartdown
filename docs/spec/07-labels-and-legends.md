# 07 — Labels and Legends

**Status: Draft** (accepted from proposal [#19](https://github.com/Nossimonov/Chartdown/issues/19) as proposed). Defines derived labels, the `[labels]` section, keyed mode, and generated map furniture (legend, scale bar, compass, coordinates). This is the last content section of spec v0.1; no ADR (enumeration under settled mechanisms).

## 1. Derived labels

Every entity with a display name labels itself. Prominence — size, weight, styling — follows the entity's vocabulary word through the theme: a `capital` labels large, a `hamlet` small, a `realm` sprawls by default. The common case requires no declaration. The generic flag `nolabel` suppresses an entity's label.

## 2. The `[labels]` section

A universal section (all map types) holding two line kinds:

**Label overrides** — the subject is a bare reference (quoted display name or id word, *no type word*) and MUST resolve per spec 03; an unresolvable subject is an error, never a stray label. The predicate is a placement hint:

```chartdown
[labels]
"The Argen Sea" : sprawl (60,200)..(120,450)   ; letter-spaced across the area
"The Vess" : along vess                        ; label follows the path
highkeep : north                               ; label sits on the stated side
port : at (150,470)                            ; pin the label anchor exactly
```

**Free text** — the subject carries the type word `note`, **or any word deriving from `note`** through the vocabulary chain (spec 04 §2), so a document may define `waypoint : note` and style its navigation pins apart from its in-fiction captions. (Standard library: `note : feature`, a feature whose rendering *is* its text.) Example: `note "Here be dragons" : (700,100)`. The required type word is what keeps override typos loud — a subject deriving from nothing is still an error.

Free text renders as **text alone** — no marker, no glyph, at any placement. It is map furniture, not an entity: it names nothing and marks no position. A marker beside a caption asserts that there is a *thing* at that spot, which on a sheet where every other glyph is something the party can interact with is a promise the map cannot keep.

> Text that marks a **place** is not free text — it is an ordinary entity with a display name (`landmark w9 "9 — The Bridge" : GL78`), which labels itself per §1 and carries a glyph the theme can style. Reach for `note` when there is nothing there, and for an entity when there is.

**Hint vocabulary (closed):** `sprawl <range>` · `along <ref>` · `at <point | cell>` · a compass word (label side relative to the entity). Nothing else; typography and color belong to themes.

**Free text's placement set (closed):** `<point | cell>` · `<range>` · `sprawl <range>` · `along <ref>`. Anything else is a parse error. `sprawl` letter-spaces the text across its range, which is what distinguishes it from a bare range; `along <ref>` sets the text **on the referenced course**. The set is stated because free text is the one label kind with no entity to sit beside, so its placement is the only thing positioning it — and an unstated set left three forms behaving three different ways.

## 3. Label modes

Header key `labels:`, defaulting to `names`:

- `names` — render display names. An entity carrying an explicit **`key=<n>`** still shows its number: that is *a map **with** a key* — a numbered route through a named map, which is the shape of nearly every published module — as distinct from *a map in key mode*, which renumbers every display name. Only pinned entities are numbered; the rest keep their names.
- `keyed` — render numbers; the renderer generates a key (`1. Gate Plaza  2. The Big Top …`) in the legend, module-style. Numbering is document order (deterministic); the generic parameter `key=<n>` pins an entity's number so later insertions cannot renumber published cross-references.
- `none` — no derived labels (a clean map); `[labels]` free text still renders.

## 4. Generated furniture

Header keys, all defaulting `off`, all renderer-generated and never hand-maintained. Each takes `on` or `off` and **nothing else** — the value is a closed set and anything outside it is an error (spec 01 §2), because a near-miss would otherwise select the default and silently disable the very thing it was asking for:

| Key | Effect |
|---|---|
| `legend: on` | Legend built from the vocabulary words actually used — terrain swatches, feature glyphs, path styles — plus the key in `keyed` mode |
| `scale-bar: on` | Scale bar derived from `scale:` / `extent:` |
| `compass: on` | Compass rose; north is always up (spec 02 §1) — rotation is out of scope for v0.1 |
| `numbers: on` | Coordinate labels appropriate to the grid: edge letters/numbers on square grids, in-hex addresses on hex grids; ignored on gridless maps |

## 5. Rendering obligations

Renderers SHOULD avoid label collisions and MUST place labels deterministically (spec 02 §8.2 — seeded, stable across re-renders); explicit hints always win over automatic placement. Labels of `hidden` entities and `[gm]` content appear only in GM mode, per the fail-closed rule (spec 01 §6).

When a map holds more detail than its size can sustain, renderers resolve label pressure the way a cartographer would, in this order:

1. **The label that cannot move claims first.** A line feature's name reads as that feature's name *because it lies along the feature*; set aside, it becomes a caption pointing at nothing, and no connector repairs it. A point marker's name has a recovery — rule 3's leader — so it yields first. **Line-feature labels therefore claim before point labels, which claim before names with room to roam** (areas, realms, seas). Within the point tier, more important markers (larger tiers) claim before minor ones.

   This ordering is the reverse of what the same principle produced before leader lines existed, when displacement destroyed a point label's association and proximity was its only guarantee ([ADR 0019](../decisions/0019-line-labels-claim-before-point-labels.md)).
2. **Shrink before moving far.** A label that cannot be placed at full size SHOULD be retried at smaller sizes, down to a legibility floor, before being displaced from the feature it names.
3. **Connect before omitting.** A label with no adjacent slot at any size MAY be placed in nearby open space with a **leader line** — a hairline from the name to its marker — rather than dropped. The leader carries the association that adjacency otherwise provides, so the label is still that marker's name. Because it does, the displacement limit that rule 1 implies must be stated rather than assumed: a leader reaches no further than a fixed bound, and a name that cannot be connected within it is omitted under rule 4. Without an explicit bound a crowded map becomes a scatter of names on strings, each individually justified. The connector is theme-owned (`leader`, spec 08 §2).
4. **Omit before overwriting.** If a label still cannot be placed without substantially covering other map text, renderers MAY omit it entirely — an unlabeled marker reads better than two names on top of each other. Author-placed `[labels]` overrides are never omitted.
5. **Repeat rather than cross.** A name spanning a long feature (a sprawled sea, a realm) whose natural midpoint is densely built over MAY be repeated once on each side of the occupied stretch instead of being drawn across it.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
