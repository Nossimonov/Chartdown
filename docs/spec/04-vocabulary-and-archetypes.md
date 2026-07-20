# 04 — Vocabulary and Archetypes

**Status: Draft** (accepted from proposal [#16](https://github.com/Nossimonov/Chartdown/issues/16) as amended: usage inference made exact; word-derivation added; morphology inference rejected). Defines what the language knows (archetypes), how words acquire meaning (vocabulary), what happens when they haven't (inference), and the contract themes must honor. **The language knows no nouns**: every type word — including the shipped standard library — is content, not grammar.

## 1. Archetypes

The language defines only **archetypes**: closed, setting-free behavioral categories carrying the semantics renderers and exporters must understand.

| Archetype | Behavior |
|---|---|
| `terrain` | area-filling ground cover; may carry `difficult` |
| `path` | linear feature; optional `width=` |
| `feature` | point-placed glyph; optional `facing=` |
| `structure` | encloses space; has walls, may contain openings |
| `barrier` | blocks; facets `passes=` / `sight=` |
| `opening` | passage through a barrier; same facets (door: `passes=closed sight=none`; window: `passes=none sight=all`) |
| `token` | an actor; `size=`, `side=` |
| `zone` | a named region with soft or drawn bounds |
| `light` | emits light; `range=`, `color=` |

Future spec sections MAY extend this table; documents MUST NOT. Generic parameters (`hidden`, `gm=`, `link=`, `detail=`, `facing=`, `size=`, `width=`, …) remain archetype-independent.

## 2. Vocabulary

A vocabulary entry binds a type word to meaning. Two forms:

```chartdown
[vocab]
gumdrop-hills : terrain                    ; bind to an archetype
licorice-forest : forest                   ; derive from another word
airlock : door sight=none                  ; derive, then override a facet
hovercart : wagon states=overturned,parked ; derivation with declared states
```

- **Archetype binding** — `word : <archetype> [facets] [states=…]`.
- **Derivation** — `word : <vocabulary-word> [overrides]`: inherits the base word's archetype, facets, states, and theme hooks, then applies overrides. Derivation is the sanctioned way to say *"treat it like a forest, but draw lollipops instead of trees"* — semantics inherited in source, motif swapped in theme. Derivation chains resolve in document order (spec 02 §8 order-bounding applies); cycles are errors.

Vocabulary comes from three sources; later **shadows** earlier, silently and deliberately:

1. **The standard library** — the shipped medieval-fantasy vocabulary (`forest`, `river`, `wagon`, `door`, `keep`, …), implicitly present. It is written in this same mechanism and holds no privileged status; its content is enumerated by the primitives sections.
2. **Used libraries** — the header key `use: <path-or-name>` imports vocabulary documents (`use: vocab/candyworld.cd`); multiple `use:` lines apply in order. This is the shareable/publishable surface.
3. **In-document `[vocab]`** — one-off definitions for one map.

## 3. Unknown words and usage inference

A type word with no vocabulary entry anywhere is **legal**. Its archetype is inferred from usage, checking in order:

1. **Shape token in the predicate**: `area`, `blob`, or a range → `terrain`; `path`, `ridge`, or `from…to` → `path`; a lone point or cell → `feature`.
2. **Section context**: `[tokens]` → `token`; `[structures]` → `structure`; `[terrain]` → `terrain`; and correspondingly for other primitives-defined sections.
3. **Otherwise** → `feature`.

The word itself is **never inspected** — there is no suffix or morphology matching. `zorbleflax : (8,7)` renders as a generic labeled glyph; renaming it changes nothing but the label. Renderers MUST NOT warn on unknown words by default; an opt-in strict mode MAY.

This produces the **escalation ladder**, every rung optional: a bare unknown word just works → a `[vocab]` line adds archetype/state precision → a `use:` library shares it → a theme gives it art. Nothing is ever blocked on defining, and no definition is wasted.

## 4. Themes and the fallback chain

- A theme maps vocabulary words and their states to appearance: glyph, color, line/fill treatment, and user art assets. **Asset references live in themes only, never in map source** (vision principle 4).
- Rendering any entity walks the **fallback chain** until something answers: theme asset → theme glyph → base word's chain (for derived words) → standard-library glyph → archetype's generic shape + the word as label. A map can therefore never fail to render for want of appearance, assets, or theme coverage.
- Themes MUST NOT alter geometry, placement, or archetype semantics. A `window` passes sight in every theme, on every planet, in every year.
- The optional header key `theme:` *suggests* a theme; the renderer and its user always win. Theme file format is deferred to the styling section (08).
- `side=` on tokens takes any word (`side=party`, `side=hive-swarm`); themes map sides to colors. Allegiance is vocabulary, not grammar.

## 5. Grammar sketch additions

```ebnf
vocab-line = word , ":" , ( archetype | word ) , { pair | word } , EOL ;
archetype  = "terrain" | "path" | "feature" | "structure" | "barrier"
           | "opening" | "token" | "zone" | "light" ;
use-line   = "use" , ":" , ( path | word ) , EOL ;      (* header; repeatable *)
theme-line = "theme" , ":" , word , EOL ;               (* header; a suggestion *)
```

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
