# Vision

## One sentence

Chartdown is a plain-text syntax that lets tabletop gamers (and eventually anyone) describe maps and charts as readable, diffable documents that render into useful visuals.

## The problem

Maps for tabletop RPGs are made in graphical editors (Inkarnate, Dungeondraft, Wonderdraft, Dungeon Scrawl) or improvised on grid paper. These outputs:

- can't be meaningfully version-controlled (binary blobs or proprietary formats),
- can't be embedded in prep notes, wikis, or Markdown documents as source,
- are slow to produce when you just need "a river, a bridge, six goblins" before Tuesday's session,
- lock content into one tool's ecosystem.

Markdown solved this for prose. Mermaid solved it for flowcharts. Nothing has solved it for spatial content — maps are harder because they are *positional and continuous*, not purely relational like a flowchart.

## Target users (v1)

1. **The prepping GM** — writes session notes in Markdown (often Obsidian or a git repo) and wants encounter maps inline with those notes.
2. **The worldbuilder** — maintains a campaign setting over years and wants region maps that evolve in version control alongside the lore.
3. **The publisher/homebrewer** — writes adventures for others and wants maps that readers can render, restyle, and modify.

## Guiding principles

1. **Readable source.** A Chartdown document should communicate the map to a human *even without rendering*. If the text isn't skimmable, the syntax is wrong.
2. **Examples before grammar.** We write the documents we wish we could write ([examples/](../examples/)), then design syntax to make them valid. The grammar serves the examples, never the reverse.
3. **Progressive complexity.** A five-line document must produce a usable map. Detail (styling, precise geometry, layers) is opt-in, never required.
4. **Semantic, not pixel-perfect.** Authors declare *what things are* (a river, a door, a goblin); renderers decide how they look. Themes and styles are separated from content, like CSS from HTML.
5. **Plays well with Markdown.** Chartdown should work as a fenced code block inside ordinary Markdown, the way Mermaid does, as well as a standalone file. This is a hard requirement, not a nice-to-have: the primary authoring context is a Markdown document (session notes, a wiki page, an adventure) with maps embedded in its body.
6. **Entities are addressable.** Every named thing on a map (a settlement, a room, a token) has a stable identity that text can link to. Surrounding Markdown prose should be able to link *to* a map location ("the party crosses [the old bridge](#bridge)"), and supporting renderers should be able to link *back* — clicking a location pulls up its associated description. The syntax must provide the anchors even though the interactivity is renderer-dependent.

## Non-goals (v1)

- **Not a graphical editor.** Rendering only; WYSIWYG editing is out of scope (a future ecosystem tool at best).
- **Not artistic cartography.** We compete with grid paper and whiteboards, not with Inkarnate's hand-painted aesthetics.
- **Not a VTT.** No game logic, no fog of war, no dice. (Exporting *to* VTT formats is a plausible future goal.)
- **Not real-world GIS.** No projections, no lat/long, no GeoJSON semantics.

## Success criteria

The project has succeeded when:

1. A GM can author a usable battlemap in under five minutes with no prior tool experience beyond reading one example.
2. The three map types (fantasy/region map, hex chart, battlemap) each have a spec'd syntax with rendered examples.
3. A reference implementation parses any valid v0.1 document and renders deterministic SVG.
4. A Chartdown block inside a Markdown document renders in at least one real environment (e.g. a live playground, an Obsidian plugin, or a remark/markdown-it plugin).
5. Two documents diffed in git produce a diff a human can read as "the bridge moved and two goblins were added."
6. A Markdown document can link to a named entity on an embedded map, and at least one supporting renderer resolves clicks on map entities back to their prose descriptions.
