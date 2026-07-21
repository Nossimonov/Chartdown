# 0007 — The reference implementation is TypeScript

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #10

## Context

Phase 2 begins with the stack for the reference parser and SVG renderer. The prior-art survey made the strategic constraint explicit before any code existed: **embedding is the product**. Mermaid beat a strictly more capable PlantUML because a dependency-free JS renderer made fenced blocks free for GitHub, GitLab, and Obsidian to adopt; PlantUML's server/Java model is the named anti-pattern, and Text Mapper's Perl is part of why its niche stayed niche. Every high-value embedding target — browsers, Obsidian plugins, markdown-it/remark, VS Code webviews, a Kroki companion container — speaks JavaScript natively. The remaining forces: parser tooling quality, CLI distribution, contribution barrier, and iteration speed while the spec is still a draft.

## Decision

The reference implementation is **TypeScript**, npm-distributed, structured as a workspace monorepo (`packages/core` now — parser and AST; renderer, CLI, and playground packages to follow). Tooling: strict TypeScript, Vitest, GitHub Actions CI. The core stays dependency-free at runtime as a hard rule — parser and renderer may depend on nothing but the language, preserving the drop-in embeddability the strategy depends on.

## Alternatives considered

- **Rust core → WASM + JS shell** — faster, stricter, true single-binary CLI. Rejected for this phase: two-language maintenance across every plugin surface, WASM bundle weight in exactly the embed contexts we prize, higher contribution barrier, and slower iteration while the spec churns. A future Rust port against the frozen spec would be a *second* implementation — which the spec-independent-of-renderer principle explicitly invites.
- **Go core → WASM** — best CLI story, weakest browser story (heavy WASM, clumsy interop); works against the thesis.
- **Perl/Python/JVM server-side** — re-runs the PlantUML/Text Mapper experiment with known results.

## Consequences

- One language spans parser, renderer, plugins, and playground; the Mermaid/Wardley-maps adoption path is open (npm → markdown-it/remark plugin → Obsidian → Kroki).
- CLI distribution rides Node or single-binary bundlers (`bun build --compile` / `deno compile`) rather than a native binary — accepted as the right trade for the audience.
- The zero-runtime-dependency rule is load-bearing and binding on `packages/core` and the renderer; dev-dependencies are unconstrained.
- Maintainer alignment: chosen by the project owner with the recommendation, not defaulted.
