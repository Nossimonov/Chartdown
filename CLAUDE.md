# CLAUDE.md

Chartdown is a plain-text, Markdown-inspired syntax for describing maps and charts (fantasy maps, hex charts, TTRPG battlemaps) that renders to visuals. The project is currently in its **design phase**: the product is the language specification, and prose/spec work is the primary activity, not code.

## Where things live

| Path | Purpose |
|---|---|
| `docs/vision.md` | Goals, non-goals, success criteria — read this first when scoping anything |
| `docs/roadmap.md` | Phased plan; phases map 1:1 to GitHub milestones |
| `docs/spec/` | **Single source of truth for the language.** Anything not here is not Chartdown |
| `docs/decisions/` | ADRs, numbered sequentially; template at `0000-template.md`; index in its README |
| `examples/` | Chartdown documents, one directory per example, each with a status (`aspirational` or `spec-aligned`) |
| `CONTRIBUTING.md` | Issue-tracking rules, label taxonomy, syntax-proposal process |

## Process rules (binding)

These come from CONTRIBUTING.md; follow them even when the user doesn't mention them:

1. **Issue-first.** Before starting non-trivial work, check for a GitHub issue (`gh issue list`); if none exists, create one (or ask the user to confirm creating one) before proceeding. Reference the issue in commits; close with `Closes #<n>`.
2. **Spec-first.** Never implement rendering/parsing behavior that isn't in `docs/spec/`. If the user asks for an unspec'd feature, the first deliverable is a spec change or syntax-proposal issue, not code.
3. **ADRs for decisions.** When work involves choosing between alternatives (syntax design, tech stack, scope), record the outcome as an ADR in `docs/decisions/` before closing the issue: copy the template, take the next number, update the index table in `docs/decisions/README.md`. Accepted ADRs are immutable — reversals are new ADRs that supersede.
4. **Spec and examples move together.** A PR that changes the spec must update any examples it invalidates. `main` never has a spec that contradicts `examples/` or the implementation.
   Additionally (issue #12): any change to a `docs/spec/` section updates `docs/spec/grammar.ebnf` and `docs/spec/digest.md` in the same commit — the grammar and digest are never allowed to drift from the prose.
5. **Syntax changes go through proposals.** Use the syntax-proposal issue template (problem, worked example, alternatives, interactions). The README's syntax sketch is illustrative, not normative — don't cite it as spec, and don't extend it; if the spec diverges from it, update the README sketch to match the spec.

## Issue tracker conventions

- Labels: exactly one `type:` (`proposal`/`task`/`bug`/`question`) plus at least one `area:` (`syntax`/`renderer`/`docs`/`tooling`). `status: blocked` issues must link their blocker.
- Milestones are roadmap phases. Issues need a written done-state in the body before work starts.
- Branches: `issue-<number>-<short-slug>`.

## Working style

- When designing syntax, start from `examples/` — write the document a GM would want to write, then derive grammar. Never design grammar in the abstract.
- Readability of source text is the top design value (see `docs/vision.md` guiding principles). Prefer syntax a human can skim unrendered.
- Stack (ADR 0007): TypeScript npm-workspace monorepo under `packages/` (`@chartdown/core` = parser/AST). **`packages/core` and the renderer must stay free of runtime dependencies** — dev-deps are unconstrained. Commands: `npm test`, `npm run typecheck`; CI runs both on push/PR.
- Commit messages: imperative mood, reference issues. Don't commit or push without being asked.
