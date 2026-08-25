# 0051 — The renderer's answer is data before it is ink

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** [#355](https://github.com/Nossimonov/Chartdown/issues/355)
- **Builds on:** [ADR 0010](0010-uvtt-export-caller-raster.md), [ADR 0020](0020-render-resolution-is-editorial.md), [ADR 0037](0037-geometry-is-in-map-units-ink-is-in-canvas-units.md), [ADR 0038](0038-a-placement-form-means-the-same-thing-on-every-map-kind.md)

## Context

`render()` returns `{ svg, diagnostics }`. That is the whole surface a host gets, so a host that
wants to draw a Chartdown map with its own primitives — a native app, a canvas widget, an editor
that hit-tests what the reader clicked — cannot consume the renderer's geometry. It has to derive
that geometry a second time from the AST, which `@chartdown/core` hands over unresolved by design.

One host has done it, and its stopping point is the evidence for this ADR. A SwiftUI viewer
re-implemented the grid and hex frames, placement resolution, path bands, structure footprints,
cell edges and light pools against spec 02, 05 and 06, and its region support stops at the
boundary of `morphology.ts`: half-planes, placed morphology, organic finishing and label
arbitration. That is not a gap in effort or in the spec's clarity. It is 18k lines of decisions
that are *renderer* decisions — ADR 0025's texture, ADR 0027's welded island, ADR 0031's refused
bank — and a second implementation of them would be a second answer to questions this repo has
already answered once, in ADRs, deliberately.

What a second implementation actually produces is the failure the spec names more often than any
other: a construct that renders identically to its own absence. Before that viewer began reporting
what it could not resolve, `sea : west of coast` drew as a ten-point dot. Nothing was wrong with the
document.

**And the data exists.** `renderRegion`'s own header comment says so: *"Rendering is two-pass: all
positions resolve first (so every marker is a known obstacle), then labels place with full
knowledge."* Pass 1 builds `items: { e, r, chain }[]` where `r` is `interface Resolved` — point,
polyline, polygon, radius, ridge, belt width, half-plane, `alongSpans` — and organic finishing
happens *inside* that pass, so `r` is the geometry that gets drawn rather than the geometry that was
declared. It is complete, it is assembled in one place, and it goes out of scope when the function
returns. The battlemap side is further along still: `resolveGridPlacements` normalises placements at
model-build time, and `grid.ts` and `walls.ts` expose cells, footprints, perimeter edges and wall
segments as pure functions. `exportUvtt` is the standing proof that a non-SVG consumer of that
geometry works — ADR 0010 extracted `walls.ts` for exactly this reason, for one slice of it.

**And that pass is already clean of ink.** There is not one `theme.` reference between the top of
`renderRegion` and the end of pass 1. The rule this ADR proposes for deciding what belongs in a
scene is a rule the resolve pass already keeps, unenforced and by construction, which is why
hoisting it is an extraction rather than a disentangling.

So the question is not whether the renderer can produce a resolved scene. It produces one per
render and discards it.

## Decision

**`@chartdown/render-svg` gains `resolveScene(doc, options): SceneResult`, and `render()` is
refactored to consume it.** One resolution pass, two views — ADR 0010's "one wall truth, two views",
generalised from walls to the whole sheet. The alternative shape, a second pass that re-derives, is
the drift that ADR rejected outright.

**What the scene carries is decided by ADR 0037's split, and that rule is the whole membership
test:** anything that decides where the land is, is in the scene; anything that is ink laid on top
is not. So the scene carries geometry and identity, and carries no stroke widths, no font sizes,
no ADR 0035 legibility floor, no zone insets and no glyph scatter. Those are the host's theme
engine's business, and the theme *document* is already the interchange format for them.

- **Geometry is in map units** — the `extent:`'s own units on a region, cells on a battlemap, hex
  radii on a hexcrawl. Not canvas units. A canvas number moves with `detail: overview | reference`
  (ADR 0020: 820 → 1640), and ADR 0037 forbids a rendering choice from moving geometry. The
  internal `Resolved` is in canvas units because `toXY` applies `scale`; the export divides it back
  out, which is exact, and is the same conversion ADR 0037's regression test already asserts across
  a 20× extent sweep.
- **Geometry is what is drawn, after organic finishing** — the outline the coast has, not the
  outline the document declared. A host's coast therefore agrees with this renderer's coast on the
  same document, which is the point; exporting the declaration instead would leave every host to
  re-implement ADR 0025's texture and disagree in its own way.
- **Each feature carries its identity**: anchor (explicit id, else display-name slug, else
  `@anon-<line>`, matching `entityAnchor`), source line, section, level, type word, derivation
  chain, archetype, flags, pairs, and vocabulary facets resolved along the chain with the entity's
  own pairs winning (spec 06 §2). That is what lets a host apply its own theme through the same
  fallback chain this renderer uses, and honour the same `player`/`gm` redaction rather than
  inventing a second one.
- **A half-plane resolves to a polygon, clipped to the map field.** Where the water is, is where
  the land is not; that is geometry, and on a region it is the one piece of geometry currently
  computed at emit time. `halfPlanePolygon` moves into the resolve pass.

  **The battlemap needs no equivalent move, and the reason is a useful illustration of the
  membership test.** A battlemap has two half-plane shapes. Which cells the terrain occupies comes
  from `surfaceCells` and `halfPlaneCells` in `grid.ts` — already pure, already in cell units, and
  already shared with `walls.ts` and `lints.ts`. That is the geometry, and it is where a scene
  reads it. `battlemap.ts`'s `halfPlaneArea` is a different shape for a different job: it is built
  from the *drawn* course, extended past the terminal cells' centres on purpose so the fill meets
  the band it hides under (#145), and its only consumers are a `terrainFill` polygon and a hatch
  overlay. It does not decide where the terrain is; it decides how the terrain is painted. So it
  is ink by ADR 0037's own test, and it stays at emit.
- **All three map kinds, one export.** ADR 0038 makes a placement form mean the same thing on every
  map kind, and a scene that existed for one kind would invite a second export for the next.
- **A multi-level battlemap resolves to one scene carrying every level.** `SceneResult` holds
  `levels: string[]` and each feature is tagged with its own `level`; `options.level` narrows,
  mirroring `RenderOptions`. Geometry stays in cell units per level, because the panel-stacking
  translate `render()` applies is canvas layout and ADR 0037 keeps layout out of the scene. This is
  the one place the two existing precedents disagree — `render()` stacks every level,
  `exportUvtt` exports one, because UVTT is one map per file — so it is decided rather than
  inherited: a scene is what a host draws *from*, and a host asking about a three-floor keep should
  not have to learn the level names elsewhere first. Exporting a single level stays available, which
  makes the UVTT shape a subset of this one rather than a rival to it.
- **v1 carries label anchors and `[labels]` overrides, not placed labels.** Arbitration stays
  internal. It is interleaved with SVG emission across roughly 1,400 lines of `region.ts` and the
  placer is stateful, so hoisting it is a separate change with its own risk, and this ADR would be
  deciding two things at once. Named as a follow-up rather than left implicit.
- **The schema is versioned with the package, and `SPEC_VERSION` is untouched.** A renderer output
  is not language. The spec gets a non-normative pointer where UVTT's mapping sits, because a
  reader looking for "what can I consume" should find both in one place, but the normative home is
  `render-svg`'s own README and a JSON schema beside it.
- **The determinism contract is inherited unchanged, and `detail:` is one of its inputs**: the
  scene is a pure function of (document, seed, renderer version, mode, **`detail:`**),
  snapshot-tested the way the SVG is. The existing render snapshots are the acceptance test for
  the refactor — byte-identical SVG, or the refactor is wrong.

  The `detail:` term is not a hedge, and it was measured rather than assumed. **Organic
  finishing is canvas-resolution-dependent today**: `organicOutline` skips an edge shorter than
  `QUANTUM` — 0.01 of a *canvas* pixel — and the control course it textures is sampled at canvas
  resolution, so the same document at `detail: reference` yields a denser and differently
  textured coast. On `examples/vessany`, `coast` resolves to **400 vertices at `overview` and 665
  at `reference`**, with individual points up to **20 map units** apart; on
  `examples/sundered-reach` the worst is 33. So dividing `scale` back out gives geometry in the
  author's units, exactly, but it does not make the outline independent of the canvas it was
  finished for — because *what is drawn* is not.

  That is a consequence of choosing drawn geometry over declared geometry, which this ADR does
  choose and for good reason. It is stated here rather than discovered by a consumer, because a
  host caching a scene from one `detail:` and drawing it beside another renderer's would
  otherwise be debugging a coastline mismatch with no reason to suspect a header it never set.

A worked example, a region settlement and a battlemap room, elided to the fields that carry the
argument:

```json
{
  "mapType": "region",
  "unit": "mi",
  "extent": { "w": 200, "h": 150 },
  "features": [
    {
      "anchor": "tharbad", "line": 31, "section": "settlements", "word": "city",
      "archetype": "feature", "chain": ["city", "settlement"],
      "geometry": { "kind": "point", "at": { "x": 88.4, "y": 61.2 } },
      "label": { "anchor": { "x": 88.4, "y": 61.2 }, "text": "Tharbad" }
    },
    {
      "anchor": "the-gwathlo", "line": 12, "section": "water", "word": "river",
      "archetype": "path", "chain": ["river", "water"],
      "geometry": { "kind": "polyline", "points": [ [12.0, 30.5], "…" ], "width": 0.4 }
    },
    {
      "anchor": "belegaer", "line": 8, "section": "water", "word": "sea",
      "archetype": "terrain", "chain": ["sea", "water"],
      "geometry": { "kind": "polygon", "points": [ "…" ], "from": { "halfPlane": "west", "of": "the-coast" } }
    }
  ]
}
```

`from` is stated because a host that draws the polygon should still be able to say *why* it is that
shape — the same reason `resolvedNotes` exists on the model today.

## Alternatives considered

**Do nothing.** Every native host re-derives resolution from the AST, and stops where this one did.
The cost is not hypothetical and it is not this host's alone: it is one implementation of ADR 0025,
0027 and 0031 per host, each free to disagree, on a language whose spec says a wrong answer must be
refused rather than guessed.

**Have hosts composite the SVG.** Honest, cheap, available today, and it works — it is the other
exit this host considered. It costs the host its own ink, which for a native renderer is the reason
it exists, and an SVG is not queryable: hit-testing a settlement means parsing back out what was
just serialised. Worth recording because for many hosts it *is* the right answer, and this ADR does
not claim otherwise.

**A separate `@chartdown/scene` package.** Rejected for ADR 0010's reason, unchanged: the scene's
substance *is* renderer geometry, so separating them reintroduces the drift a shared pass exists to
prevent, for no consumer who wants a scene without a renderer.

**Export the internal `Resolved` verbatim.** The cheapest possible change, and wrong twice. It is in
canvas units, so a consumer's geometry would move when `detail:` changed — exactly what ADR 0037
forbids. And it makes an internal shape public, so every morphology fix becomes a contract change.
The schema in this ADR is deliberately *not* `Resolved`: it is what a consumer needs, which is a
smaller and more stable set than what the resolve pass happens to hold.

**Export declared geometry and document the finishing algorithm.** A stable schema, and it hands
every host the job ADR 0025 already settled once. Two implementations of texture is two coastlines
for one document.

**Include placed labels in v1.** It is what a pixel-faithful host needs, and it is the larger half
of the work: placement is interleaved with emission and the placer carries state. Deferred, not
dismissed — with the consequence stated below rather than hidden.

**One scene per level on a battlemap.** `exportUvtt`'s shape, and it has the better precedent for a
non-SVG export. Rejected because UVTT's reason for it is a property of UVTT — one map per file —
rather than a property of scenes, and a host that has to enumerate levels before it can ask for
them has been handed a discovery problem the renderer already solved.

**A fork that patches the resolve pass to emit its scene.** Genuinely available to the host that
wants this: `render-svg` is plain JavaScript and that host already runs `@chartdown/core` in
JavaScriptCore. Rejected as a *proposal* because it is a private patch against a moving 3,095-line
file, which is drift with extra steps. Recorded because it is what happens if this is declined, and
an ADR that pretends the alternative is nothing is not being honest about its own stakes.

## Consequences

**What becomes easier.** A native host draws this renderer's geometry with its own ink, so the two
agree on where the land is and differ only where they are supposed to. `exportUvtt` stops
re-deriving lights, cell centres and grid conversion — it does today, beside the `walls.ts` call
that ADR 0010 extracted precisely so it would not have to — and becomes a transform of the scene,
which is what its own header comment already claims it is. That rewrite is *not* in this change;
what lands here is the thing that makes it a mapping question instead of a re-derivation.
`@chartdown/mcp` can answer *"what is at (x, y)"* instead of returning an SVG for a model to read.
The dead-declaration lint (#116) gains a real read model, since "was this property read" is a
question about the scene.

**What becomes harder, and what accepting this rests on.** A published schema is a contract, so a
morphology change now has an audience. That is the freeze ADR 0010 accepted for `walls.ts`, applied
to a much wider surface, and it is the true cost of this ADR: the number of decisions that are cheap
to revise goes down.

This was the one question in the proposal that design work could not settle, and it was ruled **of
minimal concern relative to the benefit** — on the reasoning that a language whose spec refuses a
wrong answer rather than guessing at one should not leave every host to guess at its coastlines. So
the record is precise about what was accepted: **not that the freeze is cheap, but that it is worth
paying.** If a morphology change later feels blocked by consumers, that is this cost being paid on
schedule, not a surprise and not grounds on its own to reopen the decision. The mitigation is that
the schema is versioned with the package and is explicitly not `Resolved`, so internal refactors
stay internal — but a change to *what a coast is* is now visible to consumers, and that was the
trade.

**This is additive, and additive is not breaking.** `CONTRIBUTING.md`'s third clause — *"a shipped
tool changes a default or a contract"* — is **displacement, not addition**: a new export changes no
default, moves no caller, and stops nothing that worked from working. It goes under `### Added`, and
the release it lands in is a minor for the ordinary reason rather than for this one. That
clarification was made on #355 and this is the first ADR it applies to; [ADR
0041](0041-breaking-means-a-clean-document-stops-checking-clean.md) carries the worked table the
clause belongs to.

`render()` gets a refactor whose only acceptance test is that its output does not change; the
existing snapshots make that testable rather than hopeful, which is the sole reason this is
proposable at all. Half-plane clipping moves from the emit pass into the resolve pass — at both the
region and battlemap sites — and that is a real behaviour change to review rather than a move.

**What this does not buy, stated plainly.** With labels excluded, a consuming host still places its
own — so this export makes a *correct* host possible, not a pixel-faithful one. Two maps rendered
from the same document by two implementations will put the same things in the same places and label
them differently. That is a smaller and more honest gap than the one it replaces, and closing it is
a second ADR, not a footnote to this one.
