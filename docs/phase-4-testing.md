# Phase 4 testing handoff

*Working notes for exercising the in-progress 0.4 language. Delete when 0.4.0 ships.*

## Which build to test

**Test the `0.4-dev` branch, built from source.** Nothing here is published.

```sh
git checkout 0.4-dev && git pull
npm ci && npm run build
node packages/cli/dist/cli.js check  <file.cd>
node packages/cli/dist/cli.js render <file.cd> -o out.svg
```

**Do not use `npx @chartdown/cli` or `npx -y @chartdown/mcp`.** npm serves **0.3.3**, which has none of this — every 0.4 feature will look unimplemented and every 0.4 fix will look unfixed. If you use the MCP server, register the local build:

```sh
claude mcp add chartdown-dev -- node <repo>/packages/mcp/dist/mcp.js
```

Three branches, deliberately different:

| Branch | What it is |
|---|---|
| `main` | v0.3.3, released. The published playground. |
| `preview` | v0.3.3 plus docs. **Kept releasable as a patch at all times** — no breaking changes. |
| `0.4-dev` | **Test this.** All Phase 4 work; contains breaking changes. |

## Migrating a 0.3-era document — verified, not remembered

Run an existing map through `check` first. These are the things that will fire:

**Errors (must fix):**

- **`party start : <range>` → `start party : <range>`.** A staging zone is now the word `start`; a token word carrying an area placement fails loud (ADR 0015). The rendered label changes from `start` to `party`.

**Warnings (informational — 0.4 is deliberately noisier):**

- **Undeclared states.** A bare word that isn't a reserved flag should be declared with `states=` on the word or an ancestor. It still renders. `border` predicates and wall-state details (`ruined : north east`) are exempt, and undefined words are never checked.
- **Missing `kind:`** on a vocabulary or theme document. Inference still works; `kind: vocabulary` / `kind: theme` as the first header line silences it.

**Silent behaviour changes (worth eyeballing):**

