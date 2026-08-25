# Changelog — Chartdown for Obsidian

The plugin versions on its own lane; the renderer it embeds versions with the [Chartdown language](https://github.com/Nossimonov/Chartdown/blob/main/CHANGELOG.md). Most releases here are the renderer moving underneath.

## [0.5.0] - 2026-08-25

Carries the Chartdown 0.7.0 renderer. Most of this release is about secrets — three separate ways a hidden thing could reach a player's screen anyway, all of which showed up in a note rendered in this plugin.

### Your secrets stay on your side of the screen

A stair marked `hidden` no longer appears on the player view. It was being stripped correctly and then drawn back in: the floor below announced a landing into the square the strip had just emptied, so a trapdoor you had deliberately concealed was published one loop later, in the same render.

Marking the *far* end `hidden` used to do nothing at all, silently. It now spells a one-sided secret — hidden from above, an ordinary stair from below — which is what a priest-hole or a smuggler's cellar actually is.

And a room whose only way in is a secret door no longer reports that nothing can reach it. That warning appeared on the player view by default, could not be turned off, and the one edit that cleared it was the edit that destroyed the secret.

The new **Greyhallow Chapel** example is built out of all three, if you want to see them side by side: open it, switch between GM and player, and the player sheet shows no way down at all.

### A map that cannot be drawn tells you why

A corner-placed wall or door used to break the render outright. In a note that meant a dead pane with nothing to read. The map now reports the problem in the warnings list, on the line that wrote it, with the renderer's own explanation beneath it.

### Better-looking water, and better labels underground

Where two rivers meet they now merge, instead of each laying its bank across the other's water. On a multi-level map, a stair's annotation names the **next** floor it reaches rather than the far end of the shaft, so a three-storey stairwell reads correctly on every panel.

### Two things that may light up an existing note

Both are deliberate, and both are cases where a document was quietly not doing what it said:

- A cell address such as `C4` on a **region** map is now an error. It never drew anything; it was silently discarded, so the feature you wrote simply was not there.
- A quoted file path in `inset:` is now read as a path rather than as text-with-quotes, so a sub-map seam that was being skipped is now actually checked. Documents whose seams disagreed will say so.

## [0.4.0] — 2026-08-08

### You can get closer to a map

Ctrl/⌘ + scroll over a map zooms about the cursor; drag to pan; the toolbar gains **+ / − / Fit**. A bare scroll still scrolls the note past the map, rather than trapping it.

This is the first release where zooming is worth doing. Narrowing the view used to magnify the linework along with the land, so a closer look gave you a bigger picture and nothing else — the coastline over a narrow channel drew 2px at ×4 and 32px at ×64. The ink now holds the width it had when the map was fitted, so the geometry grows and the drawing stays crisp. Your position survives a re-render, so editing a `.cd` file does not throw you back to the whole map while you are checking a number you zoomed in for.

### A secret door stays secret

`hidden` was honoured on an ordinary line and **dropped on a structure detail**, so this drew the door on the players' map:

```chartdown
building cellar : A1..B2
  door : at B2.s hidden
```

Written one indentation further out it was withheld correctly. Nothing reported the difference. If you keep secrets in a note you hand to your table, this is the release to be on.

### The renderer underneath is Chartdown 0.6.0

The plugin versions on its own lane, and this jump to 0.4.0 marks the minor version behind it. Most of what you will notice comes from there: an ambient `light:` no longer washes over the map's own title and coordinates, a lamp on one level no longer lights the floor above it, and a theme's `ink : fill=` now reaches the title, compass, scale bar and coordinate letters instead of stopping at the map.

Chartdown 0.6.0 also refuses four things it used to accept in silence — a bare archetype word, a structure detail the slot cannot take, an address form nothing consumes, and an unchecked hex ledger line. **A document that rendered before may now report an error in your note.** In every case the map you were getting was not the map you asked for; the [Chartdown 0.6.0 notes](https://github.com/Nossimonov/Chartdown/blob/main/CHANGELOG.md) say what each one was.

## [0.3.1] — 2026-08-04

**Nothing about the plugin changes.** The bundle is byte-identical to 0.3.0's apart from one stylesheet fix; if you are on 0.3.0 there is nothing here for you.

It exists because the community-store scan caches its result per version, and 0.3.0's scan failed on two things that had nothing to do with the plugin's behaviour: this repository's lockfile had fallen behind the `@chartdown` pins the release rewrites, so the scan could not install and reported every import as untyped — and `styles.css` carried a stray closing brace, which browsers recover from and a linter rightly does not.

Both are fixed, and the release workflow now updates the lockfile alongside the pins so the pair cannot drift again.

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
