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

Live in [docs/decisions/](docs/decisions/), numbered sequentially (`0001-...md`, `0002-...md`). Copy [0000-template.md](docs/decisions/0000-template.md). A reversal is a *new* ADR that supersedes the old one.

**A number is claimed when the ADR merges, not when it is drafted** ([#276](https://github.com/Nossimonov/Chartdown/issues/276)). Take the next free number while drafting so you can cite it in code and commits, and accept that a concurrent branch may take the same one — **whoever merges second renumbers.** Two ADRs drafted at once always collide in this section's index table, so git raises the conflict and nothing lands ambiguously; renaming the file, its index row and any references is the whole job. Chartdown 0039 and 0040 were drafted against each other this way.

**An ADR becomes immutable when it reaches `preview`, not when its header says Accepted.** Until then it is a draft with a status field — a factual error in it is corrected in place, and its number may still move. After it, the text is fixed and a change of mind is a new ADR that marks it **Superseded**, linking both ways. The boundary is publication because that is when others can rely on it; nothing enforces this but review.

## Branches, deploys, and releases

Three lanes (issue #37):

- **`preview`** — the staging branch. Pushes deploy a staging playground at [/Chartdown/preview/](https://nossimonov.github.io/Chartdown/preview/) so features can be exercised live before they reach `main`. CI runs here too.
> **`Closes #n` is honoured on merge to `preview`, by a workflow** ([#310](https://github.com/Nossimonov/Chartdown/issues/310)). GitHub itself acts on closing keywords only for the **default** branch, and every PR here targets `preview` — so the keyword did nothing at all until this was automated, and 0.6.0 shipped with twenty issues fixed, released and published while still showing open. Write the keyword as you would anywhere; [`close-on-preview.yml`](.github/workflows/close-on-preview.yml) closes the issue when your PR merges, with a comment saying the fix is on `preview` and the release is still to come. A cited issue (`see #50`) is untouched — only a closing keyword closes. The parsing lives in [`closing-refs.mjs`](closing-refs.mjs) and is tested, because a regex over prose that decides whether somebody's issue closes should not sit unexercised inside a YAML file.

- **`main`** — production. Merges deploy the production playground at the site root. `main` stays coherent (spec = examples = implementation) at every commit. **Direct pushes are rejected — including for admins**: changes reach `main` only by pull request from `preview`, with CI (`test`) and the source-branch check (`gatekeeper`) required to pass.
**Breaking work rides `preview` like everything else** ([ADR 0041](docs/decisions/0041-breaking-means-a-clean-document-stops-checking-clean.md), [#273](https://github.com/Nossimonov/Chartdown/issues/273)). There is no separate lane. Mark the changelog entry `BREAKING`, and the release cut from `preview` is a **minor**; with no BREAKING entry in `[Unreleased]` it is a **patch**. The changelog is the answer — check it rather than remember it.

> **What counts as breaking:** a document that used to check clean stops checking clean, a declaration's meaning changes, or a shipped tool changes a default or a contract. **Nothing else** — including a change that repaints every map. `light: daylight` moving from 0.82 to 0.20 opacity is a fix; a bare archetype word becoming an error is breaking. The question is not how large the diff looks, it is whose promise was broken. ADR 0041 carries the worked table.

> **A patch while breaking work is unreleased** needs a branch from the last tag, not from `preview` — cherry-pick the fix there. This is the cost of having no separate lane, and it is deliberate.

<details><summary>Historical: the <code>0.4-dev</code> lane (retired)</summary>

Phase 4 opened a `0.4-dev` branch so `preview` could stay releasable as a patch at all times. Every breaking change since went through `preview` anyway, and by 2026-08-08 the branch was 82 commits behind with none of its own; ADR 0041 retired it. The branch was deleted on 2026-08-10 — 0 commits ahead of `preview`, so its history is `preview`'s history. Branches now delete themselves on merge.

It was created by branching at the breaking commit and **reverting that commit on `preview`**, which makes git treat the change as already-seen so a plain merge will not re-apply it — the merge-back required reverting the revert first (`git revert <revert-sha>`). That operation has already been carried out; the note is kept because the git subtlety is expensive to rediscover if the pattern is ever used again.

</details>

- **Version tags** — the npm release lane. Publishing is *never* triggered by a branch push. To release, run the bump command — it rewrites **every** version surface in one shot (the six `packages/*/package.json`, render-svg's pin on core, the parser's `SPEC_VERSION`, the digest/grammar/spec-README headers, and it rolls the `[Unreleased]` changelog items into the new `## [x.y.z]` section with compare links) — then review the diff, commit, and after the PR reaches `main`, tag:

  ```sh
  npm run bump -- 0.4.0
  git diff && npm test        # every surface is also consistency-tested
  # …commit, PR to main, then:
  git tag v0.4.0 && git push origin v0.4.0
  ```

  Never bump by hand-editing the list above — a core test asserts all surfaces agree, so a missed one fails `npm test` (and with it the release gate), but the *easy* way is the command. (The Obsidian plugin's `0.1.x` lane versions separately by design.)

  The [release workflow](.github/workflows/release.yml) builds, typechecks, tests, refuses to publish unless the tag equals every package version **and** has a matching changelog section, publishes `@chartdown/{core,render-svg,cli,browser}` via **npm OIDC trusted publishing** — no tokens or OTPs; provenance attestations are automatic — and creates the GitHub Release with that changelog section as its notes. Each package on npmjs.com names `release.yml` in this repo as its trusted publisher.

Both `preview` and `main` are protected against force-pushes and deletion; `main` additionally requires the PR flow above (`enforce_admins` is on, so owner credentials — human or agent — get no bypass).
