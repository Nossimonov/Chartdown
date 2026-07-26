# 05 — Map Primitives

**Status: Draft** (accepted from proposal [#17](https://github.com/Nossimonov/Chartdown/issues/17) as proposed). Enumerates the shared **topographic standard library** and defines the **region** and **hexcrawl** map types: their sections, the hex ledger grammar, and exploration states. Battlemap-specific vocabulary is section 06. No new mechanisms appear here — everything below is content under specs 01–04, which is why this section carries no ADR.

## 1. The topographic standard library

The standard library is a Chartdown vocabulary document (spec 04 §2), reproduced here normatively. Renderers MUST bundle it; documents may shadow any of it. Words use their natural spoken form; tiers and variants are derivations, not parameters.

```chartdown
# Chartdown Standard Library — topographic

[vocab]
; terrain
sea : terrain
lake : terrain
plains : terrain
grassland : terrain
farmland : terrain
forest : terrain
jungle : terrain
hills : terrain
mountains : terrain
peak : terrain
volcano : peak states=dormant,erupting
marsh : terrain states=difficult
desert : terrain
dunes : desert
snowfield : terrain
tundra : terrain
wasteland : terrain

; linear features
river : path
stream : river width=1
road : path
trail : road
canal : river
pass : path
coastline : path

; crossings — features that sit on paths by relation
ford : feature states=difficult
bridge : feature

; settlements — one base word, tiers by derivation
settlement : feature
capital : settlement
city : settlement
town : settlement
village : settlement
hamlet : village

; sites
keep : feature
castle : keep
tower : feature
ruin : feature
dungeon : feature
lair : feature
camp : feature
mine : feature
shrine : feature
temple : shrine
port : feature
cave : feature
landmark : feature

; zones
realm : zone
region : zone
border : zone

; annotation (see section 07)
note : feature

; placed morphology (§4)
cape : terrain morph=jut        headland : cape     peninsula : cape    spit : cape
bay : terrain morph=bite        cove : bay          sound : bay         fjord : sound
island : terrain morph=detached islet : island      atoll : island      oxbow : terrain morph=detached
```

**A solitary mountain is a point, not a small region.** `peak` places one mountain at a position — Erebor's meaning is that it stands *alone*, which `mountains … blob size=` cannot say, because that draws a small mountainous region. `volcano : peak` is an ordinary derivation, so it inherits the point-scale placement and a theme may swap the motif exactly as `licorice-forest` swaps a forest's; absent a theme the renderer still distinguishes the two silhouettes, so the derivation reads on the map rather than only in the display name ([#95](https://github.com/Nossimonov/Chartdown/issues/95)).

The list is deliberately curated: every missing word is one `[vocab]` line away (spec 04 §3's escalation ladder), and a small library is a stable one.

## 2. Region maps

Known sections: `[water]`, `[terrain]`, `[paths]`, `[settlements]`, `[features]`, `[realms]` — plus the universal `[vocab]` and `[gm]`, and `[labels]` (section 07). Sections provide inference context (spec 04 §3) and skim structure; lines inside use the standard grammar.

**Water and coastlines.** Water bodies are ordinary terrain areas; `coastline` is an ordinary path. A water area placed with the half-plane form — `coastline coast : from …` then `sea "The Argen Sea" : west of coast` — fills the map extent on the stated side of the referenced path, clipped to it. (Per spec 03, the coastline carries an explicit id because things reference it.) There are no winding-order conventions: the sea is on whichever side the author says, which is what the line reads as.

**Terrain kinds** (ADR 0013). Terrain facts come in three geometric kinds, each with its idiom:

- **Patches** — forests, marshes, wealds: things with an outline sitting *on* the ground. `blob`/`area`, the paint-on-parchment model, unchanged.
- **Belts** — ranges following a spine with breadth: `ridge <points> width=<measure>` (spec 02 §9).
- **Zones** — climatic terrain (tundra, desert, icecap) defined by a **frontier, not an outline**. A zone scoped to one landmass declares an `area` whose edges follow the frontier and the coasts (the same feature-following as realm boundaries, ADR 0012): `tundra "The White Reach" : area (1055,205) along "The Frostline" (1505,145) along fareast (1540,0) (1020,0) along eastshore` — each continent carries its own frontier, and adding a second continent's tundra is a second declaration. The half-plane form (`north of <ref>`) remains for truly map-wide zones; note a half-plane spans the FULL map beyond its frontier, every landmass included. Either way, renderers give zonal terrain honest terrain fill — never the washed zone tint — and a non-coastline path serving as a zonal frontier renders in the frontier register (a fine dotted line in the zone's tint), not at river weight.

**Water wins every overlap.** Terrain of every kind — patches, belts, and zones alike — is clipped to the land side of the water bodies it meets: where a range reaches the sea, or a gulf bites into one, the water edge cuts it cleanly. This is a property of the map model, not of one terrain kind, and it is what lets a belt run right up to a shore without bleeding onto it, and one named range be split by a gulf without the author pre-splitting it. Islands are the converse and stay land: an island rises *above* the sea that surrounds it.

**Named ground.** The optional region header key `ground: <terrain-word>` states what unmarked land is (`ground: plains`); the theme paints the base accordingly. Unstated, the ground is unspecified open land — the parchment.

**Mountains: crest and extent coexist; refinement is additive** (ADR 0013). `ridge (…)` declares the crest and sketches the extent (the belt). Adding `area (…)` *on the same entity* refines the extent while the crest remains — `along <ref>` always means the declared crest, so references never break under refinement. An area-only mountain entity (a plateau, a highland waste) has **no crest**: a line-needing reference to it is ambiguous and fails loud, resolved by naming a face — `along south edge of <ref>` (spec 02 §7). All political outcomes are authorable and none is a representational default: border on the divide (`along <ref>`), a no-man's march (each realm to its near face), or a whole-range claim (boundary along the far face).

**Political boundaries** (ADR 0012, superseding the original border-as-path idiom). A realm's boundary is its own geometry, and a border names a **relationship**, never a location:

- **Realm edges may follow features.** Inside an `area` point list, `along <ref>` between two vertices makes the boundary trace the referenced feature's rendered curve between the projections of those vertices (the same feature-following as `from A to B along X`, spec 02 §7): `realm valemark "Valemark" : area (110,240) along westspine (552,540) …`. One definition — moving the feature moves the border.
- **`border` attaches a state to a stretch of one realm's boundary.** Its predicate names the realm, an optional stretch selector, and a state word: `border : valemark contested` (blanket — every frontier stretch not abutting another realm), `border : valemark east contested` (facing selector), `border : valemark along westspine sealed` (feature selector), `border : valemark carrowen contested` (two-realm sugar: both realms' shared stretch, symmetric). More specific selectors win where declarations overlap: along-feature beats facing beats two-realm beats blanket. State words are ordinary vocabulary resolving through the theme chain (spec 04 §3) — unknown states render generically, never fail. `gm=` on a border annotates the relationship and is GM-only as usual.
- **Facing is per edge, by outward normal** — the direction an outsider crosses from — bucketed into eight compass sectors, ties rounded clockwise. A bare facing word selects only **open** edges (the outward-normal ray from the edge midpoint escapes without re-entering the realm); the `inner` modifier selects the complement (edges facing the realm's own land across a bay). A C-shaped realm's `north` border is its very top alone; `inner north` is the bay's south shore; the bay's back wall stays open toward the mouth it faces.
- **Overlapping realm claims are legal and meaningful** — two realms declaring the same land is a disputed march, not an authoring error; renderers blend the tints and draw both boundaries. Asymmetric states on a shared seam are likewise permitted (each side declares separately) — each realm's own boundary stroke carries its own state.

A border whose realm reference resolves to nothing, or whose named realms never abut, has nothing to style; renderers SHOULD warn and MUST NOT invent geometry for it. Realm membership by half-plane (`realm "Khar" : east of spine`) remains available.

## 3. Hexcrawl maps

Known sections: `[hexes]`, `[routes]`, `[regions]`, plus universals.

**The ledger line** (the sanctioned shorthand of spec 01 §7 / spec 02 §4):

```
<address-or-range> <terrain-word> <feature-word>* ["Display Name"] <param>*
```

The first vocabulary word is the hex's terrain; subsequent feature words are its contents; a display name attaches to the most prominent content, or to the hex itself if there are none. The grouped form (`forest : C4 D3 D4`) remains legal per spec 02 §4.

**Exploration states.** Omission = unexplored (fog/blank per theme). Two hex params refine this, both player-render concerns that GM mode ignores:

- `seen` — terrain renders, contents and labels are hidden: spotted from a ridge.
- `unexplored` — force-fog a mentioned hex, so a GM can pre-author the whole region in one document and reveal per session; the GM render shows everything.

**`[routes]`** — path-archetype words with ordered address sequences (adjacency rules per spec 02 §4). **`[regions]`** — zone-archetype words with address sets and ranges; the renderer derives the boundary.

## 4. Placed morphology

*(From proposal [#93](https://github.com/Nossimonov/Chartdown/issues/93), decided in [ADR 0023](../decisions/0023-detail-is-data-not-noise.md).)* Matching a hand-drawn coast with `via` points alone costs hundreds of coordinates, and a bare vertex is **not a nameable thing** — you cannot hang a `gm=` note or a `detail=` sub-map on "the third wiggle". Morphology words place the **discrete features** that give a coast or a river life, each a first-class entity:

```chartdown
[water]
coastline coast : from (250,20) via (150,182) (112,262) (272,322) to (250,600)
cape : on coast at (150,182) size=22mi                       ; a nameless headland — real, and pointable-at
cove : on coast at (196,300) size=15mi                       ; a landward bite
island himling "Himling" : near coast at (95,250) size=8mi   ; born named
```

- **Placement** uses the existing relational forms (spec 02 §7): `on <line> at <point>` for a feature that deforms its host, `near <line> at <point>` for a detached one. `size=` is a measure giving its extent along the host.
- **`morph=` says what the geometry does; the word says what the thing is.** The facet is a closed set — `jut` pushes the host line away from the water, `bite` pulls it landward, `detached` draws a separate shape offset from it. The two are independent on purpose: `bay` and `cove` both bite while being water, `island` and `oxbow` are both detached while being land and water respectively, and a theme colours each by its word.
- **Direction is inferred from the host, not declared.** A `jut` on a coastline goes seaward and a `bite` goes landward, resolved from which side of the line the water lies on; an author never restates what the coast already knows.
- **Geometry is a pure function of the placed data** — kind, anchor, size — and is independent of `seed:` and of every other entity. A feature therefore never drifts under an unrelated edit, which is the whole point of ADR 0023.
- **Promotion is geometry-stable** (spec 03). `island : near coast at (95,250) size=8mi` and `island himling "Himling" : near coast at (95,250) size=8mi` render **identically**. Naming adds a story, not a shape — otherwise a feature would move at the moment a campaign named it.
- **A feature is drawn at its declared size or reported — never quietly resized.** ADR 0023 allowed either clamping or failing loud; the spec requires **failing loud**. A clamp deliberately discards map data, and worse, it makes `size=` a lie: the same 90mi cape would come out different lengths on different stretches of coast, so the number in the document would stop determining what is on the map. Where a feature cannot be drawn as written the renderer MUST report an **error** naming the feature, its size, and its host, and leave the course undisturbed.
- **A course may not cross itself, and may not fold to a point.** Simplicity alone is not sufficient: a curve can come to a cusp and turn back without ever intersecting itself, which draws a spike where a bay was asked for. Both are non-conforming.
- **The bite is one direction, not an offset of the curve.** A feature displaces its window along a single direction — the host's normal at the anchor. Offsetting each point along its own local normal is *not* conforming: on a headland the two arms have normals pointing well apart, so the halves of the feature travel differently and pinch the course between them, and a bay a cartographer would happily draw becomes undrawable.

Spec 02 §9's noise-free spline is **affirmed, not revised**: the connecting curve stays a smooth spline through the declared controls, and this is a discrete layer on top of it. The complementary case is [#96](https://github.com/Nossimonov/Chartdown/issues/96)'s organic finishing of terrain area outlines — a wood's edge is *texture*, which may be generated; a cape is a *feature*, which may not. That boundary is why organic finishing is refused for `[water]` and for `along`-following outlines (§2).

**Staged, not omitted:** line-*branching* morphology — `delta`, `fork` (the inverse of `join`, [#94](https://github.com/Nossimonov/Chartdown/issues/94)), and cut-off meanders — is a different geometric problem from deforming a single spine and is deliberately not specified here. Those words are not in the standard library yet, so a document using one gets spec 04 §3's unknown-word treatment rather than a silently inert declaration.

## 5. Cross-cutting

- `difficult` is a terrain/feature flag with archetype-level meaning (movement cost), carried into VTT export.
- Crossings compose with paths by relation (`ford : on "The Redford" at K9`) or direct placement at battlemap scale — there is no crossing archetype.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
