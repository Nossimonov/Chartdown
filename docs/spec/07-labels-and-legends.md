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

**Free text** — the subject carries the type word `note` (standard library: `note : feature`, a feature whose rendering *is* its text): `note "Here be dragons" : (700,100)`. The required type word is what keeps override typos loud.

**Hint vocabulary (closed):** `sprawl <range>` · `along <ref>` · `at <point | cell>` · a compass word (label side relative to the entity). Nothing else; typography and color belong to themes.

## 3. Label modes

Header key `labels:`, defaulting to `names`:

- `names` — render display names.
- `keyed` — render numbers; the renderer generates a key (`1. Gate Plaza  2. The Big Top …`) in the legend, module-style. Numbering is document order (deterministic); the generic parameter `key=<n>` pins an entity's number so later insertions cannot renumber published cross-references.
- `none` — no derived labels (a clean map); `[labels]` free text still renders.

## 4. Generated furniture

Header keys, all defaulting `off`, all renderer-generated and never hand-maintained:

| Key | Effect |
|---|---|
| `legend: on` | Legend built from the vocabulary words actually used — terrain swatches, feature glyphs, path styles — plus the key in `keyed` mode |
| `scale-bar: on` | Scale bar derived from `scale:` / `extent:` |
| `compass: on` | Compass rose; north is always up (spec 02 §1) — rotation is out of scope for v0.1 |
| `numbers: on` | Coordinate labels appropriate to the grid: edge letters/numbers on square grids, in-hex addresses on hex grids; ignored on gridless maps |

## 5. Rendering obligations

Renderers SHOULD avoid label collisions and MUST place labels deterministically (spec 02 §8.2 — seeded, stable across re-renders); explicit hints always win over automatic placement. Labels of `hidden` entities and `[gm]` content appear only in GM mode, per the fail-closed rule (spec 01 §6).

When a map holds more detail than its size can sustain, renderers resolve label pressure the way a cartographer would, in this order:

1. **Proximity outranks size.** A label anchored to a point marker is meaningful only next to its marker — point labels claim placement first and migrate least, and names with room to roam (areas, realms, seas) yield space to them. Within the point tier, more important markers (larger tiers) claim before minor ones.
2. **Shrink before moving far.** A label that cannot be placed at full size SHOULD be retried at smaller sizes, down to a legibility floor, before being displaced from the feature it names.
3. **Omit before overwriting.** If a label still cannot be placed without substantially covering other map text, renderers MAY omit it entirely — an unlabeled marker reads better than two names on top of each other. Author-placed `[labels]` overrides are never omitted.
4. **Repeat rather than cross.** A name spanning a long feature (a sprawled sea, a realm) whose natural midpoint is densely built over MAY be repeated once on each side of the occupied stretch instead of being drawn across it.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
