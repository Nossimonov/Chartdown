# @chartdown/render-svg

Deterministic, seeded SVG renderer for [Chartdown](https://github.com/Nossimonov/Chartdown) — plain-text TTRPG maps. Same input, same seed, byte-identical SVG. Zero runtime dependencies beyond `@chartdown/core`.

```js
import { renderSource } from "@chartdown/render-svg";

const { svg, diagnostics } = renderSource(source, { mode: "gm" });
// options: mode ("player" | "gm"), theme (Chartdown theme source), level
```

Player mode strips GM secrets fail-closed. Themes are themselves Chartdown documents. Try the [playground](https://nossimonov.github.io/Chartdown/) or see the [spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec).
