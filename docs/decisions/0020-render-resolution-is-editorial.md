# 0020 — Render resolution is an editorial choice

**Status: Accepted** (owner, 2026-07-25). Arising from [#139](https://github.com/Nossimonov/Chartdown/issues/139).

## Context

Region maps rendered onto a canvas hard-coded to 820 units wide. Every other number in the renderer — font sizes, marker radii, line corridors, the legibility floor — is absolute against that fixed frame, so the canvas silently set the information budget for every map regardless of how much the map had to say.

Two consequences, both self-inflicted:

- The output was far smaller than the form it imitates. Christopher Tolkien's *West of Middle-earth* is 3840×2931; Chartdown rendered the same territory at 820×726, holding the same 87 names in about 5% of the area.
- **We committed to a single zoom level in a format designed not to.** SVG renders losslessly at any magnification, and a reader of a large regional map expects to zoom for feature detail. Instead the renderer resolved all label pressure as though the map would only ever be seen fit-to-width, discarding information — shrinking names, displacing them, drawing leaders — to win a competition that exists at one zoom only.

This is also why [#132](https://github.com/Nossimonov/Chartdown/issues/132)'s scale-aware legibility floor had nothing to act on: expressed as a fraction of the canvas, correctly, it evaluated to one constant forever because the canvas never varied.

Measured on `middle-earth-v3.cd`, changing only the canvas width:

| canvas | labels on their course | labels forced below 10px |
|---|---|---|
| 820 | 21 | 42 |
| 1200 | 25 | 27 |
| **1640** | **27** | **13** |
| 2460 | 27 | 10 |
| 3280 | 28 | 7 |

## Decision

**Render resolution is chosen by the author, not fixed by the renderer.** A new header key `detail:` takes a closed set:

- `overview` (default) — today's canvas. Readable at a glance; the right choice for a map meant to be taken in whole.
- `reference` — twice the canvas. Keeps fine detail for a reader who will zoom; the right choice for a map meant to be studied.

`overview` remains the default so that no existing document re-renders.

## Consequences

The trade is real in both directions and cannot be optimised away: font sizes are absolute, so a larger canvas means proportionally smaller text when the whole map is shown at once. That is correct for a reference map and wrong for an overview, which is exactly why it belongs to the author rather than to a constant.

`reference` is 2× because that is where the measured returns flatten — 1640 and 2460 place the same number of line labels, and 3280 buys one more for four times the coordinate precision.

The key is inert on battlemaps and hexcrawls, whose canvas derives from their grid, so using it there **warns** rather than doing nothing quietly. An inert key that parses clean is the failure this phase spent its length removing (#126, #131, #135, #136).

**Alternatives rejected:**

- **Raise the constant for everyone.** Silently shrinks the apparent text of every existing map, including small ones that were never crowded. It is the right behaviour only for dense maps, which is the definition of a per-document choice.
- **Scale the canvas with `extent:`.** Appealing, and wrong: extent is territory, not information density. A sparse continent would get a canvas it does not need and a dense city-state one it does.
- **Scale with entity or label count.** Closest to the real driver and the least predictable — the same document would re-scale as the author adds names, moving every coordinate in the output and destroying diffability.
- **Emit a large canvas but pin display size.** Bakes a presentation decision into the document. Embedders already control size with CSS.

**Reversal condition:** if font sizes ever become relative to the canvas rather than absolute, the trade this ADR balances disappears and the key loses its purpose.
