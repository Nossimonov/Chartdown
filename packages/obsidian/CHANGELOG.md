# Changelog — Chartdown for Obsidian

The plugin versions on its own lane; the renderer it embeds versions with the [Chartdown language](https://github.com/Nossimonov/Chartdown/blob/main/CHANGELOG.md). Most releases here are the renderer moving underneath.

## [0.3.0] — 2026-08-02

### Your notes will start showing warnings

They always existed; this plugin was throwing them away. Only errors reached a note, so the whole of Chartdown's coherence checking was invisible here — a river running through a wall with no door, a room nothing can reach, a structure standing on nothing. Every other way of running Chartdown reported them; a note rendered the map and looked finished.

Warnings now appear beneath the map in their own colour. An error means the map is wrong; a warning means it may not be what you meant.

**If a map you have had for months suddenly shows a warning, nothing changed about your map.** The check was always failing and you were never told.

### A fence can import a file beside it

`use: ./my-vocabulary.cd` now resolves against your vault, so a shared vocabulary can live in its own file instead of being repeated in every note — and a `.cd` file opened as a file does the same. `inset:` parents resolve too.

A path that does not resolve says so rather than rendering quietly without it.

### `.cd` files open to their map

Keep a map as its own file, not only as a fence inside a note. Opening a `.cd` file shows the rendered map with the same toolbar you get in a note — GM/player toggle, SVG and UVTT export, the copy/paste source round trip — and a **Source** button swaps to the text, editable in place.

Exports take the file's own name, so `sunless-hollow.cd` writes `sunless-hollow.svg` beside the source it came from.

Before this the plugin registered only the markdown code-block processor, so it handled a fence inside a note and nothing else: no view claimed the extension, and a `.cd` file in a vault could not be opened at all.

**While the plugin is enabled it claims the `.cd` extension for the vault.** Disable it and those files go back to being unopenable, since nothing else knows what they are.

## [0.2.1] — 2026-07-29

**Nothing about the plugin changes.** `main.js` is byte-identical to 0.2.0's — same renderer, same behaviour, same maps. If you are on 0.2.0 there is nothing here for you.

It exists so the community-store scan has a clean release to read. The repository's own `@chartdown` pins had drifted two minor versions behind the renderer that actually ships, and the plugin's test files were being published as though they were plugin source, so the scan reported a type error on an API that exists perfectly well upstream. Both are fixed, and the release workflow now keeps them in step so neither can drift again — but the scanner caches its result per version, so a clean read needs a new number.

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
