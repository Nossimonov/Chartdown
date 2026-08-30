# Greyhallow Chapel

**Status: spec-aligned** — valid under spec v0.7 (sections 01–08). Fulfills [#333](https://github.com/Nossimonov/Chartdown/issues/333): the corpus had no document whose only way in is a secret, so no committed example could express the class of defect that kept being found by hand.

## The scene

A parish chapel on a green, and everything worth having is behind something the congregation cannot see.

The nave is public — one door, two windows, benches, a font, candles at the altar. Off it, through a panel beside the altar, is **the Reliquary**: the saint's hand in a silver case, and the ledger naming who paid for the roof. It has no other door. Under a runner in the nave floor is a **trapdoor** down to the crypt, which the priests use daily and a stranger standing on it does not see; from below the same stair is plainly a stair, because there is nobody in the crypt to keep it from. And from the crypt a **bolt-hole** climbs to surface inside the Reliquary — one secret opening onto another, which Father Enno used the night the tithe went missing.

Father Enno knows both ways down. He will not speak of the second.

## What this map flexes

Three ways a secret can be spelled, which is the point of the document:

| spelling | here | what it exercises |
|---|---|---|
| a room whose **only** entrance is `hidden` | the Reliquary's panel, `door : I4.w hidden` | the coherence lints must read the **declared** model, or the room reports `unreachable-room` in player mode — [#320](https://github.com/Nossimonov/Chartdown/issues/320), [ADR 0045](../../docs/decisions/0045-a-redaction-is-not-the-document.md) |
| a **double declaration**, `hidden` above and plain below | the trapdoor at F8 / the crypt stair at F8 | a landing is suppressed by a **declaration**, not by a drawing — [#319](https://github.com/Nossimonov/Chartdown/issues/319), [ADR 0046](../../docs/decisions/0046-a-landing-is-suppressed-by-a-declaration-not-by-a-drawing.md) |
| a **lone** `hidden` connector, declared once | the bolt-hole, `to=chapel hidden` | a hidden connector projects a landing **nowhere**; the control that must render exactly as declaring nothing would |

Also here: two levels with `levels:`/`level:` and qualified sections, `[vocab]` derivations (`trapdoor : stairs`, `shaft : stairs`) so each connector kind is themable in its own right, an emitter (`candles altar : E3 light=15ft`), feature footprints (`bench : C5..C7`), a staging zone, and `[gm]` notes.

## The two renders are the assertion

`greyhallow-gm.svg` and `greyhallow.svg` are committed as a **pair**, and reading them side by side is the documentation:

| | chapel panel | crypt panel |
|---|---|---|
| **GM** | `▼ crypt` twice — the trapdoor, and where the bolt-hole surfaces | `▲ chapel` twice — the stair, and the bolt-hole |
| **player** | **nothing at all** | `▲ chapel` once — only the stair the crypt has no reason to hide |

The player sheet is the interesting one. Three separate mechanisms have to hold for it to stay empty: the trapdoor is stripped because it is `hidden`, the crypt stair's reciprocal landing is suppressed because a connector is *declared* at that cell, and the bolt-hole projects nothing because a hidden connector projects nowhere. Any one of them failing puts a way into the crypt on the players' map.

**This example can fail, which is why it is here.** Reverting [#329](https://github.com/Nossimonov/Chartdown/pull/329)'s guard — the one that reads the declared model — makes `▼ crypt` appear on the player chapel panel, and the committed render moves. A corpus addition that cannot fail is not cover, and the three fixes above all shipped past a corpus that was byte-identical because nothing in it could express them.

## Try it

```sh
chartdown check  examples/greyhallow/greyhallow.cd
chartdown render examples/greyhallow/greyhallow.cd --mode gm -o gm.svg
chartdown render examples/greyhallow/greyhallow.cd -o players.svg
```

Or open **Greyhallow Chapel** in the [playground](https://nossimonov.github.io/Chartdown/) and switch modes.
