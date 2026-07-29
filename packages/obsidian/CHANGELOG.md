# Changelog — Chartdown for Obsidian

The plugin versions on its own lane; the renderer it embeds versions with the [Chartdown language](https://github.com/Nossimonov/Chartdown/blob/main/CHANGELOG.md). Most releases here are the renderer moving underneath.

## [0.2.0] — 2026-07-29

**Your existing maps will redraw.** This is a minor bump rather than a patch for exactly that reason: the plugin's own behaviour is unchanged, but the renderer inside it goes from **0.2 to 0.4** — two releases of the language, including deliberate changes to drawn geometry.

### What moves in your notes

- **Every coastline shifts by half its stroke width.** A stroke centred on a boundary put half its ink on each side, which filled narrow channels; ink now sits on one side, clipped to the region that owns it.
- **Every organically-finished outline moves** — shaped woods, marshes, islands drawn from an `area`. The texture that makes them read as drawn rather than surveyed used to depend on the canvas size, so the same document drew a different shape at a different `extent:`. It no longer does.
- **A staging zone is now spelled `start`** — `start party : J14..L15`. The old token-word-plus-area form is an error naming the fix.
- **A battlemap feature placed with `area` is now an error** rather than drawing nothing in silence. Give it a cell (`F6`) or a range (`D4..F6`).

If a map looks different after updating, that is why, and it is deliberate. Nothing about your source changed meaning except the two spellings above.

### What is new to draw with

- **Placed morphology**: capes, bays, coves, fjords, islands as discrete named features on a smooth coast, each able to declare its own centerline or outline.
- **Every declared state is drawn**: a locked, barred, stuck or ruined door reads differently; a difficult pit is hatched; an erupting volcano has a plume.
- **A path's ends reach the edges of its terminal cells**, so a road running to a wall meets it instead of stopping mid-square.
- **Coherence lints** — six checks that catch a door onto nothing, an unsupported structure, an unreachable room, terrain crossing a wall.
- **Dead-declaration warnings** for themes and vocabulary: a line that styles nothing now says so.
- **Themes** can restyle openings, barriers, paths, zones and structure perimeters, which they could not before.

The full detail is in the [language changelog](https://github.com/Nossimonov/Chartdown/blob/main/CHANGELOG.md).

## [0.1.12] and earlier

See the [releases page](https://github.com/Nossimonov/obsidian-chartdown/releases).
