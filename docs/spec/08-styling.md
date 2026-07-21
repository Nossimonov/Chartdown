# 08 — Styling: The Theme File Format

**Status: Draft** (accepted from proposal [#27](https://github.com/Nossimonov/Chartdown/issues/27) as amended: appearance zones and variant pools). Gives the theme *contract* of spec 04 §4 its concrete file format. This is the final content section of spec draft v0.1.

## 1. Theme documents

A **theme document** is an ordinary Chartdown document containing only `[theme]` and `[glyphs]` sections; like vocabulary documents, it requires no `map:` header. One lexical layer serves maps, vocabularies, and themes alike.

```chartdown
# Candyworld
use: default                     ; inheritance = import + shadowing

[theme]
paper : fill=#fdf1f5
forest : fill=#a8d894 glyph=lollipop
gumdrop-hills.edge : fill=#f2d4e0
river.edge : stroke=#c9628f
wagon.overturned : opacity=0.75 dash=4,3
side.party : fill=#4a7ab5

[glyphs]
lollipop : "M0,-3 a5,5 0 1,1 0.1,0 M0,2 L0,10"
```

## 2. `[theme]` lines

`<subject> : <appearance pairs>`. Subjects, in one namespace:

- **Vocabulary words** (`forest`, `hovercart`) — looked up through derivation chains (spec 04 §4): a theme that styles `forest` styles everything deriving from it until a more specific entry shadows.
- **State variants** — `word.state` (`wagon.overturned`), for states the vocabulary declares.
- **Appearance zones** — `word.core` and `word.edge`, **reserved suffixes** a vocabulary MUST NOT declare as states. Zones are renderer-geometric roles: on path bands, `edge` is the two side margins and `core` the center strip; on areas, blobs, and ridges, `edge` is the boundary band and `core` the interior (foothills are `mountains.edge`; a treeline is `forest.edge`). The bare word is shorthand for core.
- **The `side.` namespace** — `side.<word>` colors token allegiances (`side.party`, `side.hive-swarm`).
- **Surface words** — a closed set the renderer owns: `paper`, `grid`, `fog`, `ink`, `light`, `ledge`.

## 3. The appearance vocabulary (closed)

`fill=` · `stroke=` · `width=` · `dash=` · `opacity=` · `glyph=` · `asset=` · `edge=` (edge-zone thickness). Nothing else — every property is presentation-only by construction, which is how the contract's no-semantics rule is enforced. Unknown properties warn and are ignored.

## 4. Glyphs and assets

- **`[glyphs]`** names SVG path data (a quoted string) drawn in a **24×24 unit box centered on the origin**; renderers scale to context. Self-contained and deterministic — no external references.
- **`asset=`** takes a relative path or URI to user art. Supporting renderers draw it; all others fall through `glyph=` → `fill=` → the archetype generic (spec 04 §4) — an asset can only ever upgrade a render.
- **Variant pools**: `glyph=` and `asset=` accept comma-separated lists. Selection is a **deterministic hash of position** (cell or coordinate) — repetition breaks visibly, yet every choice is stable under unrelated edits, honoring determinism (spec 02 §8.2) and never-reflow (spec 02 §8) alike.

## 5. Inheritance and selection

- **Inheritance is `use:` + shadowing**, exactly as vocabulary: later entries shadow earlier ones; `use: default` imports the built-in default theme. No other mechanism exists.
- **Selection**: a map's `theme:` header remains a *suggestion* (spec 04 §4); the renderer and its user always win. Reference implementation surfaces: `RenderOptions.theme` (theme source), CLI `--theme <file>`, browser `data-theme="<url>"`.
- **The default theme is itself a theme document** — the reference renderer generates and parses `DEFAULT_THEME_SOURCE` through the same machinery user themes use. There is no privileged styling path.

## 6. Conformance

Themes MUST NOT alter geometry, placement, or archetype semantics (spec 04 §4) — the property set makes violations inexpressible. Zone rendering quality is tiered by intent: the primitive renderer draws zones as cartographic edging (edge strokes under core strips; inset boundary bands); texture blending across zones is supporting-renderer territory that the format enables but does not mandate. Label prominence continues to flow from vocabulary tiers (spec 07 §1); typography is deliberately absent from v0.1's property set.

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
