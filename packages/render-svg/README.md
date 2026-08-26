# @chartdown/render-svg

Deterministic, seeded SVG renderer for [Chartdown](https://github.com/Nossimonov/Chartdown) — plain-text TTRPG maps. Same input, same seed, byte-identical SVG. Zero runtime dependencies beyond `@chartdown/core`.

```js
import { renderSource } from "@chartdown/render-svg";

const { svg, diagnostics } = renderSource(source, { mode: "gm" });
// options: mode ("player" | "gm"), theme (Chartdown theme source), level
```

Player mode strips GM secrets fail-closed. Themes are themselves Chartdown documents. Try the [playground](https://nossimonov.github.io/Chartdown/) or see the [spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec).

## The resolved scene

`render` resolves a whole scene per call — positions, outlines, half-planes, organic finishing — and discards it. `resolveScene` returns it instead, for a host that draws with its own primitives rather than consuming the SVG ([ADR 0051](https://github.com/Nossimonov/Chartdown/blob/main/docs/decisions/0051-the-renderers-answer-is-data-before-it-is-ink.md)).

```js
import { resolveScene } from "@chartdown/render-svg";

const scene = resolveScene(doc, { mode: "gm" });
// { schemaVersion, mapType, mode, unit, extent, levels?, features, walls?, diagnostics }
```

`scene.schema.json` sits beside this README and is the normative shape; [`examples/gumdrop-vale/gumdrop-vale.scene.json`](https://github.com/Nossimonov/Chartdown/blob/main/examples/gumdrop-vale/gumdrop-vale.scene.json) is a worked one. **The schema versions with this package, not with `SPEC_VERSION`** — a renderer output is not language.

**Geometry is in the map's own units.** A region's `extent:` units, cells on a battlemap, hexes on a hexcrawl — never canvas pixels, because a canvas number moves with `detail:` and [ADR 0037](https://github.com/Nossimonov/Chartdown/blob/main/docs/decisions/0037-geometry-is-in-map-units-ink-is-in-canvas-units.md) forbids a rendering choice from moving geometry. A grid map's geometry is a **cell union** rather than an outline: a structure occupies cells, and spec 06 §3 derives the outline from them, so the derived `perimeter` rides along.

**Geometry is what is drawn**, after organic finishing — the outline the coast *has*, not the one the document declared. Your coast therefore agrees with this renderer's coast on the same document, which is the point.

**There is no ink in it.** No stroke widths, no font sizes, no legibility floor, no zone insets, no glyph scatter. Each feature carries its derivation `chain`, so you apply your own theme through the same fallback this renderer uses; a theme *document* is already the interchange format for the rest.

Two exclusions worth knowing before you build on it:

- **Placed labels are not in v1.** A feature carries where its label *wants* to go, not where arbitration put it, so two implementations will put the same things in the same places and label them differently. Arbitration is interleaved with emission and the placer is stateful; hoisting it is its own change.
- **`detail:` is an input to determinism on a region.** A scene is a pure function of (document, seed, renderer version, mode, `detail:`). Organic finishing runs in canvas space, so a larger canvas grows texture and the dependence propagates through relational placement — `examples/vessany`'s coast has 400 vertices at `overview` and 665 at `reference`. Resolve at the `detail:` you intend to draw, and do not mix scenes from two. Grid maps have no such knob and are unaffected.
