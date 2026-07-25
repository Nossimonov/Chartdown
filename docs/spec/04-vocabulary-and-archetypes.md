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
| `field` | emanates from sources over an ambient baseline (§5); facet `occluded=` |

Future spec sections MAY extend this table; documents MUST NOT. Generic parameters (`hidden`, `gm=`, `link=`, `detail=`, `facing=`, `size=`, `width=`, …) remain archetype-independent.

### `passes=` — a closed value set

`passes=` feeds a **normative** transform (the UVTT export of spec 06 §9), so unlike `side=` it cannot be open vocabulary: an unknown value there has no safe degradation, and two conforming renderers would export different portal states from the same document.

| Value | Meaning | UVTT |
|---|---|---|
| `open` | no leaf; movement and sight pass unless `sight=` says otherwise | los hole, no portal |
| `closed` | a leaf that is shut but operable (doors, gates) | los hole + `closed: true` portal |
| `none` | never passes bodies (windows, arrow-slits, grates) | los per `sight=`, shut portal |

**`sight=`** is closed the same way and for the same reason — `all` (sight passes) or `none` (it does not) — since it decides whether an edge is a hole in `line_of_sight`. A value outside either set **warns** and the vocabulary default applies, consistent with §2's treatment of an undeclared state.

**`open` is the default** when `passes=` is unset, which makes `arch : opening sight=all` — the commonest opening in any dungeon — mean what every reader already takes it to mean. The value resolves through the vocabulary chain like any facet (§2): the entity's own pair, then the word's facet, then its base word's.

An out-of-set value is **skipped at the layer that declares it**, and resolution continues to the next: for `mydoor : door passes=bogus`, the value that applies is `door`'s `closed`, not the archetype's `open`. "The vocabulary default" means the next value up the chain, not the built-in — falling all the way through would silently reopen every derived door, which is the failure mode the closed set exists to prevent.

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
- **States SHOULD be declared.** A bare word in a predicate that is not a reserved flag (spec 01 §5, spec 06) SHOULD match a state declared on the entity's vocabulary word or an ancestor. An unmatched bare word still renders — the fallback chain applies, and spec 04 §3's promise is that nothing is blocked on defining — but it produces a **warning** naming the line and the word, closing the one place a misspelling cost a rendered state and said nothing. Only *defined* vocabulary is checked (an unknown word has no declaration to compare against), and predicates the spec gives their own grammar are exempt: wall-state details (`ruined : north east`, spec 06 §3), where the state is the *subject* and side words the predicate, and `border` lines, whose states are open vocabulary by [ADR 0012](../decisions/0012-borders-are-relationships.md).
- **Derivation carries word-keyed behaviour.** Where a spec section attaches behaviour to a *specific standard-library word* — the level surfaces of spec 06 §5, the staging zone of spec 06 §4, the free text of spec 07 §2, the light of spec 06 §2 — that behaviour **is inherited through derivation, exactly as archetype and facets are**. A word deriving from `air` is unfloored; a word deriving from `note` is free text. Renderers that match these behaviours on the literal word are **non-conforming** ([ADR 0016](../decisions/0016-derivation-carries-word-keyed-behaviour.md)).

### Words that carry machinery

Most of the standard library is ordinary vocabulary: a word, an archetype, some facets. A few words are **load-bearing** — a spec section attaches behaviour to them by name. They are listed here because the only alternative is reading all eight sections to find out, and an author who cannot tell which words are special will avoid derivation near the ones that matter.

| Word | Behaviour | Defined in | Inherited? |
|---|---|---|---|
| `earth` | solid ground; **impassable** — an opening may perforate it | 06 §3, §5 | yes |
| `air` | declared absence of floor (a fall to the level below) | 06 §5 | yes |
| `void` | the same, spelled for underground — a shaft, not a sky | 06 §5 | yes |
| `roof` | a lower room's ceiling seen from above | 06 §5 | yes |
| `terrace` | walkable raised ground | 06 §5 | yes |
| `start` | staging zone (where the party begins) | 06 §4 | yes |
| `note` | free text — renders as its text, no marker | 07 §2 | yes |
| `light` | the shipped **field**: `light=<measure>` emitters over a `light:` ambient | §5, 06 §2 | yes |

Every row inherits, per the rule above — a table of exceptions would be a maintenance hazard, and a uniform answer is one an author can predict. **A spec section that attaches behaviour to a word is committing to that behaviour being inheritable, and MUST register the word here** or use a facet instead.

Vocabulary comes from three sources; later **shadows** earlier, silently and deliberately:

1. **The standard library** — the shipped medieval-fantasy vocabulary (`forest`, `river`, `wagon`, `door`, `keep`, …), implicitly present. It is written in this same mechanism and holds no privileged status; its content is enumerated by the primitives sections.
2. **Used libraries** — the header key `use: <path-or-name>` imports vocabulary documents (`use: vocab/candyworld.cd`); multiple `use:` lines apply in order. This is the shareable/publishable surface. A *vocabulary document* is an ordinary Chartdown document containing only `[vocab]` sections. It carries `kind: vocabulary` as its first header line instead of `map:` (spec 01 §2) — the positive discriminator that makes it identifiable, and therefore checkable, from the file alone.
3. **In-document `[vocab]`** — one-off definitions for one map.

