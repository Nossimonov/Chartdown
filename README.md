# Chartdown

**A plain-text, Markdown-inspired syntax for describing maps and charts — rendered into visuals.**

Chartdown aims to do for maps what Markdown did for documents and what Mermaid did for diagrams: let you *write* a map as readable text, keep it in version control, diff it, and render it anywhere. The initial version targets tabletop roleplaying games:

- **Fantasy maps** — regions, kingdoms, coastlines, roads, points of interest
- **Charts** — hex-based overland/travel charts, nautical charts
- **Battlemaps** — gridded tactical scenes with terrain, walls, doors, and tokens

## Why plain text?

- **Versionable** — a map lives in your campaign repo next to your session notes, and `git diff` shows exactly what changed.
- **Composable** — embed a battlemap in your prep notes the same way you embed a code block.
- **Crosslinked** — named map entities are addressable, so your prose can link to *the old bridge* on the map, and supporting renderers can link a clicked location back to its description.
- **Fast to author** — sketch an encounter map in seconds without opening a graphical editor.
- **Portable** — one source document, many renderers (SVG for the web, print-friendly output, VTT import someday).

## What might it look like?

> ⚠️ **Illustrative only.** The syntax below is a sketch to communicate the vision — it is **not** the spec. The actual syntax is being designed in the open via [syntax proposals](CONTRIBUTING.md#syntax-proposals). See [docs/spec/](docs/spec/) for the current state of the specification.

```chartdown
# Ambush at Redford Crossing
grid: square 20x15

[terrain]
river   : path (0,8) (7,8) (9,7) (19,7) width=2
forest  : area (0,0)..(6,5)
bridge  : rect (8,7)..(9,9)

[features]
wagon (overturned) : (10,8)
campfire           : (12,10)

[tokens]
@goblin  g1..g4 : (3,4) (5,2) (4,6) (6,3)
@pc      Aria   : (14,8)
@pc      Bram   : (15,9)
```

…rendering to a gridded battlemap with terrain, features, and labeled tokens.

## Project status

**Pre-spec / design phase.** Nothing is implemented yet. Right now the work is:

1. Studying prior art and defining precise use cases
2. Writing example documents *first* — the maps we wish we could write — and letting the syntax fall out of them
3. Drafting the v0.1 specification
4. Building a reference parser and SVG renderer

See the [roadmap](docs/roadmap.md) for the full plan and the [issue tracker](https://github.com/Nossimonov/Chartdown/issues) for what's in flight.

## Repository layout

| Path | Purpose |
|---|---|
| [docs/vision.md](docs/vision.md) | Goals, non-goals, and success criteria |
| [docs/roadmap.md](docs/roadmap.md) | Phased plan from vision to working renderer |
| [docs/spec/](docs/spec/) | The Chartdown language specification (drafts live here) |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records — why things are the way they are |
| [examples/](examples/) | Example Chartdown documents, written spec-first |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Issue-tracking rules and the syntax-proposal process |

## Contributing

This project runs **issue-first and spec-first** — see [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. Syntax ideas are especially welcome as [syntax proposal issues](CONTRIBUTING.md#syntax-proposals).

## License

[MIT](LICENSE), with one carve-out: the language specification in [docs/spec/](docs/spec/) is [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), so anyone can implement or republish the spec with attribution. Rationale in [ADR 0001](docs/decisions/0001-mit-code-cc-by-spec.md).
