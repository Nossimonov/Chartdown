# Use-Case Narratives

*Fulfills [#2](https://github.com/Nossimonov/Chartdown/issues/2). One narrative per target map type plus a fourth exercising scale-agnosticism, grounded in the personas from [vision.md](vision.md). Each ends in concrete expressiveness requirements — the checklist its aspirational example ([#3](https://github.com/Nossimonov/Chartdown/issues/3), [#4](https://github.com/Nossimonov/Chartdown/issues/4), [#5](https://github.com/Nossimonov/Chartdown/issues/5)) must satisfy and the syntax must eventually serve.*

Map types are distinguished by **content model**, not grid shape:

| Map type | Content model | Grid |
|---|---|---|
| Battlemap | **Geometry on a grid** — walls, terrain shapes, and props positioned in continuous space; the grid is a measuring overlay | Square or hex |
| Hexcrawl chart | **Cell-content** — the hex is the atomic unit; content is keyed by hex address, nothing exists at sub-hex resolution | Hex |
| Region map | **Anchored geometry, no grid** — features positioned continuously, related topologically ("the road follows the coast") | None |

Battlemaps lead (per the [prior-art survey](prior-art.md): the uncontested genre); hexcrawl charts follow; region maps are the acknowledged hard problem.

These are content models, **not scales**. The fourth narrative below (site map) deliberately sits between region-map and battlemap scale to force the primitives to be scale-agnostic — a temple complex is anchored geometry at hundreds of feet, not a new map type.

---

## 1. Battlemap — the prepping GM

It's Monday night. Sarah runs D&D for five friends on Wednesdays, and her prep lives in an Obsidian vault synced to a git repo. Tomorrow's session: the party escorts a merchant's wagon to Redford, and goblins will ambush them at the river crossing. She has the encounter written — stat blocks linked, tactics noted — but no map, and the scene needs one: there's a ford, a ruined toll house the goblin archers will shoot from, and she wants the players to *see* why fighting in the muddy shallows is a bad idea.

Her options tonight are all bad: forty minutes in Dungeondraft for a scene that will be over in one session, or drawing it marker-on-vinyl at the table from memory. What she wants is to type the map directly into the prep note she already has open — river across the middle, the ford, the toll house with two walls collapsed, a door, the mud, the wagon, four goblins placed, PC starting zone — read it back like a sentence, and see it rendered in preview. Wednesday she'll throw it on the TV from Owlbear Rodeo, or print it at inch-per-square. If the campaign moves to Foundry someday, the same file should export with walls and light sources intact. During the session, "the toll house" in her tactics note links to the building on the map.

**Good enough:** a clean, legible tactical map — recognizably a ford, a ruin, and mud, with correct positions and a readable grid. Not pretty. Authored in under ten minutes; edited (move the wagon, add two goblins) in under one.

### Expressiveness requirements

- Declare a square grid with dimensions and real-world cell scale (e.g. 20×15 at 5 ft); hex grids must be declarable for systems that fight on hexes.
- Terrain areas with semantic types (river, mud, forest) from approximate, low-effort shapes — a handful of points, not traced outlines; a "difficult terrain" property that renderers mark visibly.
- Paths with width (the river itself, a road) and fords/crossings over them.
- Structures: wall segments as polylines; ruined/partial walls; doors with open/closed state; windows/arrow-slits (sight without passage).
- Props as point features with a semantic type and optional facing (overturned wagon, campfire, crates).
- Tokens: creature type + instance name (`goblin g1..g4`), size in cells (an ogre is 2×2), allegiance for coloring; a batch syntax so four goblins are one line, and a marked area rather than tokens for "PCs start here."
- Light sources with rough radius (campfire, lantern) — the toll house interior should read as dark.
- Elevation for set-piece terrain: ledges, sniper perches, and tiered arenas as areas at declared heights, with the drop height being the difference (martial players *will* ask what they can kick an enemy off of); traversable transitions (stairs, ramps). *(Added with [#18](https://github.com/Nossimonov/Chartdown/issues/18) — its absence from the original narrative was a writing gap, not evidence of non-need.)*
- GM-only annotations (the archers' hiding spot, a trap trigger area) excluded from a player-facing render.
- Named entities addressable for prose crosslinks ("the toll house," "the ford").
- The whole scene in roughly 25 lines, skimmable unrendered; a one-line diff when the wagon moves.
- Renderable to screen and to print at true scale; wall/door/light semantics carry into UVTT export losslessly.

---

## 2. Hexcrawl chart — the sandbox GM

Marcus runs an OSR sandbox. The campaign *is* the map: a 24×18 chart of six-mile hexes the party gradually explores, expanded every week in whatever direction they wander. His current tool is a spreadsheet keyed by hex number plus a hand-drawn map that's three sessions out of date, because redrawing is the chore he always defers.

What he wants is a chart he maintains like a ledger: one line per hex — terrain, what's there, what it's called. Session prep is appending lines for the six hexes the party might reach. The Duchy of Bren is a shaded overlay across thirty hexes; the Old Trade Road threads through a dozen; hex 0712 says "ruined watchtower" to the players but carries his private note about what's underneath. After Wednesday's game he types four lines for the newly explored hexes, commits, and the diff *is* his exploration log. The rendered chart — hex numbers on, icons per terrain — goes up on the party's campaign site, generated from the same file, secrets stripped.

**Good enough:** a classic wargame-style hex chart — terrain icon and number per hex, settlement icons sized by importance, routes and borders visible — that never falls out of date because it *is* the record.

### Expressiveness requirements

- Declare hex orientation (flat/pointy), offset parity, chart dimensions, and per-hex scale (6 miles).
- One line per hex: address + terrain type + zero or more features + optional quoted label; unmentioned hexes render as blank/unexplored.
- Address ranges or runs for bulk terrain (a mountain chain in one line) — but single-hex lines remain the norm so diffs stay line-per-hex.
- Point features within the hex vocabulary: settlement tiers (city/town/village), dungeon, ruin, lair, landmark.
- Multi-hex overlays: named regions/realms spanning listed hexes (border rendering), and routes threading an ordered hex sequence (road, trail, river).
- Per-hex and per-feature GM-only content, stripped from a player render; ideally "hex known/unknown to players" state.
- Hex-number display toggle; a legend generated from the terrain types actually used.
- Line-oriented enough that append-only growth and clean diffs are the natural result.
- Vocabulary compatible in spirit with Text Mapper's (terrain-word-per-hex), so migration from the incumbent is mechanical.

---

## 3. Region map — the worldbuilder

Elena has run campaigns in Vessany for six years. The setting lives in a wiki of two hundred Markdown pages, but the continent map is an Inkarnate raster from 2022: two cities have since been founded in play, a war moved a border, and none of it is on the map because editing means an evening in a paint tool she's half forgotten. The map she shows players contradicts the wiki.

What she wants is the map as another wiki page: the coastline roughly sketched, the Serpent's Spine mountains running down the east, rivers descending to named bays, twelve settlements from capital to village, the Vessany/Khar border, the coast road. When the Treaty of Argen moves the border, that's an edit to one line and a git commit that says so — the map's history *is* the setting's political history. Every settlement on the map links to its wiki page; clicking Highkeep on the rendered map opens Highkeep's lore. And when she adds the new town of Merrow's Rest, the rest of the map must not reshuffle — everything else stays exactly where it was.

**Good enough:** a clean atlas-style political/physical map — the kind found inside a fantasy novel's cover. Recognizable geography, tiered labels, borders. Not painterly; *stable*, current, and linked.

### Expressiveness requirements

- Gridless continuous positioning that remains human-writable and skimmable — the core design risk. Candidates the syntax must weigh: coarse coordinates, named-anchor-relative placement ("40 mi northwest of Highkeep"), or both; authors must never need pixel-precision.
- Large organic areas (coastline, forest, mountain range) from sparse point sketches, smoothed by the renderer — deterministically, so re-renders are stable.
- Topological path declarations: a river runs *from* the Spine *to* Gull Bay; the road connects Highkeep *to* Merrow's Rest *along the coast* — by reference to named things, with optional shape hints, rather than coordinate traces.
- Point features with importance tiers (capital/city/town/village, plus landmarks) controlling icon and label weight.
- Named regions with borders — both drawn boundaries and "everything between these features" — that can change without redrawing geography.
- Label hierarchy and placement hints (a sea label sprawls, a village label sits tight); labels derived from entity names by default.
- Every named entity is a stable anchor: prose links to it, renderers link it back to prose (vision principle 6), and its identity survives repositioning.
- Additive stability: new features never move existing ones; a border change is a localized diff.
- Scale declaration and optional scale bar / compass rose.

---

## 4. Site map — the publisher

Priya writes and sells homebrew adventures. Her current project, *The Midsummer Carnival*, is set in a sprawling carnival on a lakeshore: the gate plaza, a midway of stalls, the big top, a menagerie, the fortune-teller's wagon out past a hedge maze. The adventure needs a map of the grounds — not a battlemap; nothing here is fought over at five-foot resolution — but a **site map** that defines the physical spaces in broad terms, so a GM running it understands what's adjacent to what, how far the scream carries, and where the chase scene can sprawl.

Two locations inside it *do* get battlemaps (the big top's interior for the finale; the menagerie when the cages open), and the site map must hand off to them: the big top on the grounds map links to its battlemap and to its chapter in the adventure text. Because this is published work, it must render acceptably for every reader on the default theme — and readers with their own asset libraries or peculiar tastes should be able to re-render *her* maps with *their* look without touching her source.

**Good enough:** a clear grounds plan — recognizable structures as broad shapes, named zones, paths between them, a scale bar — that reads like the keyed site maps in a published adventure module.

### Expressiveness requirements

- Declare real-world scale in human units (feet/yards) with **no grid required**; a coarse grid optional for GMs who want one.
- The *same* structure and terrain primitives as the battlemap (walls, paths, areas, point features) usable at this scale — no separate "site map vocabulary."
- Broad-stroke structures: a tent as an ellipse, a stall row as repeated rects, a hedge maze as an area with a type — shapes with semantic labels, not floor plans.
- Named zones with soft boundaries (the Midway, the Menagerie) that group features without drawing hard borders.
- Hand-off links: an entity can declare it is *detailed by* another Chartdown document (site map → battlemap) and by a prose section; renderers surface both directions ([#11](https://github.com/Nossimonov/Chartdown/issues/11)).
- Publishing-grade portability: renders completely on a bare default theme; reader-side themes/assets override appearance with zero source edits.
- Keyed labels (1. Gate Plaza, 2. Big Top…) with a generated key/legend, module-style.

---

## What cuts across all four

Requirements appearing in every narrative, which the document model ([#7](https://github.com/Nossimonov/Chartdown/issues/7)) should treat as universal rather than per-map-type:

1. **Named entities with stable identity** — for crosslinks in both directions and for edit stability ([#11](https://github.com/Nossimonov/Chartdown/issues/11)).
2. **GM/player render split** — secret content in the same source, stripped by render mode.
3. **Diff-shaped syntax** — one fact per line wherever possible; the git diff should read as the change log of the world.
4. **Semantic vocabulary with renderer-owned appearance** — every narrative says *what* things are; none says what color they are. Themes may map types to user-supplied art (Priya's readers, Sarah's "their wagon"), but every map renders from bare primitives with zero assets (vision principle 4).
5. **Skimmable unrendered** — each author reads their file back as notes.
6. **Scale-agnostic primitives** — the same vocabulary describes a continent, a carnival, and a toll house; only the declared scale changes. No primitive may bake in an assumed scale.
7. **Agent-writable** — people will ask AI assistants to draft these files. The spec must be packaged for machine ingestion: a formal grammar, a paired source-and-render example corpus, and a single-file spec digest.
