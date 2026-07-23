# Chartdown Digest — spec v0.3

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

Header keys: `chartdown:` (spec version pin) · `id:` (doc slug for anchors) · `grid:` · `scale:` · `extent: 900x600mi` (gridless size) · `seed:` (int; varies deterministic organic rendering) · `use:` (import vocabulary doc; repeatable) · `theme:` (suggestion only) · `labels: names|keyed|none` · `legend: on` · `scale-bar: on` · `compass: on` · `numbers: on` · `ground: <terrain-word>` (region: names what unmarked land is). Unknown keys/sections warn; `[x-*]` sections are silently ignored (extension namespace).

## The one line grammar

`subject : predicate` — subject = `[type-word] [id-words] ["Display Name"]`; predicate = placements, bare words (flags/vocab), `"strings"` (text), `key=value` pairs. **No parentheses in the language.** Flags: bare words (`hidden`, `difficult`, `overturned`, `ruined`, `nolabel`, `seen`, `unexplored`, `drop`, `open`). Params: `key=value` (`width=2`, `facing=south`, `light=20ft`, `size=2x2`, `elevation=15ft`, `side=party`, `gm="text"`, `link=path`, `detail=map.cd`, `key=3`).

## Positions (spec 02)

- **Cells, all grids**: chess-style `K11`, `C4` (columns A..Z, AA…; 1-indexed; row 1 = north). Ranges `A11..F15` (rect / hex run / hex block). Lists: `C12 E13`.
- **Edges/corners**: `O6.s` (n/e/s/w), `K5.nw` (corners). Wall runs: `wall : K5.e K6.e K7.e`.
- **Gridless points**: `(x,y)` in extent units from NW origin; point ranges `(x1,y1)..(x2,y2)`.
- **Shapes** (renderer finishes organically, deterministically — finishing is not inventing; give major paths generous `via` points): `area <cells|points|range>` · `path <seq> width=N` · `blob <center> size=<measure>` · `ridge <seq> width=<measure>` (an elongated MASS along a spine — `width=` is its breadth; the belt is the footprint, not the centerline; `ridge (…) area (…)` on one entity refines the extent while the crest survives for references).
- **Aspect adaptation** (03): a reference names the THING, not its geometry class — point-needing forms take point→line midpoint→centroid; line-needing (`along`, endpoints) take polyline (a range's crest)→area boundary (rivers stop at shores); area-needing take polygon→a ridge's belt. Never guesses between multiple meaningful lines: `along` a crestless AREA fails loud; disambiguate with a face — `along south edge of <ref>`. Terrain kinds (05): patches (blob/area), belts (ridge), ZONES — climatic terrain by frontier. Continent-scoped: an `area` whose edges follow the frontier + the coasts (`tundra "The White Reach" : area (…) along "The Frostline" … along eastshore`) — each landmass its own frontier. Map-wide: half-plane (`north of <ref>`; spans the FULL map beyond the frontier). Honest fill, seas win overlaps; frontier paths render dotted in the zone's tint, never river weight.
- **Relational placement — closed grammar, only these nine forms**:
  `at (x,y)` · `70mi north of <ref>` · `east of <ref>` (half-plane) · `on <ref>` · `on <ref> at <point|local>` · `south edge of <ref>` · `near <ref|point>` · `from <ep> via (p) (p) to <ep>` · `along <ref>`. Endpoints: ref, point, or `ref at (point)`.
- **Referent-frame `at` payloads (#34)**: `on kitchen at C2..D2` — a cell/range/edge after `at` is LOCAL to the referent (structure footprint frame, NW cell = A1; moving the structure moves its contents). A path's frame is the document grid (= the crossing chooser). Detail lines use `at`-prefixed placements for the implicit parent frame: `door : at E2.e`. Absolute placement stays legal everywhere — author's choice per line, never a mode; renderers surface the resolved absolute address (tooltips). Outside-footprint local, frameless referent, or cross-level referent = error.
- **Resolution rules**: references only to *earlier* declarations (forward ref = error); deterministic (document+seed); fail-loud (no room / ambiguous = error — renderers never relocate others); anchors are **live** (moving an anchor moves dependents; use a remnant landmark — `ruin "Former site of X"` — when destroying one); output is **well-formed XML** for every valid document, whatever characters user text contains.

## Identity & links (spec 03)

- Id = explicit id word(s), else slug of display name; neither = anonymous (renderable, unreferenceable). Explicit-id collisions: parse error.
- References: bare word = id lookup; `"quoted"` = display-name lookup; miss/ambiguity = error (fix: add explicit id).
- Anchors exported as `cd-<doc-id>-<entity-id>`; display-name anchors change on rename (like Markdown headings); explicit ids are stable. `link=` = entity's prose/URL; `detail=` = entity detailed by another Chartdown doc.
- `[gm]` lines: resolving subject = attachment (adds GM notes; placements forbidden); non-resolving + placement = new GM entity; non-resolving + no placement = error. `player` render mode is default and strips `[gm]`, `gm=`, `hidden`.

## Vocabulary (spec 04) — the language knows no nouns

- Nine closed archetypes: `terrain path feature structure barrier opening token zone light` (facets: `passes=`, `sight=` on barrier/opening; `size=`,`side=` on token; `range=` on light).
- `[vocab]` entries: `word : archetype [facets]` or **derive** `word : other-word [overrides]` (`licorice-forest : forest` — forest semantics, theme swaps the motif). Sources shadow in order: standard library < `use:` files < document.
- **Unknown words never fail**: archetype inferred from shape/path phrase → section context → lone point/cell → `feature`; renders generic glyph + word as label, deterministically tinted by the word's base (theme `fill=` overrides) so distinct types stay tellable apart on map and legend. Spelling never inspected (no suffix magic).
- Themes own all appearance (assets live in themes, never map source); fallback chain ends at generic shape + label, so rendering never blocks.

## Standard library (spec 05/06, curated ~80 words)

- **Terrain**: sea lake plains grassland farmland forest jungle hills mountains marsh(difficult) desert dunes snowfield tundra wasteland | battlemap: mud(difficult) sand grass snow ice(difficult) water(difficult) rubble(difficult) slope
- **Paths**: river stream road trail canal pass coastline
- **Zones**: realm region border (border = a relationship+state, never a location — see region row)
- **Crossings/sites**: ford(difficult) bridge keep castle tower ruin dungeon lair camp mine shrine temple port cave landmark stairs ramp
- **Settlements** (derived tiers): settlement → capital city town village hamlet
- **Structures triad** (UVTT-aligned): building(ruined) wall(ruined) fence(sight=all) pillar door(passes=closed,sight=none) gate window(passes=none,sight=all) arrow-slit
- **Props**: wagon(overturned) crates barrel chest table altar statue well boulder tree pit(difficult) campfire(light=20ft) torch lantern brazier
- **Zones/misc**: realm region start note
- **No bestiary by design** — creatures are user words via token inference (`goblins g1 g2 : C12 E13`).

## Map types & sections

| Type | Sections | Notes |
|---|---|---|
| `battlemap` | terrain, structures, features, tokens | structure detail lines indented under a `building` (`ruined : north east`, `door : O6.s`); footprints = rect/cell-union (orthogonal only; perimeter derived; on unions a `ruined` side word selects perimeter edges by facing); token word + area = staging zone; `elevation=` on areas — ledges auto-render where heights differ; crossings derive from geometry: `ford : on <river-id> on <road-id> difficult` occupies the bands' intersection (multi-crossing ambiguity errors; `at <cell>` chooses); road×river overlap without a crossing warns; area terrain layers beneath path bands — declare your bank cells; fallback word-labels are tooltips at battle scale (text labels: names/tokens/zones only); multi-level: `levels: upper ground cellar` (physical order, topmost first; `level:` names the default), `[structures upper]` section qualifiers or `level=`, any feature with `to=<level>` is a connector (auto-states `.up`/`.down` for themes), one panel per level; `drop` flag = fall-edge boundary (ticked cliff line); level surfaces are declared: `earth : area …` (underground rock), `air : area …` (open sky above unfloored space), `roof : area … difficult` (lower ceilings), `terrace` (walkable raised ground); feature footprints = range placements (`table hightable : G3..I3`); `open` flag on structures = walls without a ceiling (courtyards; themable state `building.open`; sky cells checked against `air` above on multi-level maps; flattens on UVTT export); UVTT export (§9, normative): one file per level, grid units — walls minus opening edges → `line_of_sight`, openings → `portals` (closed per `passes`; window = los hole + shut portal), `light=` → `lights`, grid → `resolution`; tokens/fences not exported; mode applies first (player export carries no secrets); caller supplies the raster image; room/zone labels render beneath features and tokens AND dodge them (nearest clear row to room center); line-feature labels anchor at the rendered course's arc-length midpoint, sliding along the course when crowded |
| `hexcrawl` | hexes, routes, regions | ledger line: `C4 forest ruin "Name" gm="…"` (first word = terrain, rest = contents); omission = unexplored; `seen` = terrain only; grouped sugar `forest : C4 D3` legal |
| `region` | water, terrain, paths, settlements, features, realms | water by half-plane: `coastline coast : from …` then `sea "X" : west of coast` (referenced things need ids); realm edges may FOLLOW features: `area (110,240) along westspine (552,540) …` traces the feature's curve between the two vertices (one definition — moving the feature moves the border); `border` attaches a STATE to a stretch of one realm's boundary, never a location: `border : valemark contested` (blanket frontier) · `border : valemark east contested` (facing = outward normal, 8 sectors, ties clockwise; bare facing selects OPEN edges only — ray escapes without re-entering; `inner` selects bay edges) · `border : valemark along westspine sealed` (feature stretch) · `border : valemark carrowen contested` (two-realm sugar: shared stretch, both sides); specific beats general; states are ordinary vocabulary (theme chain); overlapping realm claims are legal (disputed march — tints blend, both boundaries draw) |

Universal sections: `[vocab]`, `[gm]`, `[labels]` (overrides must resolve: `"The Argen Sea" : sprawl (60,200)..(120,450)`, `highkeep : north`; free text needs `note`). Label density conduct (07 §5): point-marker labels claim placement first and migrate least (important tiers before minor); a label SHOULD shrink toward a legibility floor before moving far, MAY be omitted rather than drawn over other text (author overrides never omitted), and a long sprawled name whose midpoint is built over MAY repeat once per side instead of crossing it.

## Themes (spec 08)

A theme is a Chartdown document of `[theme]` + `[glyphs]` sections (no `map:`). `[theme]` lines: `<subject> : <pairs>` where subject = vocabulary word (chain-resolved) · `word.state` · zone `word.core`/`word.edge` (reserved; band margins / area boundary — foothills are `mountains.edge`) · `side.<word>` · surface (`paper grid fog ink light ledge`). Closed pairs: `fill stroke width dash opacity glyph asset edge`. `[glyphs]`: `name : "SVG path"` in a 24×24 origin-centered box. `glyph=`/`asset=` take comma-separated variant pools chosen by deterministic position hash. Inheritance: `use:` + shadowing (`use: default` = built-in). A map's `theme:` is a suggestion; the renderer/user wins.

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
mountains spine "The Serpent's Spine" : ridge (700,60) (740,280) (690,530) width=60mi
[settlements]
capital highkeep "Highkeep" : (360,330) link="lore/highkeep.md"
city "Argenport" : on coast at (160,470)
town "Merrow's Rest" : on coast 70mi north of "Argenport"
[realms]
realm vessany "Vessany" : west of spine
realm khar "Khar" : east of spine
border : vessany khar contested gm="Disputed since the Treaty of Argen."
[labels]
"The Argen Sea" : sprawl (60,200)..(120,450)
```

---

*Licensed CC-BY-4.0 as part of the Chartdown specification (ADR 0001).*
