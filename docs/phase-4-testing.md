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

### Two things that are expected, not bugs

- **`chartdown: 0.4` warns** that the parser implements 0.3. `SPEC_VERSION` is rewritten from the package version by `npm run bump` at release, deliberately, so the spec version and the packages can never drift apart. Until 0.4.0 ships there is no clean pin for a document using 0.4 features — write no `chartdown:` line while testing. Reported and confirmed as expected in the first Wave 3 round.
- **Declared states with no theme treatment render alike.** `volcano … erupting` is accepted and silent because `erupting` is declared vocabulary, but the default theme draws it the same as a dormant one. Themes are #74, the phase's capstone; a state being *legal* and being *drawn differently* are separate deliveries.

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

## Wave 5 — three rounds done; what changed under you

**Placed morphology** (#93, spec 05 §4) went through three rounds and came out substantially different from what round 1 tested. **Re-read spec 05 §4 before authoring** — several things you learned in earlier rounds are no longer true.

### What is new to write

| Spelling | What it does |
|---|---|
| `via` on a placed feature | **A bite or jut may bend.** `fjord hood "Hood Canal" : on shore at (36,44) via (72,48) (96,92) size=3mi taper=0.15` — the declared line is the centerline, and its own length is the depth. This is the Great Bend, and it is *not* the staged `delta`/`fork` branching: one mouth, one head (#169). |
| `on <another feature>` | **An arm may hang off an arm.** `sound dabob "Dabob Bay" : on hood at (56,44) size=2mi reach=4` — Dabob off Hood Canal, Dyes off Sinclair. It used to draw nothing at all (#170). |
| `area (…)` on a detached feature | **An island may carry its own outline** instead of the dials, so Whidbey can dogleg. Points are **offsets from the anchor**, so moving the island is one coordinate (#172, ADR 0026). |
| `chartdown frame` | Converts an absolute trace into that anchored form: `chartdown frame --at 40,100 "(38,60) (43,70) …"`. Also an MCP tool. **Please use it rather than subtracting by hand** — a mis-subtracted offset renders as a perfectly plausible island in the wrong place (#174). |

### What CHANGED — old habits will now be wrong

- **`reach=` values are recalibrated** against real Puget Sound measurements and are much larger than round 1's: `cape 0.55 · bay 1 · peninsula 1.6 · cove 3 · spit 5 · sound 6 · fjord 20`. Round 1's guesses (fjord 2) are gone.
- **`taper=` says how far the sides converge, not only where.** Near 0 the flanks run parallel into a broad round bight; at 1 it is a wedge. A fjord no longer comes out a spearpoint (#163).
- **`blob` declares an EXTENT, not an outline** (ADR 0025). `size=` is now exact — a `size=40mi` blob measures 40mi across — and its shape no longer moves when you name it, reorder the file, or add a `seed:`. A document whose shapes are all extents renders identically under every seed.
- **A placed feature is labelled on its body**, not at its mouth on the shore (#171).
- **An island is land in every sense**: overlapping land shapes are unioned, so an island touching the shore reads as one landmass rather than a ring drawn across it (#165).

### New diagnostics — all of these are deliberate

- **error**: an outline *and* `size=`/`reach=`/`taper=` together; `via` *and* `reach=` together. Both mean something would have to be discarded.
- **error**: two features claiming the same stretch of a host; a feature whose mouth runs off the end of its host. Each names its own cause — tell us if one names the wrong one.
- **warning**: an island whose footprint lies wholly on land; a river whose end falls inside a water body (either end — mouth-first authoring is why nine of them went unnoticed).

### Known gaps — please don't report these

- **`delta` and `fork` are still staged.** A river delta remains unexpressible, deliberately.
- **`in <water>` was proposed and not adopted** (#167). An island inside an inlet now works with ordinary `near` placement, and the anchoring question it raises is deferred to #162 rather than settled twice.
- **A jut or bite takes no outline.** Its shape has to stay joined to its host at two points, so it declares a centerline (`via`) instead. That asymmetry with detached features is a decision, not an oversight (ADR 0026).

### What would be most useful from round 4

The Puget Sound map should now be substantially drawable: **the six islands that divide water** (Hartstene, Squaxin, Herron, Ketron, McNeil, Anderson), **Hood Canal with its Great Bend**, **Dabob and Dyes as arms**, and **Whidbey with its dogleg** via a declared outline. Whether it actually reads as Puget Sound is the finding. #93 stays open pending exactly this.

## Wave 4 — verified in the previous round

Cleared by the battlemap agent, whose findings (#146, #147, #148, and #150) were all confirmed and fixed. Listed here as current surface, not as this pass's focus.

Wave 4 adds **no syntax at all**. Both issues are diagnostics: things a document was always allowed to say, that no reader would mean, and that until now said nothing. So the way to exercise this wave is the opposite of the last one — **run `check` over maps you have already written and believe are correct**, and judge what it says.

That framing matters, because the most valuable finding here is a **false positive**. A warning on something legitimate is a bug in the warning, and most of the exemptions in the second row below were not designed in — they were **caught**, by running the lints over documents already in this repo. The cave mouth is the sharpest case: the lint reported #113, a feature this same phase shipped, as a defect. Run against the whole committed corpus the lints found **one** real defect and five legitimate readings they had to be taught; every one of those is now a test.

| Feature | What to exercise |
|---|---|
| **Coherence lints** (#123, spec 06 §10) | Six warning-level checks over resolved battlemap geometry: `door-onto-void`, `structure-unsupported`, `unreachable-room`, `dangling-connector`, `overlapping-structures`, `terrain-crosses-wall`. Build a room with no way in, a stair landing in solid rock, two rooms clipping corners — each should name the line and the spec section. |
| **…and the readings they must NOT report** | A window facing open air; an **unparented** opening (a cave mouth is rock one side and floor the other by design, #113); an upper room standing on the room below; a room reachable only by a stair declared **on another level**; a room wholly **inside** another (containment is not overlap); terrain covering a **whole** footprint (a flooded room); a road entering a gatehouse **through its gate**. If any of these warns, that is the bug. |
| **Dead declarations** (#116, ADR 0022, spec 08 §6) | A `[theme]` subject nothing resolves to (`mountian : fill=…`); a subject that *is* styled but whose property is never read for it (`glyph=` on a battlemap's area terrain — it is filled, not marked); a `[glyphs]` name no `glyph=`/`asset=` references; a `[vocab]` word this document neither carries nor derives from. |
| **…and its scope rule** | Only the theme **selected for this render** and the document's **own** `[vocab]` are checked. A `use:`-imported theme, the built-in default, an imported vocabulary library, and a vocabulary document's own words are all exempt — they exist to offer more than any one map spends. Warnings there would be the bug. |
| **Theme diagnostics name the theme file** | A warning about a theme line carries a line number in the **theme**, and the CLI now prints it against `--theme`'s path. Previously it was printed against the map's path, so a reader was sent to the wrong file. Surfaces with no path to show say `theme line 4` rather than `line 4`. |

### Two things to know before you file

- **Warnings, never errors.** Every lint and every dead-declaration warning prints and leaves `check` at exit 0. These reason about *intent*, so a false positive must cost you a line of output and never a blocked render. There is deliberately **no suppression syntax** yet — the first real false positive should shape the escape hatch rather than have it guessed in advance, which is exactly what we want from this pass.
- **Theme liveness is only as complete as the render.** An entry is live if the render *asked for* it, so rendering a single level of a multi-level battlemap — the `level` option, reachable through the MCP `render` tool and `RenderOptions`, though not the CLI — can leave a genuinely useful entry looking dead. Known and recorded in ADR 0022; a full render is the reference case, and it is what `check` does.

### One committed example changed

**The Gilded Tankard's Snug had no door.** The lints found it in our own showcase — a full perimeter with no opening, which is exactly what `unreachable-room` is for. The example now reads `door : G4.s` and both its SVGs are regenerated. If you have that map memorized, the change is the fix.

## Wave 3 — verified in the previous round

Cleared by both testing agents with no bugs. Listed here as the current language surface, not as this pass's focus.

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
| **`detail-at=` + `inset:`** (#109, #143, ADR 0021) | Parent: `detail="mazarbul.cd" detail-at=CP12`. Child: `inset: khazad-dum.cd at mazarbul`. `check` either file and the seam is validated both ways — non-integer magnification, an under-covering child grid, a parent that does not point back. **An unsupplied counterpart reports *unchecked*, not ok.** Both ends check both halves — linkage and geometry — as of #144; before that the child validated only the linkage. |
| **`detail:` render resolution** (#139, ADR 0020) | `detail: reference` doubles a region canvas so fine names survive for a reader who zooms; `overview` (default) is unchanged. Inert on grid maps, and says so. |
| **Header validation** (#135, #136) | `legend: yes`, `numbers: ON`, `labels: dense` are now **errors**, not silent defaults. So are malformed `extent:`/`seed:`/`scale:`/`chartdown:`. |
| **Label placement** (#132, #133, #134, #137, ADR 0019) | Line labels now claim **before** point labels, and a label with nowhere adjacent takes a **leader line** rather than being dropped. Worth eyeballing on a dense region map. |

### One fix worth its own line

A **feature line with several cells drew only the first** (`torch : D8 H8 L8` rendered one torch). Barriers always drew all of them; features did not, silently, for as long as features have existed. If you have a map with multi-cell feature lines, its render will change — that change is the fix.

## Bug fixes from the Wave 2 battlemap round — already re-verified

Kept as a record of what changed and why; these were confirmed fixed in an earlier pass and need no re-testing unless something below looks wrong in passing.

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

- **line-branching morphology** — `delta` and `fork` (the inverse of #94's `join`). Part of #93 and deliberately staged out; see the Wave 5 gaps above. A river delta is currently unexpressible.

Moved OUT of Phase 4, to the new **Map state tracking** milestone — don't test for these here:

- **#124** staged revelation. Its accepted design put the reveal set on the render invocation; [#151](https://github.com/Nossimonov/Chartdown/issues/151) settles that a map describes a *place* while state describes an *occasion*, which makes the reveal set state-document content. Deferred rather than dropped.
- **#152** UVTT token export.

Also open: **#74** (themes fleshed out), which is the phase's capstone.

Known and already filed — **please don't re-report**:

- **#145** — a path's terminus is drawn to the **cell centre**, so a road ending at a boundary visibly stops mid-square. Found while judging a #123 lint result: Fairwater Manor's King's Road was written one cell *inside* the gatehouse to work around it, which is the document being bent to fit the render.
- **#141** — a river does not thicken past a confluence. Renderer work, deferred deliberately.
- **#138** — point labels do not rotate into diagonal gaps.

Still expected, not bugs (repeated from above because they keep getting reported): **`chartdown: 0.4` warns**, and **declared states with no theme treatment render alike** (that is #74).

## What feedback is most useful

The previous exercises worked because they authored something real at scale and reported what could not be *said*, not just what looked wrong. **Wave 5 returns to that mode** after Wave 4's judge-the-diagnostics round: author a real coastline and report what the language could not express, or what it drew wrongly. In rough priority for this round:

1. **Look at it.** Placed morphology fails visually before it fails a test. A bay that came out a 157° spike passed every check that existed at the time and was caught by eye; so was an island rendered in the sea's own colour. Screenshot the map and read it as a map.
2. **Say what you wanted to write.** A coastline you had to fake with `via` points, a landform with no word, a shape the two dials could not reach — that is the finding this feature exists to collect. #145 came from exactly this shape of report.
3. **Silent wrongness.** The most valuable category across every round: anything that renders plausibly but is not what the document says. A feature quietly smaller than its `size=`, a name that moved when you gave it, a declaration that drew nothing and said nothing.
4. **False positives.** A refusal or a warning that fires on something legitimate is a bug in the check, not in your document. Say what you meant by the line; the reading you intended is what the exemption gets written against. Both morphology refusals so far were the renderer's fault rather than the request's.
5. **Diagnostics that misled you.** A message naming the wrong problem, or pointing at the wrong file or line, is a bug.
6. **True positives you disagree with.** A warning can be technically right and still not worth its noise — we would rather narrow a check than add a suppression syntax.

Reproductions in the style of #101–#105 (a minimal document, the command, expected vs actual) are ideal and made the last batch quick to fix.

## Current state

- **492 tests** green, typecheck clean. Examples changed since the last round: Vessany (Gull Bay now reads as a real inlet, and its render is seed-invariant), plus the Sundered Reach and Gumdrop Vale, whose blobs changed shape once under ADR 0025. No example SOURCE needed editing for any of it. The corpus verifies through the same action driver CI uses.
- Phase 4: **43 issues, 31 closed, 12 open** — but seven of the twelve (**#116**, **#123**, **#146**, **#147**, **#148**, **#149**, **#150**) are implemented and committed on this branch and close when Phase 4 merges, since `Closes #n` only fires on the default branch. **#93** is committed in stages and stays open pending this round.
- ADRs added this phase: [0015](decisions/0015-one-staging-zone-spelling.md), [0016](decisions/0016-derivation-carries-word-keyed-behaviour.md), [0017](decisions/0017-openings-perforate-terrain.md), [0018](decisions/0018-fields-generalize-light.md), [0019](decisions/0019-line-labels-claim-before-point-labels.md), [0020](decisions/0020-render-resolution-is-editorial.md), [0021](decisions/0021-a-map-is-the-sum-of-its-files.md), [0022](decisions/0022-a-declaration-is-a-promise.md), [0023](decisions/0023-detail-is-data-not-noise.md), [0024](decisions/0024-a-feature-takes-its-bearing-from-the-water-it-sits-in.md), [0025](decisions/0025-a-blob-declares-an-extent-not-an-outline.md), [0026](decisions/0026-shape-is-declared-data.md).
- The language reference for agents is `docs/spec/digest.md` **on this branch** — the published `llms-full.txt` is 0.3.3 and does not describe any of the above.
