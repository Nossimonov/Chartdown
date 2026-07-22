# 0014 — Generated SVGs carry a provenance marker; cleanup is gated on it, never on inference

- **Status:** Accepted
- **Date:** 2026-07-22
- **Issue:** #78

## Context

The GitHub Action writes SVGs but never deletes them, so every docId rename, fence deletion, source move, or `mode` change leaves an orphaned output behind — a stale map that still renders in docs as if current. Hit in real use: a fence split into four per-level fences left the original's SVG on disk until a human noticed.

Naive cleanup is worse than the litter. Outputs are plain `*.svg` files whose names are *derived* from sources, and inferring ownership backwards is unsafe: `keep.svg` beside a deleted `keep.cd` is indistinguishable from a hand-made SVG that happens to share a name. The failure mode to design against is deleting a file the action didn't create, or one a human deliberately kept.

## Decision

`@chartdown/render-svg` exports `stampProvenance`/`readProvenance`: a `<metadata>` element inserted after the opening `<svg>` tag recording the source path, docId, render mode, the output path the file was written to, and a do-not-hand-edit notice. The stamp deliberately excludes timestamps and renderer versions — stamping stays a pure function of its inputs, so byte-identical re-renders (spec 02 §8.2), `verify` mode, and no-op Action runs keep working. The Action stamps every job it renders.

Cleanup deletes a file only when **all three** hold:

1. it bears the marker — generated, not hand-made;
2. the marker's recorded output path is the file's own path — the original, not a copy someone kept (a carried-off snapshot records its *old* location and survives);
3. no job in the current scan produces that path — genuinely orphaned.

The Action's `clean:` input is `warn` (default) | `true` (delete; the commit step already stages deletions) | `false` (skip). `verify` mode fails on orphans like any other drift. Unmarked pre-marker outputs are warned about at most (conservative heuristic tied to still-scanned sources), never auto-deleted.

## Alternatives considered

- **Committed manifest of generated outputs** — merge conflicts in exactly the multi-author workflow the Action targets; drifts when users render locally. Provenance-in-the-artifact merges cleanly by construction.
- **Git-history forensics** ("only ever committed by the bot") — breaks on locally-rendered commits (a supported workflow) and after squash/rebase.
- **Name-pattern inference alone** — is the failure mode, not a mitigation.
- **Do nothing** — silently accumulating stale maps that present as current is worse than a visible hole.

## Consequences

Artifacts now declare themselves generated — editors, the Obsidian plugin, and any future tooling can recognize outputs without prose conventions. The first marker-aware run rewrites every output once (the migration commit that stamps everything); downstream repos see a one-time reconciliation. Output bytes now embed scan-root-relative paths, so re-rendering from a different root changes bytes — the Action always runs from the repo root, and local runs must match CI's `root` to verify cleanly. Hand-editing a generated file is still possible; the marker only documents that it will be overwritten or deleted, it cannot prevent it.
