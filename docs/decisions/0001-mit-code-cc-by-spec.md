# 0001 — Code is MIT; the specification is CC-BY-4.0

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #6

## Context

The license shapes adoption, and the prior-art survey ([docs/prior-art.md](../prior-art.md)) turned licensing from a formality into a strategic finding. Chartdown's central thesis is that *embedding is the product*: the language wins by being rendered natively inside platforms (Markdown hosts, Obsidian, Kroki, VTT importers), which requires those platforms to take the code on without legal review. Mermaid (MIT) was adopted by GitHub, GitLab, and Obsidian; Text Mapper (AGPL) — the closest prior art — was embedded by essentially no one, and its license is one plausible reason. Separately, the spec is a prose document with the ambition of becoming an interchange standard that third parties implement independently, which is a different kind of artifact from code; CommonMark set the precedent of licensing the two differently (spec CC-BY-SA, reference code BSD).

## Decision

The repository is licensed under the **MIT License**, with one carve-out: the contents of `docs/spec/` — the Chartdown language specification — are licensed **CC-BY-4.0**. The root `LICENSE` file states both. Copyright is held by "The Chartdown Authors."

Anyone may therefore embed, fork, or ship the reference implementation with only attribution, and anyone may implement, republish, translate, or excerpt the specification with attribution, including commercially and without share-alike obligations.

## Alternatives considered

- **MIT everything** — simplest, and nearly chosen. Rejected only because CC licenses are purpose-built for prose and better understood by non-software implementers of a spec (publishers, tool vendors quoting spec text).
- **Apache-2.0 code + CC-BY-SA spec** (the CommonMark combo) — Apache's patent grant is marginally more enterprise-comforting, but MIT's ubiquity beats it for frictionless embedding; CC-BY-SA's share-alike can deter commercial republishing of spec-derived documentation (e.g. a VTT vendor's own format docs), which works against interchange-format adoption.
- **Copyleft (GPL/AGPL family)** — keeps derivatives open, but directly contradicts the embedding thesis; Text Mapper is the cautionary example in our own survey.
- **Do nothing (no license)** — blocks all outside contribution and use; strictly worse than every option.

## Consequences

- Platforms and VTT vendors can embed the renderer or implement the spec with zero legal friction — the adoption path the whole strategy depends on.
- We give up copyleft's guarantee that improvements flow back; a proprietary fork of the renderer or a non-open spec derivative is legal. Accepted: for a format, ubiquity is worth more than reciprocity.
- The `docs/spec/` carve-out must be maintained: spec files should carry a CC-BY-4.0 notice as the spec grows, and contributors are agreeing to different terms for spec prose than for code.
- "The Chartdown Authors" as copyright holder avoids naming an individual; if a legal entity ever exists, a new ADR can supersede this one.
