# 0010 — UVTT export lives in the renderer and the caller supplies the raster

- **Status:** Accepted
- **Date:** 2026-07-21
- **Issue:** #40

## Context

Owner review of the Obsidian plugin asked for UVTT export at the point of use — a button beside each rendered map. Spec 06 §9 had described the UVTT mapping since #18 but only as a non-normative note; implementing it forces three decisions: where the exporter lives, where wall geometry comes from, and who produces the raster image UVTT files embed.

The geometry question has a wrong answer available: reimplementing walls in the exporter. The renderer already computes sight-blocking walls per cell edge — ruined sides removed, windows opened, coincident edges deduplicated (spec 06 §3) — for its light engine. A second implementation would drift, and an exporter whose walls disagree with the rendered image is worse than no exporter.

The raster question has a constraint: UVTT files carry a base64 PNG, but the reference renderer is runtime-dependency-free by rule (ADR 0007) and Node has no canvas. Any in-renderer rasterizer means either a native dependency or a headless browser.

## Decision

- **The exporter lives in `@chartdown/render-svg`** (`exportUvtt` / `exportUvttSource`), and wall geometry is extracted into a shared module (`walls.ts`) consumed by both the light engine and the exporter — one wall truth, two views: `blockers` (sight semantics: windows open, doors block) and `losWalls` (UVTT semantics: every portal edge is a hole, portals own their occlusion).
- **The caller supplies the raster.** The exporter returns the UVTT geometry, the exact SVG it corresponds to, and the pixel rect of the playable grid region within it. Hosts with a canvas (the Obsidian plugin, browsers) rasterize that region at `pixels_per_grid` and drop the base64 into `image`; hosts without one export geometry with an empty image.
- **One file per level**, `level` an option defaulting to the document's `level:` header; export is mode-aware (player exports carry no secrets); non-battlemaps fail loud.
- Spec 06 §9 is rewritten as the normative mapping, including the window encoding: a `line_of_sight` hole plus a shut portal — UVTT has no sight facet, but the pair reproduces "sight passes, movement doesn't."

## Alternatives considered

- **A separate `@chartdown/export-uvtt` package**: cleaner-sounding, but the exporter's substance *is* renderer geometry — separating them reintroduces the drift the shared module exists to prevent, for no consumer who wants export without rendering.
- **Bundling a rasterizer** (canvas native dep, resvg-wasm, or headless browser): violates ADR 0007's dependency-free rule or bloats every consumer for a capability hosts already have.
- **Reimplementing walls in the exporter**: rejected outright; see context.
- **All levels in one file**: UVTT has no level concept; a stacked image is wrong in every VTT.

## Consequences

Exporter and render cannot disagree — they read the same segments. Any future wall-semantics change (new opening kinds, curved smoothing) lands in one module and both consumers follow. The costs: the exporter's `image` is only as good as the host's rasterizer (quality varies by canvas implementation), CLI-based UVTT export needs a raster story before it ships (deferred), and `walls.ts` is now a semantic contract two consumers depend on — its behavior is effectively frozen by both the light snapshots and the UVTT tests.
