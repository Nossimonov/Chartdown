# 03 — Identity, References, and Links

**Status: Draft** (accepted from proposal [#15](https://github.com/Nossimonov/Chartdown/issues/15) as amended: no singleton-type identity; quoted display-name references retained). Defines what an entity's identity is, how references resolve, how anchors are exported for prose→map links, and the reserved parameters for map→prose and map→map links.

## 1. Identity

An entity has up to two identity keys, both optional:

- **Explicit id** — the id word(s) in subject position (spec 01 §4): `goblins g1 g2 : …`, `building tollhouse "Ruined Toll House" : …`. Explicit ids MUST be unique within the document; a collision is a parse-time error.
- **Display name** — the quoted string in subject position: `town "Merrow's Rest" : …`. Display names MAY repeat within a document; they are presentation first, identity second.

An entity with neither is **anonymous**: renderable content that nothing can reference. There is no type-word or position-derived identity — a second `ford` is a non-event because nothing could have anchored to the first.

Identity lives in the line, never in the position: repositioning an entity never changes what links to it.

## 2. References

A reference (`<ref>` in spec 02 §7, `[gm]` attachment subjects, and future constructs) takes one of two forms:

- **bare word** — looks up explicit ids: `east of highkeep`
- **quoted string** — looks up display names by exact match: `east of "The Serpent's Spine"`

Resolution is **fail-loud**: a reference that matches nothing, or a quoted reference that matches more than one entity, is an author-facing error naming the line. Duplicate display names are legal right up until something references them ambiguously — at which point the fix is promoting the intended target to an explicit id.

**Aspect adaptation** (ADR 0013). A reference names the *thing*, not its geometry class, and the referencing form adapts to whatever geometry the thing currently has:

- a form needing a **point** takes the entity's point, else its line's midpoint, else its area's centroid;
- a form needing a **line** (`along`, path endpoints) takes its polyline — for a range, the declared crest, which survives area refinement — else its area's boundary (a river ending at a lake stops at the shore);
- a form needing an **area** takes its polygon, else a ridge's belt footprint.

Adaptation never guesses between *multiple meaningful* resolutions: a line-needing reference to a crestless areal feature (which offers two faces) is a fail-loud ambiguity, resolved by the face qualifier — `along south edge of <ref>` (spec 02 §7). This is what makes representation refinement safe: geometry class may change; references keep meaning the thing.

> *Non-normative — why both forms:* quoted-name references keep simple descriptive maps simple ("The Serpent's Spine" is unique on your map; say so). But names are natural keys, and natural keys exhaust — there are nineteen Edgewoods in the United States, because proximity to woods is just what distinguishes a place. When your map grows its second Edgewood, the error tells you exactly where to add an id. Give an explicit id up front to anything you intend to link to from prose.

## 3. Anchors: prose → map

- The optional header key **`id:`** names the document (`id: redford-crossing`), defaulting to the slug of the title. It namespaces anchors when one Markdown page embeds several maps.
- A renderer MUST export a stable anchor for every identified (non-anonymous) entity. In HTML/SVG output the RECOMMENDED form is an element id `cd-<doc-id>-<entity-id>`, where `<entity-id>` is the explicit id if present, otherwise the display-name slug. Ordinary Markdown links then work: `[the toll house](#cd-redford-crossing-tollhouse)`.
- **Slug algorithm**: lowercase; letters and digits kept; apostrophes removed; every other run of characters becomes a single `-`; leading/trailing `-` trimmed. `"The Serpent's Spine"` → `the-serpents-spine`.
- **Stability contract**: explicit-id anchors are stable across renames. Display-name anchors change when the name changes — the same behavior as Markdown heading anchors, and the same remedy: link-worthy things get explicit ids. If two entities' slugs collide, neither exports an anchor and the renderer MUST warn.
- **Degradation**: in a host that doesn't render Chartdown, a prose link to an anchor is a dead fragment — the prose is otherwise untouched. No Chartdown syntax ever appears outside the fence.

## 4. Links: map → prose, map → map

Two reserved generic parameters (joining `hidden` and `gm=`, spec 01 §6), legal on any entity:

| Parameter | Meaning | Example |
|---|---|---|
| `link=` | Where this entity's description lives — a URL, relative path, or fragment in the embedding document. Supporting renderers make the entity clickable. | `capital highkeep "Highkeep" : (360,330) link="lore/highkeep.md"` |
| `detail=` | This entity is detailed by another Chartdown document — the site-map → battlemap hand-off. | `bigtop "The Big Top" : … detail="maps/bigtop.cd"` |

Paths resolve relative to the document. An entity may carry both. Renderers that don't support them MUST ignore them silently.

## 5. `[gm]` lines are attachments

Within a `[gm]` section:

- A line whose subject **resolves** (either reference form) is an **attachment**: its quoted text and parameters become GM-only notes and properties of the target entity. An attachment MUST NOT contain a placement — repositioning an entity from `[gm]` is an error.
- A line whose subject does not resolve and **has a placement** declares a new GM-only entity (`trigger ambush : K9..L10 "spring when the wagon is mid-ford"`).
- A line whose subject does not resolve and has **no placement** is an **error** — this closes the typo hole where a misspelled attachment target would silently declare a phantom entity.

Attachment subjects obey spec 02 §8's order-bounded rule like any reference.

## 6. Grammar sketch additions

```ebnf
ref        = word | string ;                (* word: explicit-id lookup; string: display-name lookup *)
doc-id     = slug ;                          (* from id: header, else title slug *)
anchor     = "cd-" , doc-id , "-" , entity-id ;
entity-id  = explicit-id | name-slug ;
```

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
