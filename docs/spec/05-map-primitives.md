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
border : path

; annotation (see section 07)
note : feature
```

The list is deliberately curated: every missing word is one `[vocab]` line away (spec 04 §3's escalation ladder), and a small library is a stable one.

## 2. Region maps

Known sections: `[water]`, `[terrain]`, `[paths]`, `[settlements]`, `[features]`, `[realms]` — plus the universal `[vocab]` and `[gm]`, and `[labels]` (section 07). Sections provide inference context (spec 04 §3) and skim structure; lines inside use the standard grammar.

**Water and coastlines.** Water bodies are ordinary terrain areas; `coastline` is an ordinary path. A water area placed with the half-plane form — `coastline coast : from …` then `sea "The Argen Sea" : west of coast` — fills the map extent on the stated side of the referenced path, clipped to it. (Per spec 03, the coastline carries an explicit id because things reference it.) There are no winding-order conventions: the sea is on whichever side the author says, which is what the line reads as.

**Political boundaries.** `border : along <ref>` (a path following a feature) is the blessed idiom; realm membership by half-plane (`realm "Khar" : east of spine`) or explicit geometry.

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

## 4. Cross-cutting

- `difficult` is a terrain/feature flag with archetype-level meaning (movement cost), carried into VTT export.
- Crossings compose with paths by relation (`ford : on "The Redford" at K9`) or direct placement at battlemap scale — there is no crossing archetype.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
