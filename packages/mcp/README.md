# @chartdown/mcp

MCP server for [Chartdown](https://github.com/Nossimonov/Chartdown) — plain-text TTRPG maps. Gives AI agents the full authoring loop: read the spec, draft, validate fail-loud, and *look at* the rendered map.

```sh
# Claude Code
claude mcp add chartdown -- npx -y @chartdown/mcp
```

| Tool | What it does |
|---|---|
| `chartdown_spec` | The whole language in one file (the spec digest) — read before writing |
| `chartdown_check` | Parse + render validation; diagnostics cite the spec sections they enforce |
| `chartdown_render` | Deterministic render — `format: "png"` (default) returns a viewable image; `"svg"` the text. `mode`, `level`, `theme` options |
| `chartdown_uvtt` | Universal VTT geometry export (spec 06 §9) |

PNG rendering is self-contained: `@resvg/resvg-wasm` (pure WebAssembly, no native binaries or browser) with a vendored [DejaVu Sans](assets/FONT-LICENSE) — identical rasters on every machine.

The language is specified in [docs/spec](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec) (CC-BY-4.0); try it in the [playground](https://nossimonov.github.io/Chartdown/).
