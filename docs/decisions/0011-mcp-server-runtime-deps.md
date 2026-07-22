# 0011 — @chartdown/mcp carries runtime dependencies; the zero-dep rule binds the language core

- **Status:** Accepted
- **Date:** 2026-07-22
- **Issue:** #58

## Context

The MCP server (issue #58) exists so agents can draft, validate, and *visually verify* maps. Two of its needs cannot be met dependency-free: speaking the Model Context Protocol (the SDK), and rasterizing SVG to a viewable PNG — Node has no canvas, and returning SVG text alone would leave "look at the map" unsolved for every agent without its own browser tooling (owner review caught exactly this: the reference QA loop leaned on headless Edge, which agents won't have).

ADR 0007's zero-runtime-dependency rule protects the language core: `@chartdown/core` and `@chartdown/render-svg` must be embeddable anywhere without dragging a tree along. An MCP server is not embedded in anything — it is a leaf process an agent launches.

## Decision

`@chartdown/mcp` carries runtime dependencies: `@modelcontextprotocol/sdk` (+ `zod`, its schema layer) and `@resvg/resvg-wasm` — chosen over native rasterizers (sharp, resvg-js) because pure WebAssembly needs no platform binaries and installs identically everywhere Node runs. Text rasterization assumes no system fonts: the package vendors DejaVu Sans (free license, included) and maps the renderer's `sans-serif` to it, so rasters are byte-comparable across machines. `chartdown_render` defaults to `format: "png"` returning an MCP image block — agents with vision see the map directly; `"svg"` remains for saving/embedding.

The zero-dep rule is restated, not relaxed: it binds `@chartdown/core` and `@chartdown/render-svg` (ADR 0007); tooling leaves (`cli` and `browser` stay bundled-and-dependency-free; `mcp` and future servers may depend as their protocols demand).

## Alternatives considered

- **SVG text only, viewing is the agent's problem**: keeps the package lean but forfeits the point — most agents cannot mentally render SVG, and requiring a browser sidecar reinvents the problem per agent.
- **Native rasterizer (sharp / @resvg/resvg-js)**: faster, but platform-specific binaries multiply install failure modes for exactly the audience least equipped to debug them.
- **System fonts instead of vendoring**: nondeterministic rasters and silent tofu on fontless containers.
- **Rasterize in the renderer**: violates ADR 0007 for every consumer to serve one.

## Consequences

Agents get a self-contained draft→check→look loop on any Node ≥20. The package weighs ~3.5 MB (wasm + font) — acceptable for a leaf tool, unacceptable anywhere else, which is why the boundary sits at the package edge. The vendored font pins raster determinism but adds a license artifact to maintain. New-package bootstrap: the first npm publish cannot use OIDC trusted publishing (the package must exist before it can be configured), so 0.2.0 of `@chartdown/mcp` publishes manually once; the release workflow covers it thereafter.
