# @chartdown/core

Parser and AST for [Chartdown](https://github.com/Nossimonov/Chartdown) — a plain-text, Markdown-inspired language for TTRPG maps (battlemaps, hex charts, region maps). Zero runtime dependencies.

```js
import { parse } from "@chartdown/core";

const { document, diagnostics } = parse(source);
```

Pair with [`@chartdown/render-svg`](https://www.npmjs.com/package/@chartdown/render-svg) to render, or try the [playground](https://nossimonov.github.io/Chartdown/). The language is specified in [docs/spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec) (CC-BY-4.0); an agent-ingestible single-file digest lives at [docs/spec/digest.md](https://github.com/Nossimonov/Chartdown/blob/main/docs/spec/digest.md).
