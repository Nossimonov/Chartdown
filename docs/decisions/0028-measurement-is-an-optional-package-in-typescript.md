# 0028 — Measurement is an optional TypeScript package, not a second language

- **Status:** Proposed
- **Date:** 2026-07-27
- **Issue:** [#181](https://github.com/Nossimonov/Chartdown/issues/181), [#188](https://github.com/Nossimonov/Chartdown/issues/188)

## Context

Chartdown asserts that a coastline's features can be *described* — that a fjord, a sound and a cove differ by `size=`, `reach=`, `taper=` and `via` rather than by traced coordinates. Six rounds of the Puget Sound exercise never tested that assertion, because nobody could supply real numbers: every declaration was written from recollection. What was rendered were **platonic ideals** — internally consistent, obedient to every rule the spec states, and resembling no actual inlet. The one time real geometry reached the map it arrived as `traced.cd`, 2137 vertices, with no Hood Canal in it and nothing that could take an id, a `gm=` note or a `detail=` sub-map.

So measurement is not an authoring convenience. It is the instrument that makes 0.4.0's central claim **falsifiable**, and its absence actively pushes an author toward the wall of coordinates [ADR 0023](0023-detail-is-data-not-noise.md) exists to eliminate. That settles *whether* to build it (#181, #188). It does not settle where it lives, and that question has to be answered before any code exists, because it is the kind of decision that is cheap now and expensive in a year.

The forces are in tension. [ADR 0007](0007-typescript-stack.md) makes the reference implementation a TypeScript npm monorepo and keeps `packages/core` and the renderer free of runtime dependencies. [ADR 0011](0011-mcp-server-runtime-deps.md) already established that an *optional* package may carry runtime dependencies while that rule binds the language core — so dependencies are not the open question. The open question is **language**: the working prototype is Python (`tools/trace.py`, `tools/measure_features.py`), and the image-processing ecosystem an author would reach for by reflex — numpy, scipy, scikit-image — is Python's.

## Decision

**Measurement ships as `@chartdown/measure`, a TypeScript package inside the existing monorepo, excluded from the zero-dependency rule exactly as `@chartdown/mcp` is.** It carries its own binary rather than adding a verb to `chartdown`, so a GM who never measures anything installs nothing extra and the main CLI stays dependency-free.

The Python prototype is treated as a **specification of the algorithm**, not as the thing to package.

The decisive point is that the scientific stack is a convenience here, not a necessity. What the pipeline in #181 actually requires is:

- per-pixel classification against thresholds — arithmetic over a typed array;
- a morphological close, to shut necks *before* labelling so a half-mile passage does not pinch off a whole arm — two passes of a small structuring element;
- connected components, to keep the sea — flood fill or union-find;
- a mouth cut and a flood, to isolate one inlet;
- a distance transform and boundary trace, to read depth, mouth width and a centerline off the result.

Each is tens of lines over a raw pixel buffer. None needs a linear-algebra library; `numpy` is being used for ergonomics and speed, not for capability. What genuinely needs a dependency is **decoding a PNG or JPEG into pixels**, which is one well-scoped library rather than a scientific stack.

Georeferencing is arithmetic on two or three landmark pairs, and its residual check — which MUST fail loudly, since the prototype's first fit was 15% wrong in silence — is a few lines.

**The shipped tool emits declarations and MUST NOT be able to emit a coastline.** #181 states this as guidance; it is a constraint here, because the failure has already happened once. A "trace the whole coast" mode, if it is ever built, is a comparison artefact that cannot be mistaken for a document.

## Alternatives considered

**A Python package on PyPI.** The prototype runs today and the ecosystem is the natural one. It loses on everything the project has to carry afterwards: a second toolchain, a second registry, a second CI lane, a second release process in `npm run bump`, and a GM who must install Python to author a map. It also splits the codebase's shared vocabulary — the geometry helpers, `XY`, the parser, `frame`'s framing logic — across a language boundary, and this tool's whole job is to emit Chartdown declarations, which the TypeScript side already knows how to construct and validate.

**A TypeScript package depending on a native imaging library** (`sharp` and similar). Fewer lines to write, and it drags a native build into a repo whose install is currently portable and trivial. Rejected as a default; a pure-JS decoder is enough for the image sizes involved, and a native fast path can be added later if it is ever the bottleneck.

**A verb on the main `chartdown` CLI.** Discoverable, and it would put image dependencies in the package every user installs to run `check`. Rejected: the tool is for authors working from imagery, which is a minority of a minority.

**Keep it as scripts in the exercise directory.** The status quo, and the reason nothing accumulates: each round rewrote them, so no two rounds' numbers were comparable and the tooling was never better than the last person's afternoon. That is precisely what made six rounds of measurement unrepeatable.

**Do nothing; authors use GIS.** Reasonable for a professional, and it does not solve the problem — the conversion from a shape into `size=`/`taper=`/`via` is Chartdown-specific, and that conversion is where every error was. It also does not close the loop for the automated testing that is doing the validating.

## Consequences

Everything stays in one language, one repo, one release. `@chartdown/measure` can import `@chartdown/core` directly to build and validate the declarations it emits, so a measured feature is checked by the same code that checks a written one. Reviewers read one stack.

The cost is real: the image work has to be written rather than imported, and a pure-JS pipeline over a large satellite image will be slower than numpy — seconds instead of milliseconds. That is acceptable for a tool run a handful of times per map, and it is the price of not splitting the project in half.

The heavier consequence is that this decision **admits pixels into the project's world** for the first time. Everything before it operated on declared coordinates. A classifier has thresholds, and thresholds are fitted to imagery — so this package will attract bug reports that are about somebody's picture rather than about Chartdown. That risk is contained by keeping the tool's output a *declaration a human reviews*, never a rendering path, and by making a poor georeference an error rather than a number in a log.

It also constrains the future: if measurement later needs something genuinely beyond hand-written array work — a proper skeletonisation, a segmentation model — this decision has to be revisited rather than stretched, and the honest form of that is a new ADR superseding this one.
