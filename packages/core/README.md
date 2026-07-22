# @chartdown/core

Parser and AST for [Chartdown](https://github.com/Nossimonov/Chartdown) — a plain-text, Markdown-inspired language for TTRPG maps (battlemaps, hex charts, region maps). Zero runtime dependencies.

```js
import { parse } from "@chartdown/core";

const { document, diagnostics } = parse(source);
```

Pair with [`@chartdown/render-svg`](https://www.npmjs.com/package/@chartdown/render-svg) to render, or try the [playground](https://nossimonov.github.io/Chartdown/). The language is specified in [docs/spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec) (CC-BY-4.0).

**For AI agents**: the whole language fits in one file, shipped with this package at `node_modules/@chartdown/core/digest.md` and served at [nossimonov.github.io/Chartdown/llms-full.txt](https://nossimonov.github.io/Chartdown/llms-full.txt) (index: [/llms.txt](https://nossimonov.github.io/Chartdown/llms.txt)). Read it before writing Chartdown; validate drafts with `npx @chartdown/cli check` — the diagnostics cite spec sections. Best experience: the [`@chartdown/mcp`](https://www.npmjs.com/package/@chartdown/mcp) server (`claude mcp add chartdown -- npx -y @chartdown/mcp`) adds check/render/spec as tools, with renders returned as viewable PNGs.