- **`passes=` defaults to `open`.** An opening with no explicit `passes=` used to export as a *closed* portal; an `arch` now exports as a hole with no portal. Check your UVTT output if you rely on it.
- **`earth` boundaries now occlude.** A cave system exports far more `line_of_sight` geometry than before (16 → 74 segments on a small test map). This is the fix, not a regression.
- **Walls gap at openings** (landed in 0.3.3, restated here because it changes every battlemap's look).

## What is DONE and testable now

Nine issues, all on `0.4-dev`.

| Area | What to exercise |
|---|---|
| **Derivation carries behaviour** (#115, ADR 0016) | Derive from a load-bearing word and check it keeps its powers: `void : air` is unfloored, `waypoint : note` is free text, `rally : start` is a staging zone. Spec 04 §2 has the registry of which words carry machinery. |
| **`void`** (#115) | `void : air` ships — the underground spelling of "no floor". `void.edge` and `air.edge` are now separately themeable. |
| **Free text derivation** (#111) | `[vocab] waypoint : note` then `waypoint w1 "1 — The Door" : J8` in `[labels]`. A typo (`noet`) must still error. |
| **`kind:`** (#110) | `kind: vocabulary` / `kind: theme` as the first header line; `check` should validate both. `kind: spaceship` must error. |
| **Openings in rock** (#113, ADR 0017) | A gate cut into `earth` with **no parent structure**. Passable both sides, or solid both sides, must fail loud. Openings on walls and perimeters must still work. |
| **`passes=`** (#113) | Closed set `open`/`closed`/`none`, default `open`, resolved through the vocabulary chain. Check UVTT portals. |
| **Declared states** (#108) | `states=` on a word; a typo warns. `door` now ships `locked,barred,stuck,ruined`, inherited by `gate`. |
| **Free text placements + `key=`** (#107) | The set is `<point\|cell>`, `<range>`, `sprawl <range>`, `along <ref>`. `along` now draws the caption **on the course**. `key=<n>` works without `labels: keyed` — a numbered route through a named map. |
| **Fields** (#106, ADR 0018) | `light: dark` (and `light <level>: daylight`) makes a dark map with emitters as pools. Declare your own: `[vocab] radiation : field occluded=none states=none,heavy,lethal`, then `radiation: heavy` and `reactor : F4 radiation=40ft`. |

## Fixed since the last round — please re-verify these five

All from the battlemap exercise, all on `0.4-dev`. Your original repros should now behave as marked.

| Issue | What was wrong | What to check now |
|---|---|---|
| **#125** | The unparented-opening check asked whether `earth` was *ever declared* over a cell, not whether it **wins** there. Since spec 06 §5's idiom is to lay ground truth across a level and paint over it, any map declaring `earth` broadly let every opening through unchecked. | Both directions: an opening in rock that *is* overpainted by floor must now fail ("no barrier to perforate"), and one in genuine rock must still pass. The mirror-image false positive — "solid ground on both sides" firing on open grass — is gone. |
| **#126** | `passes=` values were never validated. Worse than reported: **`sight=` was never enumerated in the spec at all**, only implied by two examples. | Both facets are closed sets now — `passes=` is `open`/`closed`/`none`, `sight=` is `all`/`none` (spec 04 §1). A typo fails on vocab lines, entities, and details alike. |
| **#127** | A misspelled ambient value was accepted silently. | `light: dalyight` now fails. `light` ships `states=dark,dim,daylight,moonlight` — it previously had **no declared values**, so there was nothing for a typo to fail against. |
| **#128** | A barrier word in a structure detail rendered an ordinary wall, and the warning diagnosed the wrong problem. | The diagnostic now names the real failure and points at freestanding barriers. **See the note below — this one is scheduled to change again.** |
| **#129** | Inferred document kind never warned, though spec 01 §2 and this document both promised it would. | A vocabulary or theme document with no `kind:` names the inferred kind and the line to add. |

**#128 is a moving target on purpose.** The capability half is filed as #130 (*a barrier word on a structure side*) and is **accepted but not yet implemented** — deliberately held so this round can verify #128 as filed. When #130 lands, `cave-in : east` becomes legal and that warning is **removed**. If you are reading this after that happens, its absence is the feature, not a regression.

## What is NOT done yet — please don't report these as bugs

Accepted and specified, but **not implemented**:

- **#94** `join` for river confluences
- **#95** `peak` / `volcano`
- **#96** organically-finished `area` terrain, and the `raw` opt-out
- **#114** `every` repeated placement (colonnades)
- **#112** shafts — `through=`, `to=<level>..<level>`, `to=` on an `air`/`void` area
- **#109** `detail-at=` and the sub-map seam check
- **#123** the six coherence lints (`door-onto-void`, `overlapping-structures`, `terrain-crosses-wall`, …)
- **#116** dead-declaration warnings
- **#124** staged revelation (`hidden=<group>`, `[gm <group>]`, `--reveal`)
- **#93** placed coast/river morphology (`cape`, `cove`, `island` on a spine)
- **#130** a barrier word on a structure side (`cave-in : east`) — accepted this round, held until this verification completes

Also open: **#74** (themes fleshed out), which is the phase's capstone.

## What feedback is most useful

The two previous exercises worked because they authored something real at scale and reported what could not be *said*, not just what looked wrong. Same again:

1. **Workarounds you had to invent.** If you wrote something awkward to get an effect, that is the finding — say what you wanted to write.
2. **Silent wrongness.** Anything that renders plausibly but is not what the document says. This has been the most valuable category by far.
3. **Diagnostics that misled you.** A wrong or unhelpful error message is a bug; one of them (`"a parent structure, a freestanding wall, or a declared impassable surface"` promising more than the code checked) is how a real regression was caught while writing this document.
4. **Whether the new noise is worth it.** 0.4 warns in places 0.3 did not. If a warning fires on something legitimate, that is a false positive worth reporting — two classes were already found and exempted this way.

Reproductions in the style of #101–#105 (a minimal document, the command, expected vs actual) are ideal and made the last batch quick to fix.

## Current state

- **222 tests** green, typecheck clean, committed example SVGs unchanged.
- Phase 4: **14 of 26 issues closed**. Milestone: *Phase 4 — Language depth (v0.4)*.
- ADRs added this phase: [0015](decisions/0015-one-staging-zone-spelling.md), [0016](decisions/0016-derivation-carries-word-keyed-behaviour.md), [0017](decisions/0017-openings-perforate-terrain.md), [0018](decisions/0018-fields-generalize-light.md).
- The language reference for agents is `docs/spec/digest.md` **on this branch** — the published `llms-full.txt` is 0.3.3 and does not describe any of the above.
