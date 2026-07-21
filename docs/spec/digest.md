# Chartdown Digest — spec draft v0.1

*Single-file language reference for machine/agent ingestion (issue #12). Informative — the prose sections 01–07 are normative. Maintained in the same commit as any spec change. Companion: [grammar.ebnf](grammar.ebnf).*

Chartdown is a plain-text language for TTRPG maps. A document is a standalone `.cd` file **or** a ` ```chartdown ` fenced block in Markdown — byte-identical content rules.

## Document skeleton

```chartdown
# Title                       ; optional, first line only. ";" = comment anywhere.
map: battlemap                ; REQUIRED first header line: battlemap | hexcrawl | region
grid: square 20x15            ; battlemap/hexcrawl. Hex form: hex 8x9 pointy odd-row
scale: 5ft                    ; real size of one cell (grid maps)
[terrain]                     ; [sections] group content; section determines line grammar
mud : area H11..J11 difficult
```

Header keys: `chartdown:` (spec version pin) · `id:` (doc slug for anchors) · `grid:` · `scale:` · `extent: 900x600mi` (gridless size) · `seed:` (int; varies deterministic organic rendering) · `use:` (import vocabulary doc; repeatable) · `theme:` (suggestion only) · `labels: names|keyed|none` · `legend: on` · `scale-bar: on` · `compass: on` · `numbers: on`. Unknown keys/sections warn; `[x-*]` sections are silently ignored (extension namespace).

## The one line grammar

`subject : predicate` — subject = `[type-word] [id-words] ["Display Name"]`; predicate = placements, bare words (flags/vocab), `"strings"` (text), `key=value` pairs. **No parentheses in the language.** Flags: bare words (`hidden`, `difficult`, `overturned`, `ruined`, `nolabel`, `seen`, `unexplored`). Params: `key=value` (`width=2`, `facing=south`, `light=20ft`, `size=2x2`, `elevation=15ft`, `side=party`, `gm="text"`, `link=path`, `detail=map.cd`, `key=3`).

## Positions (spec 02)

- **Cells, all grids**: chess-style `K11`, `C4` (columns A..Z, AA…; 1-indexed; row 1 = north). Ranges `A11..F15` (rect / hex run / hex block). Lists: `C12 E13`.
- **Edges/corners**: `O6.s` (n/e/s/w), `K5.nw` (corners). Wall runs: `wall : K5.e K6.e K7.e`.
- **Gridless points**: `(x,y)` in extent units from NW origin; point ranges `(x1,y1)..(x2,y2)`.
- **Shapes** (renderer finishes organically, deterministically): `area <cells|points|range>` · `path <seq> width=N` · `blob <center> size=<measure>` · `ridge <seq>`.
- **Relational placement — closed grammar, only these nine forms**:
  `at (x,y)` · `70mi north of <ref>` · `east of <ref>` (half-plane) · `on <ref>` · `on <ref> at (x,y)` · `south edge of <ref>` · `near <ref|point>` · `from <ep> via (p) (p) to <ep>` · `along <ref>`. Endpoints: ref, point, or `ref at (point)`.
- **Resolution rules**: references only to *earlier* declarations (forward ref = error); deterministic (document+seed); fail-loud (no room / ambiguous = error — renderers never relocate others); anchors are **live** (moving an anchor moves dependents; use a remnant landmark — `ruin "Former site of X"` — when destroying one).

## Identity & links (spec 03)

- Id = explicit id word(s), else slug of display name; neither = anonymous (renderable, unreferenceable). Explicit-id collisions: parse error.
- References: bare word = id lookup; `"quoted"` = display-name lookup; miss/ambiguity = error (fix: add explicit id).
- Anchors exported as `cd-<doc-id>-<entity-id>`; display-name anchors change on rename (like Markdown headings); explicit ids are stable. `link=` = entity's prose/URL; `detail=` = entity detailed by another Chartdown doc.
- `[gm]` lines: resolving subject = attachment (adds GM notes; placements forbidden); non-resolving + placement = new GM entity; non-resolving + no placement = error. `player` render mode is default and strips `[gm]`, `gm=`, `hidden`.

## Vocabulary (spec 04) — the language knows no nouns

- Nine closed archetypes: `terrain path feature structure barrier opening token zone light` (facets: `passes=`, `sight=` on barrier/opening; `size=`,`side=` on token; `range=` on light).
- `[vocab]` entries: `word : archetype [facets]` or **derive** `word : other-word [overrides]` (`licorice-forest : forest` — forest semantics, theme swaps the motif). Sources shadow in order: standard library < `use:` files < document.
- **Unknown words never fail**: archetype inferred from shape/path phrase → section context → lone point/cell → `feature`; renders generic glyph + word as label. Spelling never inspected (no suffix magic).
- Themes own all appearance (assets live in themes, never map source); fallback chain ends at generic shape + label, so rendering never blocks.

## Standard library (spec 05/06, curated ~80 words)

- **Terrain**: sea lake plains grassland farmland forest jungle hills mountains marsh(difficult) desert dunes snowfield tundra wasteland | battlemap: mud(difficult) sand grass snow ice(difficult) water(difficult) rubble(difficult) slope
- **Paths**: river stream road trail canal pass coastline border
- **Crossings/sites**: ford(difficult) bridge keep castle tower ruin dungeon lair camp mine shrine temple port cave landmark stairs ramp
- **Settlements** (derived tiers): settlement → capital city town village hamlet
- **Structures triad** (UVTT-aligned): building(ruined) wall(ruined) fence(sight=all) pillar door(passes=closed,sight=none) gate window(passes=none,sight=all) arrow-slit
- **Props**: wagon(overturned) crates barrel chest table altar statue well boulder tree pit(difficult) campfire(light=20ft) torch lantern brazier
- **Zones/misc**: realm region start note
- **No bestiary by design** — creatures are user words via token inference (`goblins g1 g2 : C12 E13`).

## Map types & sections

| Type | Sections | Notes |
|---|---|---|
| `battlemap` | terrain, structures, features, tokens | structure detail lines indented under a `building` (`ruined : north east`, `door : O6.s`); footprints = rect/cell-union (orthogonal only); token word + area = staging zone; `elevation=` on areas — ledges auto-render where heights differ |
| `hexcrawl` | hexes, routes, regions | ledger line: `C4 forest ruin "Name" gm="…"` (first word = terrain, rest = contents); omission = unexplored; `seen` = terrain only; grouped sugar `forest : C4 D3` legal |
| `region` | water, terrain, paths, settlements, features, realms | water by half-plane: `coastline coast : from …` then `sea "X" : west of coast` (referenced things need ids); borders: `border : along <ref>` |

Universal sections: `[vocab]`, `[gm]`, `[labels]` (overrides must resolve: `"The Argen Sea" : sprawl (60,200)..(120,450)`, `highkeep : north`; free text needs `note`).

## Few-shot micro-corpus

```chartdown
# Ambush at Redford Crossing
map: battlemap
grid: square 20x15
scale: 5ft
[terrain]
river "The Redford" : path A9 F9 K9 P10 T10 width=2
ford : K9..L10 difficult
[structures]
building tollhouse "Ruined Toll House" : N3..Q6
  ruined : north east
  door : O6.s
[tokens]
goblins g1 g2 : C12 E13
ogre "Gruk" : G9 size=2 hidden
party start : J14..L15
[gm]
tollhouse : "Archers hold fire until the wagon is mid-ford."
```

```chartdown
# The Brenmark
map: hexcrawl
grid: hex 8x9 pointy odd-row
scale: 6mi
numbers: on
[hexes]
A1..A9 sea
B2 plains village "Saltmere"
E2 hills dungeon "The Barrowdown"
G2 mountains seen
[routes]
road "Old Trade Road" : B2 C2 D2 E2
[regions]
realm "Duchy of Bren" : C2..C4 D2..D4
```

```chartdown
# Vessany
map: region
extent: 900x600mi
compass: on
[water]
coastline coast : from (210,0) via (150,130) (120,390) to (140,600)
sea "The Argen Sea" : west of coast
[terrain]
mountains spine "The Serpent's Spine" : ridge (700,60) (740,280) (690,530)
[settlements]
capital highkeep "Highkeep" : (360,330) link="lore/highkeep.md"
city "Argenport" : on coast at (160,470)
town "Merrow's Rest" : on coast 70mi north of "Argenport"
[realms]
border : along spine gm="Disputed since the Treaty of Argen."
[labels]
"The Argen Sea" : sprawl (60,200)..(120,450)
```

---

*Licensed CC-BY-4.0 as part of the Chartdown specification (ADR 0001).*
