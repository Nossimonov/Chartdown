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

## Wave 3 — new since the last round, and the focus of this pass

Everything below is new language surface. It is the largest batch so far, so a document that exercises several at once is more valuable than one probe each.

| Feature | What to exercise |
|---|---|
| **`every` — repeated placement** (#114) | `pillar : every 4 in FH38..GF102` — one line, N cells, offsets from the range's NW corner so the first cell always lands. `every 4x6` steps axes independently. **`on <hall> at every 4 in C4..AB60`** puts the colonnade in the hall's frame, so moving the hall moves all of it. Over 4096 cells errors. |
| **`every … along`** (#140) | `lamp : every 40ft along gallery light=30ft` — spacing by a **measure**, not a count. On a grid it walks the cells the course covers; on a region map, arc length. |
| **A barrier on a structure side** (#130) | `cave-in : east` under a `building` replaces that side's perimeter with that barrier — side words or edge tokens, the barrier's own facets, theme and export. A `fence`-derived choke passes sight; a `wall`-derived one does not. **`every` over edges is deliberately refused** and says to name the side instead. |
| **`join` — confluences** (#94) | `river bruinen : from misty at (665,320) via (628,440) join mitheithel` ends on the trunk's finished curve. Move the trunk: the confluence moves. `to <river>` still means its midpoint. Two rivers that **cross** without a declared meeting now warn. |
| **`peak` / `volcano`** (#95) | `peak erebor "Erebor" : (1185,290)` is one mountain at a point, not a small region. `volcano` derives from it and renders a crater silhouette. `states=dormant,erupting`. |
| **Framed shapes** (#142) | `ridge on erebor at (-70,100) (-90,170)` — points are offsets from the referent, so the **whole shape travels** when it moves. Try moving the mountain and confirm the spur does not deform. |
| **Organic `area`** (#96) | A shaped terrain outline is now splined and roughened rather than drawn as a straight-edged polygon. `raw` opts back into literal edges. Water areas and `along`-following boundaries stay literal by design. |
| **Shafts** (#112) | `to=<a>..<b>` lands on every level in the range from one line; `through=<a>..<b>` marks levels the shaft passes without opening onto (drawn as an obstruction, no landing); `to=` on an `air` area names where a fall lands. |
| **`detail-at=` + `inset:`** (#109, #143, ADR 0021) | Parent: `detail="mazarbul.cd" detail-at=CP12`. Child: `inset: khazad-dum.cd at mazarbul`. `check` either file and the seam is validated both ways — non-integer magnification, an under-covering child grid, a parent that does not point back. **An unsupplied counterpart reports *unchecked*, not ok.** |
| **`detail:` render resolution** (#139, ADR 0020) | `detail: reference` doubles a region canvas so fine names survive for a reader who zooms; `overview` (default) is unchanged. Inert on grid maps, and says so. |
| **Header validation** (#135, #136) | `legend: yes`, `numbers: ON`, `labels: dense` are now **errors**, not silent defaults. So are malformed `extent:`/`seed:`/`scale:`/`chartdown:`. |
| **Label placement** (#132, #133, #134, #137, ADR 0019) | Line labels now claim **before** point labels, and a label with nowhere adjacent takes a **leader line** rather than being dropped. Worth eyeballing on a dense region map. |

### One fix worth its own line

A **feature line with several cells drew only the first** (`torch : D8 H8 L8` rendered one torch). Barriers always drew all of them; features did not, silently, for as long as features have existed. If you have a map with multi-cell feature lines, its render will change — that change is the fix.

## Fixed since the last round — please re-verify these five

All from the battlemap exercise, all on `0.4-dev`. Your original repros should now behave as marked.

| Issue | What was wrong | What to check now |
|---|---|---|
| **#125** | The unparented-opening check asked whether `earth` was *ever declared* over a cell, not whether it **wins** there. Since spec 06 §5's idiom is to lay ground truth across a level and paint over it, any map declaring `earth` broadly let every opening through unchecked. | Both directions: an opening in rock that *is* overpainted by floor must now fail ("no barrier to perforate"), and one in genuine rock must still pass. The mirror-image false positive — "solid ground on both sides" firing on open grass — is gone. |
| **#126** | `passes=` values were never validated. Worse than reported: **`sight=` was never enumerated in the spec at all**, only implied by two examples. | Both facets are closed sets now — `passes=` is `open`/`closed`/`none`, `sight=` is `all`/`none` (spec 04 §1). A typo **warns** on vocab lines, entities, and details alike, and `check` still exits 0. |
| **#127** | A misspelled ambient value was accepted silently. | `light: dalyight` now **warns** (and still renders — field values stay open vocabulary, spec 04 §2). `light` ships `states=dark,dim,daylight,moonlight` — it previously had **no declared values**, so there was nothing for a typo to fail against. |
| **#128** | A barrier word in a structure detail rendered an ordinary wall, and the warning diagnosed the wrong problem. | The diagnostic now names the real failure and points at freestanding barriers. **See the note below — this one is scheduled to change again.** |
| **#129** | Inferred document kind never warned, though spec 01 §2 and this document both promised it would. | A vocabulary or theme document with no `kind:` names the inferred kind and the line to add. |

**Warnings do not fail `check`.** Everything in the table above except #125 is a warning: the diagnostic prints and the exit code stays 0. That is deliberate — spec 04 §2's promise is that nothing is blocked on defining, so a typo is reported without refusing to render. An earlier revision of this table said "fails" and cost a tester a round of exit-code checking.

**#128's warning is gone, and that is the feature.** #130 landed, so `cave-in : east` is now legal and the diagnostic it used to draw was removed with it.

## What is NOT done yet — please don't report these as bugs

Accepted and specified, but **not implemented**:

- **#123** the six coherence lints (`door-onto-void`, `overlapping-structures`, `terrain-crosses-wall`, …)
- **#116** dead-declaration warnings
- **#124** staged revelation (`hidden=<group>`, `[gm <group>]`, `--reveal`)
- **#93** placed coast/river morphology (`cape`, `cove`, `island` on a spine)

Also open: **#74** (themes fleshed out), which is the phase's capstone.

## What feedback is most useful

The two previous exercises worked because they authored something real at scale and reported what could not be *said*, not just what looked wrong. Same again:

1. **Workarounds you had to invent.** If you wrote something awkward to get an effect, that is the finding — say what you wanted to write.
2. **Silent wrongness.** Anything that renders plausibly but is not what the document says. This has been the most valuable category by far.
3. **Diagnostics that misled you.** A wrong or unhelpful error message is a bug; one of them (`"a parent structure, a freestanding wall, or a declared impassable surface"` promising more than the code checked) is how a real regression was caught while writing this document.
4. **Whether the new noise is worth it.** 0.4 warns in places 0.3 did not. If a warning fires on something legitimate, that is a false positive worth reporting — two classes were already found and exempted this way.

Reproductions in the style of #101–#105 (a minimal document, the command, expected vs actual) are ideal and made the last batch quick to fix.

## Current state

- **310 tests** green, typecheck clean, committed example SVGs regenerated where Wave 3 changed them (Gumdrop Vale's forest, Vessany's and Sundered Reach's labels) and verified against the renderer.
- Phase 4: **30 of 37 issues closed**. Milestone: *Phase 4 — Language depth (v0.4)*.
- ADRs added this phase: [0015](decisions/0015-one-staging-zone-spelling.md), [0016](decisions/0016-derivation-carries-word-keyed-behaviour.md), [0017](decisions/0017-openings-perforate-terrain.md), [0018](decisions/0018-fields-generalize-light.md), [0019](decisions/0019-line-labels-claim-before-point-labels.md), [0020](decisions/0020-render-resolution-is-editorial.md), [0021](decisions/0021-a-map-is-the-sum-of-its-files.md).
- The language reference for agents is `docs/spec/digest.md` **on this branch** — the published `llms-full.txt` is 0.3.3 and does not describe any of the above.
