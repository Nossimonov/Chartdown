# 0046 — A merged branch is not an archive: history is carried by the branch it merged into

- **Status:** Accepted
- **Date:** 2026-08-10
- **Issue:** [#331](https://github.com/Nossimonov/Chartdown/issues/331)
- **Supersedes:** [ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md)'s final consequence — the one that keeps `0.4-dev` in place. 0041's decision, that breaking work rides `preview`, is untouched and still stands.

## Context

ADR 0041 retired the `0.4-dev` lane and then kept the branch:

> The `0.4-dev` branch is left in place, unreferenced, rather than deleted — deleting it would strand the revert note's history, and it costs nothing to keep.

**Both halves are wrong, and the same ADR contains the measurement that disproves the first.** Its Context table records `0.4-dev` as *"82 commits behind `preview`, **0 ahead**"* — and a branch with nothing ahead has no commit that is not already an ancestor of its target. Nothing can be stranded by deleting the name. Checked rather than assumed: the two commits other ADRs cite by SHA, `8db5f18` ([ADR 0025](0025-a-blob-declares-an-extent-not-an-outline.md)) and `5b98bf5` ([ADR 0026](0026-shape-is-declared-data.md)), both resolve from `preview` with the branch gone.

The reasoning error is specific and worth naming, because it is easy to repeat: **a branch name was treated as the thing that holds history.** It is a pointer. Deleting it removes a name, and the commits stay reachable through whatever else points at them — here, `preview`, which is every commit the lane ever had.

And keeping it was not free. The branch outlived its purpose by three releases while three documents went on describing it as live, the worst of them `docs/spec/digest.md`, whose second paragraph told readers *"this file documents in-progress spec 0.4 … 0.4.0 has not shipped … a document targeting it should carry no `chartdown:` pin"* — directly beneath a heading reading `spec v0.6` that [#90](https://github.com/Nossimonov/Chartdown/issues/90)'s test was faithfully keeping correct. That is the file published as `llms-full.txt` for agent ingestion. For three releases it told every agent that the shipped language was unfinished and that pinning it was wrong.

A dead branch is not inert. It is a thing documents can keep pointing at.

## Decision

**A branch fully contained in its target is deleted when it merges.** It carries no history the target does not already carry, so the name is the only thing removed.

Two consequences of that, both now in force:

1. **`delete_branch_on_merge` is enabled on the repository**, so this is the default rather than a chore. The rule was previously observed by nobody: cleaning up after 0.6.0 removed thirty-six merged branches, roughly one per merged pull request across two releases.

2. **Preserving a commit is done by merging it, never by leaving a branch name on it.** Where a specific commit matters to an argument, it is cited by SHA in the ADR that makes the argument — which is what ADRs 0025 and 0026 already do, and why they survived this deletion untouched.

## Alternatives considered

**Keep the branch as a marker of where the lane was.** The intent behind 0041's note, read charitably. Rejected because a branch name makes a poor label — it carries no date, no reason and no author, it appears in every `git branch -a` and every branch picker as though it were somewhere work might go, and the thing it is supposed to mark is already written down at length in 0041 itself. A paragraph that explains is worth more than a name that merely persists.

**Tag it instead, so the name survives without looking live.** Cheaper than a branch and honest about being historical. Rejected because it answers a question nobody has: the commits are ancestors of `preview`, so `git log` reaches them by date or by message without help, and a bare tag would assert *this mattered* while leaving *why* to be guessed at. Tags here mean released versions, and diluting that is a real cost against no gain.

**Leave the branch and simply fix the stale documents.** Rejected because it has the causation backwards. The documents were stale *because* there was a branch to describe; `docs/phase-4-testing.md` existed to tell testers to check out `0.4-dev`, and its own subtitle said *"Delete when 0.4.0 ships."* Fixing the prose while keeping the thing the prose is about is how the pair goes stale again.

**Leave `delete_branch_on_merge` off and sweep periodically.** Rejected. The sweep is cheap, but it is a task somebody must remember, and the branch it fails to delete is the one that starts collecting descriptions. Same shape as [#310](https://github.com/Nossimonov/Chartdown/issues/310), where the fix was making the tool close issues rather than remembering to.

## Consequences

`0.4-dev` is deleted, remote and local. CONTRIBUTING.md's historical note keeps the **revert-the-revert** paragraph, which is the part with lasting value — a git subtlety that is expensive to rediscover — and stops claiming the branch is still there.

`docs/phase-4-testing.md` is deleted, following its own instruction three releases late. Nothing linked it.

The digest's banner is gone, and a test now enforces its absence. [#90](https://github.com/Nossimonov/Chartdown/issues/90)'s test checks version *tokens*, which is all `npm run bump` can rewrite — `spec v0.5` → `spec v0.6` — and it cannot see a **sentence** making a version claim. The new check reads the shipped docs for prose asserting that a version is in-progress or unshipped, and fails when that version is one that has shipped. A claim about a future version still passes, since that is a roadmap note rather than a stale one.

**Contributor branches now disappear on merge**, which is standard but is a change somebody will notice mid-contribution. It costs nothing to re-push a branch, and the pull request keeps the diff and the discussion either way.

What this does **not** license: deleting a branch that is ahead of anything. The rule is containment, and containment is checked rather than assumed — `git merge-base --is-ancestor` per branch, which is what the 0.6.0 sweep ran twice, once when building the list and once immediately before pushing the deletion.
