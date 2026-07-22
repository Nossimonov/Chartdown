# 0013 — Terrain comes in kinds; references adapt by aspect, never by guess

- **Status:** Accepted
- **Date:** 2026-07-23
- **Issue:** [#82](https://github.com/Nossimonov/Chartdown/issues/82)

## Context

Owner review of the Sundered Reach (#73) surfaced a smell: in reality every part of a map has terrain, but Chartdown terrain exists only where painted. The representative case was the White Reach — a tundra declared as a mid-continent `blob`, whose geometry asserts "non-tundra surrounds this" and leaves "what's north of it?" unanswerable. A connected tension: `ridge width=` draws a belt around a line, wrong when an author needs specific mountainous terrain; and refining a ridge into an area silently broke everything referencing it as a line (`along` realm edges from ADR 0012). A first-draft adaptation rule (line aspect of an area = its boundary) was rejected by the owner because it changed *political* meaning with representation class: a line range was claimed up to the crest by default, an area range not at all — "bad luck, Switzerland."

The owner's framing that settled it: enumerate what a map must actually represent to capture mountains. Five facts with distinct geometries — extent (area), crest (line), passes (own entities), peaks (points), claims (relationships to the above, not properties of it).

## Decision

1. **Terrain comes in three kinds, each with its idiom.** Patches (forests, marshes): `blob`/`area` on the parchment — the paint-on-parchment model stays. Belts (ranges): `ridge <points> width=<measure>`. **Zones** (tundra, desert, icecap): defined by a frontier using the existing half-plane form — `tundra "The White Reach" : north of "The Frostline"` — with honest terrain fill painted beneath water. Zonal-ness is a property of the placement form, not the word.

2. **The ground can be named.** Region header `ground: <terrain-word>` states what unmarked land is; unstated, it remains unspecified open land.

3. **Mountain crest and extent coexist; refinement is additive.** `ridge (…)` declares the crest and sketches the extent; `area (…)` on the same entity refines the extent while the crest survives. `along <ref>` always means the declared crest, so references never break under refinement. Area-only mountains (plateaus) have no crest; renderers give `mountains : area` the massif visual language, not the generic patch look.

4. **Aspect adaptation, stated (spec 03).** A reference names the thing; forms adapt: point ← point/midpoint/centroid; line ← polyline, else area boundary (rivers stop at shores — codifying existing behavior); area ← polygon, else a ridge's belt. Adaptation **never guesses between multiple meaningful resolutions**: a line-needing reference to a crestless area is a fail-loud ambiguity, resolved by the face qualifier `along <compass> edge of <ref>` (grammar: `"along" , [ compass , "edge" , "of" ] , ref`). All political outcomes are authorable, none a representational default: divide border (`along <ref>`), no-man's march (each realm to its near face), whole-range claim (boundary along the far face — the neighbor bounding the same face yields one seam).

## Alternatives considered

- **Do nothing:** the White Reach paradox stands; ridge→area refinement silently collapses dependent boundaries to straight edges.
- **Require total terrain coverage:** GIS authoring burden; betrays readable-source and write-what-a-GM-writes principles.
- **Silent line-aspect = area boundary** (first draft): rejected by owner — political meaning changed with geometry class.
- **Fail-loud on all `along <area>`** without a face qualifier: punishes the refinement workflow with no escape.
- **Derived medial-axis crests:** unstable under vertex edits; violates additive stability.

## Consequences

- Refinement is safe by construction: geometry class may change, references keep meaning the thing; where meaning would genuinely fork, the author is asked, loudly, with the fix named in the error.
- Political and climatic frontiers share machinery: a realm edge can run `along` a frostline; a border state can select it.
- The face qualifier adds one bracketed option to one grammar production; no new namespace (rejected vertex-ids stay rejected).
- Zonal fills paint beneath water, so a frontier crossing a coast needs no clipping geometry — the sea simply wins.
- A blob tundra remains legal (a genuine cold hollow is a patch); the White Reach migrates because its *fiction* was zonal.
