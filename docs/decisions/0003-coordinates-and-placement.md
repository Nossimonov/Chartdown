# 0003 — Chess-style addresses on every grid; a closed relational grammar; live, order-bounded, fail-loud anchor resolution

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #14 (spawned from #8)

## Context

Positions are the language's core content, and the accumulated constraints all met here: two hex content models needing one addressing scheme (cell-content hexcrawls vs geometry-on-grid battlemaps), industry hex interop requiring explicit orientation and offset parity, the prior-art finding that discrete addresses beat raw floats in plain text, the region map's need for relational placement versus the pseudo-English (AppleScript) trap, and the reflow failure mode identified in review: vague anchors have finite capacity, so a renderer that "makes room" mutates an incrementally-grown map.

The original proposal used chess-style addresses for square grids and digit-pair (`0203`) for hexes. The project owner rejected the asymmetry: visually distinguishing grid families did not justify two systems.

## Decision

Spec section [02-coordinates-and-grids.md](../spec/02-coordinates-and-grids.md), summarized:

- **One address form on every grid**: column letters + row number (`K11`, `C4`), spreadsheet-style past `Z`. Ranges `A11..F15`; hex headers must declare orientation and offset parity.
- **Edges/corners as single tokens** (`O6.s`, `K5.nw`) — Mipui's walls-on-edges model, lossless to UVTT polylines.
- **Gridless points** `(x,y)` in declared extent units, origin northwest, written coarsely.
- **Relational placement only via a closed grammar** (`at/on/near/of/from/via/to/along/edge` in nine fixed forms). Mountain-specific phrasing like `crest of` is vocabulary, not grammar, and did not survive.
- **Resolution is order-bounded, deterministic (seeded), fail-loud, and live**: forward references are errors; appends never move anything; exhausted anchors are author-facing errors, never renderer relocation; deliberate upstream edits ripple downstream by design. The documented mitigation for moved/destroyed anchors is the **remnant landmark** pattern (leave `ruin "Former site of X"` behind; anchor dependents to it).
- `[hexes]` accepts both ledger form (`C4 forest`, canonical, tool-emitted) and grouped form (`forest : C4 D3 D4`, human sugar).

## Alternatives considered

- **Digit-pair hex addresses (`0203`)** — Text Mapper/wargame convention, fixed-width ledger alignment; rejected as the asymmetric half of a two-system scheme, and the digit wall was the reviewed cause of ledger unreadability. Text Mapper migration remains mechanical (a converter renumbers).
- **`(x,y)` numeric cells** — symmetric with gridless points but not table-speakable and collides visually with world-unit coordinates.
- **Axial/cube hex coordinates** — mathematically superior, hostile to humans; stays an internal representation.
- **Free-form relational prose** — the AppleScript trap; rejected in review.
- **Frozen/baked anchor positions (lockfile)** — kills upstream ripple but adds a generated artifact and lets anchor phrases drift from rendered truth. Deferred, not rejected; live + order-bounded + remnant pattern is the bet.

## Consequences

- Battlemaps, hexcrawls, and hex battlemaps share one learnable addressing scheme; the Brenmark example re-rendered from digit-pair to letters.
- Verbatim Text Mapper syntax compatibility is gone; compatibility is now via mechanical conversion, honoring the original use-case requirement ("migration is mechanical").
- The closed relational grammar means new spatial phrasings require spec changes — friction by design, protecting parseability and the agent-ingestion story.
- Live anchoring makes upstream edits ripple; authors of history-heavy maps must learn the remnant-landmark pattern, which the spec teaches in place.
- `.` after an address and `(x,y)` tokens join the reserved lexical inventory.