## 3. Unknown words and usage inference

A type word with no vocabulary entry anywhere is **legal**. Its archetype is inferred from usage, checking in order:

1. **Shape or path phrase in the predicate**: `area` or `blob` → `terrain`; `path`, `ridge`, or a `from…to` phrase → `path`. Bare ranges and lone points carry no shape hint.
2. **Section context**: `[tokens]` → `token`; `[structures]` → `structure`; `[terrain]` → `terrain`; and correspondingly for other primitives-defined sections. Section context outranks placement shape-lessness: a solo unknown creature at a single cell in `[tokens]` is a `token`, and an unknown word with an area placement in `[tokens]` is a staging zone (spec 06 §4), never terrain.
3. **A lone point or cell** (in sections carrying no archetype, e.g. `[gm]`) → `feature`.
4. **Otherwise** → `feature`.

The word itself is **never inspected** — there is no suffix or morphology matching. `zorbleflax : (8,7)` renders as a generic labeled glyph; renaming it changes nothing but the label. Renderers MUST NOT warn on unknown words by default; an opt-in strict mode MAY.

This produces the **escalation ladder**, every rung optional: a bare unknown word just works → a `[vocab]` line adds archetype/state precision → a `use:` library shares it → a theme gives it art. Nothing is ever blocked on defining, and no definition is wasted.

## 4. Themes and the fallback chain

- A theme maps vocabulary words and their states to appearance: glyph, color, line/fill treatment, and user art assets. **Asset references live in themes only, never in map source** (vision principle 4).
- Rendering any entity walks the **fallback chain** until something answers: theme asset → theme glyph → base word's chain (for derived words) → standard-library glyph → archetype's generic shape + the word as label. A map can therefore never fail to render for want of appearance, assets, or theme coverage. At the chain terminal, renderers SHOULD **tint the generic shape deterministically by the word's base** (a theme `fill=` overrides), so distinct unknown types stay distinguishable — on the map and matched in the legend — however many a scene holds.
- Themes MUST NOT alter geometry, placement, or archetype semantics. A `window` passes sight in every theme, on every planet, in every year.
- The optional header key `theme:` *suggests* a theme; the renderer and its user always win. Theme file format is deferred to the styling section (08).
- `side=` on tokens takes any word (`side=party`, `side=hive-swarm`); themes map sides to colors. Allegiance is vocabulary, not grammar.

## 5. Fields

Some things **emanate from sources over an ambient baseline**: light is the shipped example, but a setting may want radiation, silence, antimagic, blight, or heat, and they all behave the same way. The `field` archetype is that shape, and a setting declares its own in one line:

```chartdown
[vocab]
radiation : field occluded=none states=none,light,heavy,lethal
silence   : field                      ; occluded like light, by default
```

A **field word** earns four affordances, each reusing machinery that already exists:

| Affordance | Spelling | Mechanism |
|---|---|---|
| **Emitter** | `reactor r1 : F4 radiation=40ft` | an ordinary `key=value` parameter whose key is the field word |
| **Ambient baseline** | `radiation: heavy` (header), `radiation deep-one: lethal` (per level) | a header key naming a declared field |
| **Regional override** | `radiation "Hot Cells" : A1..B5 lethal` | a range placement carrying a state |
| **Appearance** | `radiation : fill=…` · `radiation.heavy : …` | spec 08 §2's `word` / `word.state` |

- **Values are states** (§2): any value renders, a value declared with `states=` is documented and silent, and a typo warns. `light` ships `dark`, `dim`, `daylight`, `moonlight` as declared values; anything else (`witchlight`) still works.
- **`occluded=`** says whether matter stops the field: `sight` (the default — blocked by whatever blocks sight, which is what light does) or `none` (fills regardless of interceding material). Without it every declared field would silently inherit light's occlusion, which is wrong for an antimagic zone or a radiation hazard.
- **Ambient is content, not presentation.** Whether a place is dark is a fact about the place that survives changing themes, exactly as an entity's `light=` is — and spec 08 §6 forbids themes from altering semantics for this reason. The default is unchanged when no ambient is declared, so no existing document moves.
- **A renderer owes an unknown field only geometry and a lookup**: ambient as page treatment, emitters as pools of their range, regions as their extent, each taking its fill from the theme's `<field>` / `<field>.<state>` entry. A renderer that has never heard of `radiation` still draws it, degrading through §4's fallback chain. Extra cleverness for the field a renderer *does* understand — tracing light against sight blockers — is a renderer's privilege, not a semantic difference.

> The emitter-parameter namespace is therefore **derived from the vocabulary**: declaring `radiation : field` is what makes `radiation=40ft` meaningful, and a document that does not declare it leaves the pair an ordinary unrecognized parameter.

## 6. Grammar sketch additions

```ebnf
vocab-line = word , ":" , ( archetype | word ) , { pair | word } , EOL ;
archetype  = "terrain" | "path" | "feature" | "structure" | "barrier"
           | "opening" | "token" | "zone" | "field" ;
use-line   = "use" , ":" , ( path | word ) , EOL ;      (* header; repeatable *)
theme-line = "theme" , ":" , word , EOL ;               (* header; a suggestion *)
```

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
