# 06 — Battlemap Primitives

**Status: Draft** (accepted from proposal [#18](https://github.com/Nossimonov/Chartdown/issues/18) as amended: footprint scope clarified; elevation included in v0.1). Defines the `battlemap` map type: sections, the battlemap slice of the standard library, structure details (de-provisionalizing spec 01 §4's parked construct), tokens, and elevation.

## 1. Sections

Known battlemap sections: `[terrain]`, `[structures]`, `[features]`, `[tokens]`, plus the universal `[vocab]` and `[gm]`, and `[labels]` (section 07). Paths (rivers, roads) live in `[terrain]`; shape tokens distinguish them.

## 2. Standard-library additions (battlemap slice)

```chartdown
; structures, barriers, openings — the interop-critical triad
building : structure states=ruined
wall : barrier states=ruined
fence : barrier sight=all               ; blocks passage, not sight
pillar : barrier
door : opening passes=closed sight=none states=locked,barred,stuck,ruined
gate : door
window : opening passes=none sight=all
arrow-slit : window
stairs : feature

; tactical terrain
mud : terrain states=difficult
sand : terrain
grass : terrain
snow : terrain
ice : terrain states=difficult
water : terrain states=difficult
rubble : terrain states=difficult

; elevation transitions
ramp : feature
slope : terrain

; level ground-truth (spec 06 §5, §8)
earth : terrain             ; solid ground — underground levels declare it around their rooms
terrace : terrain           ; walkable raised ground (wall-walks, balconies)
roof : terrain              ; lower rooms' ceilings seen from above — declare with `difficult`
air : terrain               ; declared absence of floor, open to the sky
void : air                  ; the same underground — a shaft or chasm, with no sky in it

; props
wagon : feature states=overturned
crates : feature
barrel : feature
chest : feature
table : feature
altar : feature
statue : feature
well : feature
boulder : feature
tree : feature
pit : feature states=difficult

; light-emitting props (light= is generic; these carry overridable defaults)
campfire : feature light=20ft
torch : feature light=20ft
lantern : feature light=15ft
brazier : feature light=20ft

; play aids
start : zone

; fields (spec 04 §5) — light is the shipped one
light : field states=dark,dim,daylight,moonlight
```

`light=<range>` is a **generic parameter** — any entity may emit light; the props above merely carry defaults (`campfire : O7 light=30ft` overrides).

**Ambient light** — the header key `light:` says what the light level is where nothing is emitting:

```chartdown
light: dark                  ; the whole map, unless a level says otherwise
light celebdil: daylight     ; …except the summit
```

Absent `light:`, behaviour is unchanged, so no existing document moves. With it, a `light=` emitter finally has a baseline to be relative to: a 30ft lamp in a `dark` map is a pool of light in blackness; the same line in a `daylight` map is a prop. Darkness is **content, not appearance** — whether the Chamber of the West-door is dark is a fact about Moria that survives changing themes, which is why it is here and not in a theme (spec 08 §6 forbids themes from altering semantics). Values are open vocabulary (`dark`, `dim`, `daylight`, `moonlight`, `witchlight`); themes map them to page treatment.

> `light` is the standard library's **field** — the general shape for anything that emanates from sources over an ambient baseline. A setting that wants radiation, silence, or antimagic declares its own in one line and gets the same four affordances; see spec 04 §5. Nothing above requires knowing that.

## 3. Structure details

An indented line beneath a `structure` entity is a **structure detail**, interpreted in the parent's frame:

```chartdown
building tollhouse "Ruined Toll House" : N3..Q6
  ruined : north east          ; wall-state : side words — whole walls
  door : O6.s                  ; opening : edge token on the perimeter
  window : N4.w
```

- **Side words** (`north east south west`) address whole walls of the footprint; **edge tokens** (spec 02 §5) address specific cell edges. Wall-state lines mark sides or edges; opening lines place doors/windows/gates on the perimeter.
- **A barrier word replaces that side's perimeter with that barrier** *(from proposal [#130](https://github.com/Nossimonov/Chartdown/issues/130))*. A collapsed passage, a rubble choke, a portcullis across a hall mouth is one side of a room that is no longer an ordinary wall:

  ```chartdown
  building hall "The Twenty-first Hall" : H2..K6
    cave-in : east               ; barrier : side words — that side IS the cave-in
    portcullis : K4.e K5.e       ; edge tokens work here too
  ```

  The named barrier's own facets apply, so **the facet decides and the word does not**: a `fence`-derived choke passes sight where the wall it replaced did not, while a barrier that declares no `sight=` blocks as a wall does. It takes its own theme entry, and it exports as that barrier. Its predicate is side words or edge tokens — the same grammar `ruined` uses, where the state is the subject and the sides are the predicate — so a bare word that is not a side is an error rather than a state of the barrier.

  A **freestanding barrier** on the same edges remains legal and merges by the coincident-wall rule below; this is the shorter spelling of it, not a replacement. The saving is on a union, where one word replaces a run of edges whose length the author should not have to count. For the same reason `every` (spec 02 §9) does not step over edges: a side word already names the whole run, however long, and survives the structure moving.
- **Detail addresses may be parent-local** *(from proposal [#34](https://github.com/Nossimonov/Chartdown/issues/34))*: an `at`-prefixed placement (`door : at E2.e`) is interpreted in the parent structure's frame (footprint NW = A1, spec 02 §7) and moves with the parent. A bare address stays absolute — the two idioms coexist per line, same as entity-level relative placement.
- Details are anonymous by default and may take ids like any line (`door back-door : Q5.e`).
- **Footprints** are a rect range (`N3..Q6`) or a cell list — the union of the listed cells and ranges. Odd *orthogonal* shapes are therefore fully in scope: an L-shaped hall is `building : K5..M8 K9..K12`, perimeter derived. On a union, a `ruined` **side word selects the perimeter edges facing that direction** (for a plain rectangle that is exactly the whole side). Only **non-axis-aligned geometry** (diagonal walls, curved keep walls, corner-point-traced footprints) is deferred beyond v0.1.
- **Smoothing note** *(non-normative)*: an angled wall is representable today as a saw-tooth of cells at the appropriate angle, and a renderer MAY render stair-stepped footprints and wall runs as clean diagonals or curves — provided movement and occupancy semantics follow the declared cells. The syntax conveys cells; appearance is the renderer's.
- **Coincident walls are one wall**: when structures share a wall line (a room built against the courtyard's wall, adjoining rooms' party wall), the coincident edges form a single wall — an opening declared in *either* structure opens the shared edge for sight, light, and passage.
- **The `open` flag** *(from proposal [#33](https://github.com/Nossimonov/Chartdown/issues/33))*: a structure flagged `open` has walls but no ceiling — courtyards, pens, ruins open to the sky: `building courtyard : D2..V10 open`. Openness is **declared, never derived** (consistent with §5's level ground-truth); it matters mechanically (flight, lobbed shots, weather) and visually, so the renderer distinguishes open interiors from roofed ones — themable as an ordinary state, `building.open : fill=…` (spec 08). On multi-level maps, an open structure's **sky cells** (its footprint minus sibling structures on its own level) should see `air` on the level above; a floor above open ground draws a renderer warning naming both entities and a cell. Universal VTT has no open/enclosed field, so the flag flattens on UVTT export (§9).
- Freestanding walls need no parent: `wall : K5.e K6.e K7.e` (edge runs, spec 02 §5), with `ruined` available as a state.
- **Openings in unbuilt geometry**: an opening MAY be declared with **no parent structure** where its edge separates a passable cell from a **declared impassable surface** (`earth`, or any word inheriting it — §5). The rock is the barrier; the opening perforates it. This is how a cave mouth, a mine adit, or a gate cut into a mountainside is written, without inventing a chamber for it to live in:

  ```chartdown
  [terrain]
  earth : area A1..IZ140                  ; the mountain
  [structures]
  passage gate-tunnel "The Gate-tunnel" : IL66..IQ74
  [features]
  gate great-gates "The Great Gates" : IQ69.e IQ70.e IQ71.e   ; opens onto rock, no parent
  ```

  Rooms **carve** the rock: a structure's footprint is floor even where `earth` was declared across it, which is what "fills everything outside the rooms" (§5) means. **So does a path**: §6 layers area terrain beneath path bands, so a road driven through rock is a cut passage and not stone — it is neither an occluder nor a door onto nothing. Solidity is always the **winning** declaration on a cell, never merely one that was made. An opening with **passable cells on both sides** (nothing to pass through) or **impassable on both** (buried in stone) is a fail-loud error naming the cell and edge. The impassable boundary is an occluder, so it exports as `line_of_sight` and the opening as a portal (§9) — previously a cave system exported with no occlusion at all except where an author had faked walls.

## 4. Tokens — no bestiary, by design

The standard library ships **zero creature words**. Creatures are setting content: an unknown word in `[tokens]` infers the token archetype (spec 04 §3) and renders as a labeled token; `size=<n>` (cells per side) and `side=<word>` (themed to colors) carry the tactics. Communities publish creature vocabularies via `use:`; themes supply art. The zero is mechanical (inference already renders anything), cultural (no implied canon), and legal (nothing IP-adjacent to police).

A **staging zone** is the standard-library word `start` (`start : zone`, §2) with an area placement — `start party : J14..L15` marks where the PCs begin — and so is any word deriving from it (`[vocab] rally : start`). One word, one archetype, one theme subject.

A **token** takes a cell; `size=<n>` makes it larger. A token word carrying an area placement is an error naming the fix, so there is exactly one spelling for a staging area rather than two that render alike and theme differently ([ADR 0015](../decisions/0015-one-staging-zone-spelling.md)).

## 5. Elevation

- **`elevation=<measure>`** is a generic parameter on areas, zones, structures, and features; default `0`. A sniper perch is a zone at height: `ledge perch "The Old Wall" : zone N2..Q3 elevation=15ft`.
- **Ledges are emergent, not drawn**: wherever adjacent placements' elevations differ, the renderer draws a theme-styled edge, and the drop is the difference — precisely the number the table asks for. There is no cliff-tracing grammar.
- **Transitions are vocabulary**: `stairs`, `ramp`, and `slope` are traversable connections, placed spanning a boundary.
- **Tokens carry no elevation** — a creature's altitude is play-state, which is VTT territory (vision non-goal: Chartdown is not a VTT).
- **The `drop` flag** marks an area's boundary as a **fall edge**, rendered as the ticked cliff line: `terrace walkway "The Wall-walk" : area M2..V3 drop`. On an upper level (§8) it bounds walkable ground against open air; on any level it is the treacherous edge the table asks about. The reverse case — underground levels — declares solid ground explicitly: `earth : area A1..Z20` in a `[terrain cellar]` section fills everything outside the rooms with rock. Upper levels declare their surfaces the same way: `air : area …` for open sky (everything unfloored is a fall to the level below) and `roof : area … difficult` over lower rooms' ceilings (climbable, not built for walking). In every case, extent is declared, never derived.

The behaviour these words carry is **declared absence of floor**, and it has two spellings: `air` where there is sky, and `void` (`void : air`) where there is not — a shaft under a mountain is unfloored in exactly the same mechanical sense as an open summit, but a theme must be able to tell them apart, and one word for both made `void.edge` (a chasm lip) and `air.edge` (a skyline) collide. Both inherit: a word deriving from either is unfloored (spec 04 §2).

**`earth` is impassable.** Solid rock is not merely a fill — nothing may stand in it, and its boundary is an occluder. Renderers and exporters MUST treat `earth` (and any word deriving from it) as blocking movement and sight; this is what lets an opening perforate it (§3) and what the `door-onto-void` diagnostic tests against.

## 6. Crossings and terrain layering

*(Added from proposal [#24](https://github.com/Nossimonov/Chartdown/issues/24); rewritten by [#25](https://github.com/Nossimonov/Chartdown/issues/25).)* Where a road meets a river, the result is a ford or a bridge — and the crossing replaces both at the overlap. A crossing's **location is a consequence, not a fact**: the canonical form derives it —

```chartdown
river redford "The Redford" : path A9 F9 K9 P10 T10 width=2
road tollroad "Old Toll Road" : path K1 K15
ford : on redford on tollroad difficult
```

- **A feature's footprint is CELLS, and a drawn shape is refused** *([#207](https://github.com/Nossimonov/Chartdown/issues/207))*. A feature is placed at a cell (`F6`) or across a range (`D4..F6`); `area`, `blob`, `path` and `ridge` are terrain's forms and a feature given one MUST be **reported as an error** naming the word and offering both spellings that work. Silence is the one answer that is certainly wrong, and it was the behaviour: `pit p : area D4..F6` rendered byte-identical to a document with no pit in it — no mark, no label, no diagnostic — so an author who wrote `area` having just written it for terrain three lines above had no way to discover the loss but to notice an absence. Refused rather than drawn because the range form already says "these cells", and two spellings for one meaning is a choice the language does not need to offer. **This binds the battlemap only:** on a region map an `area` on a feature is a declared outline (spec 05 §4, [ADR 0026](../decisions/0026-shape-is-declared-data.md)) and means something else entirely.
- **A path's ends reach the edges of its terminal cells** *([#145](https://github.com/Nossimonov/Chartdown/issues/145))*. The band is drawn through cell centres, so its terminal vertex sits in the middle of the final square — and a path drawn only that far stops halfway through the square it was declared to occupy, leaving a visible gap where a road runs to a wall, a shoreline or the map's own edge. The drawn band MUST therefore span its terminal cells, extending along the **direction of travel** so a diagonal run leaves through the corner. This is the same rule §10 states for lints — *a path is its band, and a band is ground* — applied to the ink: a road ending at `M13` covers `M13`. A renderer that stops at the centre is **non-conforming**, and the failure is not cosmetic: it makes authors bend documents around it, as Fairwater Manor's King's Road once ran a cell **inside** the gatehouse so the two would meet, putting a road's band in a building's interior. The declared spine is unaffected — this governs where the ink stops, not what the path covers, and a path's cells, crossings and lints keep reading the centres.
- **Derived region**: a crossing placed `on` two path entities occupies the **intersection of their bands**. Battlemap bands are exact (polyline through cell centers, width in cells, no organic finishing), so the crossing's cells — tactical extent, difficult-terrain footprint, render region — are a pure function of the two paths and can never disagree with them.
- **Rendering**: crossings render above the paths they join, regardless of declaration order. A ford is a restyled segment of the water's own band (shallow tone plus its `difficult` hatch); the road runs to the band's edge on both sides. A bridge restyles the road's band across the water, with edging.
- **Ambiguity fails loud**: if the bands intersect in more than one place, the derived placement is an error naming the crossing cells; `at <cell>` chooses among them (it never redefines extent).
- **Explicit cells remain legal** for crossings with nothing to derive from (a ford over area-shaped water); when two `on` references resolve to paths, the derived region is authoritative.
- **Implied-crossing warning**: a water-path × road band overlap not claimed by any crossing produces a renderer warning naming both entities and the cell — the render would otherwise imply a bridge nobody declared.
- **Implied-crossing warning**: a water-path × road overlap not covered by any crossing's cells produces a renderer warning naming both entities and the cell — the render would otherwise imply a bridge nobody declared.
- **Layering**: within `[terrain]`, area terrain renders beneath path bands, and paths beneath crossings; declaration order breaks ties within a kind. Consequently, a terrain cell grazed by a river's band reads as its bank (mud shows through at the water's edge).
- **Which of spec 02 §7's forms a grid answers** *([#239](https://github.com/Nossimonov/Chartdown/issues/239), [#238](https://github.com/Nossimonov/Chartdown/issues/238))*. §7 is normative for every map kind, and a battlemap **resolves** these:

  | form | on a grid |
  |---|---|
  | `<cell>` / `at <cell>` | the same placement — §7 makes `at` optional on grids, so the two spellings cannot differ |
  | `on <ref> at <local>` | the referent's own frame (§7, [#34](https://github.com/Nossimonov/Chartdown/issues/34)) |
  | `on <ref> on <ref>` | a crossing, at the intersection of the two bands (§6) |
  | `<compass> of <ref>` | a relational extent, below |
  | `from <ref> to <ref>` · `from <ref> join <ref>` | a **course** in cell space, centre to centre. A reference to a line resolves to its midpoint (spec 03's aspect adaptation), and `join` meets the trunk at the nearest cell to where the course arrives |

  Every other form of §7 — `near`, `<measure> <compass> of`, `<compass> edge of`, a bare `on <ref>`, a lone `along` — **is reported, never dropped**. Each states a relation without stating a square, and §7 already rules on that case: a placement satisfiable in more than one place is "ambiguous — a fail-loud error — and an `at <cell|point>` *chooses* among the candidates". The refusal names the form and the cell-bearing spelling to use instead.

  This is written down because it was not, and six forms rendered **byte-identically to a document with the line deleted** — no ink, no diagnostic — which is the failure §6 already ruled on for `area` on a feature (#207). It was found twice, one form at a time, before it was recognised as a class. `along <ref>` accompanying a course is a shape **hint** rather than a placement, and is reported as unapplied rather than refused: the course runs straight between its anchors.

- **An extent may be stated relationally** *([#231](https://github.com/Nossimonov/Chartdown/issues/231), [ADR 0038](../decisions/0038-a-placement-form-means-the-same-thing-on-every-map-kind.md))*. `forest dark-wood "Dark Wood" : north of babbling-brook` places terrain on the far side of another entity's course, and means on a grid what the same form has always meant on a region map (spec 05 §2). **A placement form means the same thing on every map kind**, which is why this is stated here rather than restricted: a language with a closed grammar cannot also have productions that change meaning with the header.

  This *reverses* a rule earlier editions of this section stated — "extent is always declared, never derived", rejecting a "fill to the river" mechanic — on the grounds that the split it created between map kinds was the larger defect. The objection it was protecting against is real and is answered by making the dependency **legible** rather than forbidding it: `north of babbling-brook` says in the line what four hand-tiled ranges cannot, which is that this wood ends at that water.

  **Ink and coverage are separate questions**, as they already are for a path band (`#145`, below):

  - The **ink** stops at the reference's **centerline**. The fill renders beneath the band, so a fill stopping at the near cell boundary would leave a hairline of paper down the reference's whole length — a `width=1` band covers 85% of its cell, so 7.5% of the cell would show on each side.
  - A cell is **covered** when its **centre** lies strictly beyond the course, which is this section's existing centre-reading rule and not a new convention.
  - **Ties go to the reference.** A cell whose centre lies *on* the course belongs to the watercourse, not to the wood.

  A relational extent is a pure function of the referenced entity's declared course, so it is deterministic (spec 02 §8.2). It is **not** exempt from §10's coherence lints: where such an extent crosses a structure's wall, `terrain-crosses-wall` reports it exactly as a declared one, and that report is what makes a derived extent auditable when the reference is later edited.

  **This does not reach §5's level surfaces.** `earth`, `air`, `roof` and `terrace` state where a level's ground *is*, and their extent stays **declared, never derived** — a floor that resolved from a watercourse would make what a party can stand on depend on an edit elsewhere, and it is the blanket `earth : area A1..T20` that §10's whole-footprint exemption is built around. §3's `open` flag is likewise unaffected. The rule reversed here is this section's own, about terrain extent, and nothing wider.

## 7. Label conduct

At battlemap scale, table legibility outranks self-description: **fallback word-labels render as hover tooltips**, not visible text (spec 04 §4's chain-terminal label is satisfied by the tooltip). Visible text labels are reserved for display names, token identifiers, and zones; `nolabel` opts any of those out. Region-scale conduct is unchanged — an anonymous generic marker there carries its word as text (spec 04 §4).

**Z-order**: room and zone labels are floor-plan text and render **beneath features and tokens** — a guard in a doorway occludes "The Gatehouse," never the reverse. Labels attached to the pieces themselves (token identifiers, feature names, connector annotations) render above. Because floor-plan text can never win that z-fight, renderers SHOULD place room labels **clear of the pieces**: within the room, prefer the position nearest center whose span is unobstructed by features and tokens, degrading to the least-covered position when the whole room is cluttered. A label relocating because a piece moved is the lesser sin; a static piece permanently hiding a room's name is the greater.

**Line-feature labels** (all scales): a path's label anchors at the **arc-length midpoint of the rendered course** (after any clipping, e.g. a river stopped at the coast) — never at an endpoint, which reads as labeling the terminus. When mid-course is crowded, the label slides **along** the course to the nearest clear point rather than nudging off it — a label pushed off a road reads as labeling the neighbor.

**Feature footprints**: a feature MAY take a **range placement** as its footprint — `table hightable : G3..I3` — dimensions declared as placement, like every other extent in the language (no size metadata; asymmetric X/Y comes free). Single-cell features remain points; range-only *zones*, gm entities, and elevated areas keep their zone rendering.

## 8. Levels

*(Added from proposal [#31](https://github.com/Nossimonov/Chartdown/issues/31).)* Multi-level structures are **discrete floors**, not continuous height (`elevation=` remains terraces *within* a level):

- **`levels:`** declares the floors in **physical order, topmost first**: `levels: upper ground cellar`. The optional **`level:`** header names the default level for unqualified content (else the first listed). Documents without `levels:` are single-level; nothing changes.
- **Section qualifiers place whole blocks**: `[structures upper]`, `[tokens cellar]`; the generic parameter `level=<word>` overrides per entity. Undeclared level words fail loud, as does a qualifier in a document with no `levels:`.
- **Connectors**: *any feature carrying `to=<level>`* connects levels — `stairs` and `ramp` are ordinary stdlib words, and `ladder : stairs` (or any word at all) works identically. Landings default to the same cell; `at=<cell>` places a differing landing. The destination panel shows the reciprocal landing automatically unless an explicit connector is declared at that cell. Connectors expose the **reserved auto-states `up` and `down`** (derived from level order) to themes — `ladder.up : glyph=…` — through the ordinary spec 08 machinery. A `to=` naming an undeclared level fails loud.
- **Shafts span more than two levels** *(from proposal [#112](https://github.com/Nossimonov/Chartdown/issues/112))*. A connector between two adjacent panels cannot describe the vertical things a deep dungeon is made of, so two spellings extend it:
  - **`to=<level>..<level>`** declares landings on **every** level in the range, from one line. A stair from the Seventh Level to the Gates is one stair; writing it as four connectors gave it four ids, four chances to typo a column, and nothing anywhere saying they were the same flight. The annotation on each panel names the **next landing in the direction of travel**, not the far end — standing mid-flight, the step about to be taken is what matters.
  - **`through=<level>..<level>`** declares the levels a connector **occupies without opening onto**. Those panels draw the shaft's footprint as an obstruction — a walled well, not floor, and no landing. This is ground truth that was otherwise absent: a stair boring through six levels left those cells indistinguishable from solid rock, so a party standing there stood inside a stairwell the map called stone. `through=` requires a `to=`, since a shaft that opens nowhere is not a connector.
  - **`to=` on an unfloored (`air`) area** names the level a fall terminates on, replacing §5's "the level below" with a stated fact. Absent `to=`, the default is unchanged and no existing document moves.
- **Rendering**: one panel per level in `levels:` order (topmost first — the module floor-plan sheet), each titled with its level word, sharing the document's grid. Light, visibility, crossings, and the GM/player split compute per level. Connector annotations (direction and destination) are navigational and render even under `labels: none`. Renderer/CLI options select a single level.

## 9. UVTT export

*(Normative since issue [#40](https://github.com/Nossimonov/Chartdown/issues/40); previously a non-normative note.)* A battlemap exports to Universal VTT (`.dd2vtt`/`.uvtt`/`.df2vtt`) as a **pure transform of the parsed document** — export is a transform, not an interpretation, which is why the structures triad is modeled first-class. One file per level; coordinates in grid units:

- **`environment.ambient_light`** — the declared `light:` ambient for the exported level (§2), so a dark map arrives dark. Absent a declaration, or for a value the exporter does not recognize, the scene stays fully lit rather than guessing a tone. Only `light` maps: UVTT has one ambient field, and a setting's own fields have no counterpart there.
- **`line_of_sight`** — structure perimeter walls (per cell edge, minus `ruined` sides, coincident edges deduplicated per §3) minus **every opening edge**, plus freestanding non-fence barriers. Portals own their edges' occlusion.
- **`portals`** — every door/gate/window/arrow-slit edge: `closed` from the `passes` facet (doors default closed; windows never pass). **Window-ness is the combination**: a hole in `line_of_sight` (sight and light pass) plus a shut portal (movement doesn't) — UVTT has no sight facet, but the pair models it.
- **`lights`** — every entity carrying `light=`, positioned at its placement's center, range converted to grid units via `scale:`.
- **`resolution`** — grid dimensions as `map_size`; `pixels_per_grid` records the raster density of the accompanying image.
- **The render mode applies before export**: a player-mode export carries no GM secrets. **Not exported**: tokens (play-state is the VTT's, vision non-goal), fences (`sight=all`; UVTT has no movement-only blocker), and elevation/`open`, which flatten into the image.
- **`image`** — a raster of the level's playable grid region. The reference exporter emits geometry plus the matching SVG and its grid-aligned pixel region; the **caller supplies the raster** (the renderer stays runtime-dependency-free — ADR 0010).

Richer multi-level and roof-aware targets (e.g. Foundry scene levels) remain ecosystem-phase work.

## 10. Coherence lints

*(From proposal [#123](https://github.com/Nossimonov/Chartdown/issues/123), per the [#80](https://github.com/Nossimonov/Chartdown/issues/80) decision.)* Everything above governs what a document may **say**. These six checks govern what a document **means** — geometry that is legal under every rule and that no reader would intend. They exist because a prototype found 32 such defects in a map that passed validation and rendered without a single warning; the failure mode is not a rejected document but a plausible one, drawn confidently and wrong.

**Every one is a warning and never an error**, and the asymmetry is deliberate: these reason about intent, so a false positive must cost an author a line of output and never a blocked render. There is no suppression syntax, also deliberately, until real false positives argue for one.

| Lint | Warns when | A legitimate reading it must not report |
|---|---|---|
| `door-onto-void` | An opening in a structure leads out onto a cell that cannot be walked on | A window or arrow-slit (facing open air is its job); an **unparented** opening, where the rock is the barrier and the opening perforates it (§3); a door onto a **road, bridge, or ford** — a building fronting onto a street |
| `structure-unsupported` | A footprint cell sits over declared `air` with no structure beneath it on the level below | A room built squarely on the room below — the lower room is its floor, which is why no ceiling was declared under it |
| `unreachable-room` | A footprint has neither an opening on its perimeter nor a connector inside it | A room whose only way in is a stair **declared on another level**; §8's reciprocal landing is what puts it here |
| `dangling-connector` | A connector's landing cell cannot be stood on at the far end | A landing inside a room carved out of that surface — a cellar is `earth` with rooms cut into it |
| `overlapping-structures` | Two footprints on one level share cells | **Containment**: one footprint wholly inside another is a room within a room, and its walls are real interior walls |
| `terrain-crosses-wall` | Terrain lies partly **inside and partly outside** one footprint, crossing its perimeter | Terrain **wholly inside** a room — a pool in a hall, a dais on a chamber floor, a rubble heap in a corner, which touch no wall at all; terrain covering the **whole** footprint (a flooded room, and the blanket ground layer §5 lays across a level); and a band crossing the perimeter only at edges carrying an **opening** — a road meeting a gatehouse goes through the gate |

Three rules run beneath the table and decide most of the readings in its right-hand column:

- **A room is a floor.** §5's idiom for a level is to lay one word across the whole grid and carve into it — `air` for a storey, `earth` for a cellar — so a structure's footprint overrides the blanket beneath it wherever the two disagree. This is the same carving §3 relies on for openings in unbuilt geometry.
- **A level is not the document.** Connectors, landings, and the floor a room stands on all live one level away from the thing they are asked about, so these checks read the whole document and not the level being drawn.
- **A path is its band, and a band is ground.** A path's placement names only its corners (`road : path A8 T8 width=3` names two cells and covers fifty-seven), and §6 layers area terrain *beneath* path bands — so a road is what its cells have on them, including where it is driven through rock. Counting a path's corners instead of its band, or reading only `terrain` as surface, made a street both invisible to the room it fronts and unwalkable to the door opening onto it.

Because `check` renders (issue [#120](https://github.com/Nossimonov/Chartdown/issues/120)), these run wherever validation runs — a lint nobody runs is a lint nobody has.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
