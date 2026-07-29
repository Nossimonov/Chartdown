# @chartdown/measure

Turn georeferenced imagery into [Chartdown](https://github.com/Nossimonov/Chartdown) declarations — so a traced coastline is **data a story can attach to**, not a wall of coordinates.

```sh
GEO="--origin 48.65,-123.75 \
     --georef 1146,2052=47.2690,-122.5517 \
     --georef 1046,478=48.4061,-122.6433 \
     --georef 202,838=48.1490,-123.5670"

npx @chartdown/measure inspect sea.png --invert $GEO
npx @chartdown/measure feature sea.png --invert --mouth 1255,1361 --into 1094,1646 --word cove --id sinclair $GEO
npx @chartdown/measure coast   sea.png --invert --from "68,0mi" --to "0,32.1mi" --id shore $GEO
npx @chartdown/measure island  sea.png --invert --inside 793,2126 --id squaxin $GEO
```

Each verb prints a declaration you can paste into a document, with its assumptions above it as `;` comments.

## The verbs

- **`inspect`** — what the tool sees before it measures anything: the classification it chose, how much of the frame is water, and the georeference it fitted, including **the transform itself** and how far each landmark missed. Run it first; a bad georeference is invisible afterwards.
- **`feature`** — one inlet, from a mouth and a point inside it. Emits `size=`, `taper=`, and a `via` centerline carrying the channel's width at each control.
- **`coast`** — a coastline with the inlets you intend to *declare* removed, so the shore and the features on it are not drawn twice.
- **`island`** — one island's outline from a point inside it, framed as offsets from its anchor.

## What it promises

**A measurement emits a line that draws.** The output is checked the way the renderer will check it — splined with the renderer's own implementation, not a second copy — because two implementations is how a measurement comes to certify a line the renderer then refuses ([ADR 0032](https://github.com/Nossimonov/Chartdown/blob/main/docs/decisions/0032-a-measurement-emits-a-line-that-draws.md)).

**It says what it consumed, not only what it produced.** A verb that removes water says how much; a mouth says what share of the sea it enclosed. A control count looks equally reasonable for a good spine and for a deleted one ([ADR 0036](https://github.com/Nossimonov/Chartdown/blob/main/docs/decisions/0036-a-measurement-reports-what-it-removed.md)).

**It refuses rather than guesses.** A point in water, a point on the mainland, an image too coarse to resolve the island — each is reported with the number you need to fix it in one edit, not measured around.

PNG only, and zero runtime dependencies ([ADR 0029](https://github.com/Nossimonov/Chartdown/blob/main/docs/decisions/0029-a-shipped-dependency-is-ours-to-answer-for.md)).

## More

The [specification](https://github.com/Nossimonov/Chartdown/tree/main/docs/spec) is the source of truth; [ADR 0028](https://github.com/Nossimonov/Chartdown/blob/main/docs/decisions/0028-measurement-is-an-optional-package-in-typescript.md) explains why measurement is an optional package rather than part of the language. Try Chartdown itself in the [playground](https://nossimonov.github.io/Chartdown/).

MIT.
