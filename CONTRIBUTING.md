# Contributing to Chartdown

Chartdown is in its design phase, so most contributions are *ideas and words*, not code. These rules keep the design process legible — six months from now we should be able to reconstruct why every syntax decision was made.

## The three rules

1. **Issue-first.** Every unit of work — spec section, code change, doc rewrite — starts as a GitHub issue *before* the work happens. Trivial fixes (typos, broken links) are exempt.
2. **Spec-first.** No feature is implemented before it exists in [docs/spec/](docs/spec/). The renderer follows the spec, never the reverse.
3. **Decisions leave a record.** Any decision that closes off alternatives (syntax choices, tech stack, scope cuts) gets an Architecture Decision Record in [docs/decisions/](docs/decisions/) before the issue is closed.

## Issue tracking rules

### Labels

Every issue gets exactly one `type` label and at least one `area` label:

| Label | Meaning |
|---|---|
| `type: proposal` | A syntax proposal (see below) |
| `type: task` | Concrete, scoped work with a clear done-state |
| `type: bug` | Something implemented behaves contrary to the spec |
| `type: question` | Open design question; may spawn proposals |
| `area: syntax` | The Chartdown language itself |
| `area: renderer` | Parsing and rendering |
| `area: docs` | Documentation, examples, website |
| `area: tooling` | CI, build, editor integrations, project infrastructure |
| `status: blocked` | Waiting on another issue or decision (link it) |
| `good first issue` | Well-scoped, low-context entry point |

### Milestones

Milestones mirror the [roadmap](docs/roadmap.md) phases (`Phase 0 — Foundation`, `Phase 1 — Spec v0.1`, …). Every issue that advances the roadmap gets a milestone; ideas without a home stay milestone-less in the backlog.

### Issue lifecycle

- An issue is **ready to work** when its done-state is written down in the issue body. "Think about hex grids" is not ready; "Propose hex grid coordinate syntax with worked examples for both orientations" is.
- Close issues only when the done-state is met, with a closing comment linking the commit/PR/ADR that met it.
- Stale ideas get closed with `not planned`, not left open indefinitely — the tracker reflects intent, not fantasy.

## Syntax proposals

Syntax is the product, so changing it has its own process. A syntax proposal issue (template provided) must contain:

1. **The problem** — what can't be expressed today, or is awkward to express.
2. **Proposed syntax** — at least one complete worked example (source text + description of expected render).
3. **Alternatives considered** — including "do nothing."
4. **Interactions** — how it composes with existing spec sections.

Proposals are decided by discussion on the issue. Acceptance means: an ADR is written if the decision was contentious, the spec in [docs/spec/](docs/spec/) is updated, and an example is added to [examples/](examples/). Only then is the issue closed.

## Git conventions

- Branch names: `issue-<number>-<short-slug>` (e.g. `issue-12-hex-coordinates`).
- Commits and PRs reference their issue; use `Closes #<n>` when the change completes the issue's done-state.
- `main` stays coherent: spec, examples, and implementation must not contradict each other at any commit on `main`. If a spec change lands, its examples land in the same PR.

## ADRs (Architecture Decision Records)

Live in [docs/decisions/](docs/decisions/), numbered sequentially (`0001-...md`, `0002-...md`). Copy [0000-template.md](docs/decisions/0000-template.md). ADRs are immutable once accepted — a reversal is a *new* ADR that supersedes the old one.

## Branches, deploys, and releases

Three lanes (issue #37):

- **`preview`** — the staging branch. Pushes deploy a staging playground at [/Chartdown/preview/](https://nossimonov.github.io/Chartdown/preview/) so features can be exercised live before they reach `main`. CI runs here too.
- **`main`** — production. Merges deploy the production playground at the site root. `main` stays coherent (spec = examples = implementation) at every commit. **Direct pushes are rejected — including for admins**: changes reach `main` only by pull request from `preview`, with CI (`test`) and the source-branch check (`gatekeeper`) required to pass.
- **Version tags** — the npm release lane. Publishing is *never* triggered by a branch push. To release: move the `[Unreleased]` items in [CHANGELOG.md](CHANGELOG.md) into a new `## [x.y.z]` section, bump all four `packages/*/package.json` versions to the same number, commit, then tag and push the tag:

  ```sh
  git tag v0.1.1 && git push origin v0.1.1
  ```

  The [release workflow](.github/workflows/release.yml) builds, typechecks, tests, refuses to publish unless the tag equals every package version **and** has a matching changelog section, publishes `@chartdown/{core,render-svg,cli,browser}` via **npm OIDC trusted publishing** — no tokens or OTPs; provenance attestations are automatic — and creates the GitHub Release with that changelog section as its notes. Each package on npmjs.com names `release.yml` in this repo as its trusted publisher.

Both `preview` and `main` are protected against force-pushes and deletion; `main` additionally requires the PR flow above (`enforce_admins` is on, so owner credentials — human or agent — get no bypass).
