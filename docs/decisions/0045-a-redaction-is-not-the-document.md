# 0045 — A redaction is not the document: coherence lints read what was declared, in every mode

- **Status:** Accepted
- **Date:** 2026-08-09
- **Issue:** [#320](https://github.com/Nossimonov/Chartdown/issues/320)

## Context

Spec 01 §6 makes `player` mode a **view**: a document is drawn with its secrets withheld,
and the withholding is fail-closed. Spec 06 §10's coherence lints are a different kind of
thing — they reason about what a document **means**, and they exist because a prototype
found 32 defects in a map that passed validation and rendered without a warning.

The two were wired together by accident. `buildModel` strips `hidden` and `[gm]` entities
out of the model before anything else runs, and the lint suite was handed that model. So a
player render lints the *redaction*. Any room whose only way in is `hidden` loses its only
way in and is then reported as having no way in:

```chartdown
[structures]
building vault: A1..B2
door secretdoor : on vault at B2.s hidden
```

```
$ chartdown check vault.cd                        → ok (map document)
$ chartdown render vault.cd --mode gm  -o gm.svg  → clean
$ chartdown render vault.cd -o player.svg
vault.cd:6: warning: this structure has no opening and no connector inside it —
            nothing can reach it (spec 06 §3)
```

Three things made this worse than an ordinary false positive, and together they are why it
could not be deferred:

1. **It arrives by default.** `render` defaults to `player`, so this is what an author sees
   unless they ask for something else.
2. **It cannot be silenced.** §10 provides no suppression syntax, deliberately, until real
   false positives argue for one. This is one — but suppression is the wrong remedy for a
   warning that is *categorically* misdirected rather than merely occasionally wrong.
3. **Its advice is destructive.** The single edit that clears it is to give the room a real
   opening, which is precisely the edit that destroys the secret. A warning whose remedy
   damages the document is the failure [#128](https://github.com/Nossimonov/Chartdown/issues/128)
   already ruled on once.

The CLI had already reached the right position in one place without generalising it:
`cli.ts` runs `check`'s internal render in GM mode with the comment *"GM mode, so nothing
is skipped."* That instinct is this ADR, applied everywhere.

## Decision

**The coherence lints read the declared model, on every render, in every mode.** A document
produces the **same** lints in `gm` and in `player`. A renderer whose lint set depends on
the render mode is non-conforming (spec 06 §10).

`hidden` and `[gm]` govern what is **drawn**. They do not govern what is **reasoned about**.
The redaction is still exactly as fail-closed as it was: the secret door is absent from the
player SVG, and nothing in this decision puts a stripped entity back onto a sheet.

Mechanically, a player render builds the model a second time in GM mode and hands **that**
entity set to the lints, as a **second** field on the lint context. It is built once per
render rather than once per panel, only when the mode actually strips something — in GM
mode the model already *is* the declared one — and its diagnostics go to a scratch array,
since it re-derives what the drawn model already reported.

The renderer's own `allEntities` — which the reciprocal-landing rule reads to decide
whether a connector on another level projects a landing here — stays stripped, because a
hidden connector must not project a landing. **Two consumers, opposite requirements, and
they must not share one field.** Collapsing them is how this defect and
[#319](https://github.com/Nossimonov/Chartdown/issues/319) both arose.

## Alternatives considered

**Suppress the lints entirely in player mode.** The smallest possible change, and it clears
the reported symptom completely. Rejected because it clears far more than the symptom: all
six lints go silent on the *default* command, so an author who never types `--mode gm`
stops being told about doors onto solid rock and buildings standing on air. The bug costs
one spurious warning; this cure costs every real one. It also makes `render` and `check`
disagree about a document, which is the shape of the problem rather than a fix for it.

**Retain the stripped entities during `buildModel`'s existing pass**, exposing them on the
model as a second array — no second traversal, one array's worth of memory. This was the
intended implementation and it was **abandoned after reading the resolution passes**, which
are not uniform in a way that matters here:

- `resolveRelativePlacements` and `resolveGridPlacements` never mutate an entity; they
  write a clone into the array slot (`entities[index] = clone`). Safe to run over a second
  array holding the same references.
- `expandEveryAlong` **mutates the entity object in place** (`e.placements = […]`). Two
  arrays sharing a reference therefore share that edit, and which array is processed first
  decides which one reports `'every … along <ref>' — no such feature to follow`. It is
  idempotent, so nothing double-expands, but the *diagnostic* moves.

That is an ordering hazard hiding behind a performance win, and it would have to be
re-established by hand every time a pass is added to `buildModel`. A hand-maintained "and
also run these three over the declared set" list rots silently, and its failure mode is a
subtly wrong declared model rather than a crash. Building the model a second time reuses
the pipeline whole and stays correct by construction; a future pass is picked up for free.
The cost is one extra model build per **player** render of a **battlemap**, which is
measured in microseconds and paid only where the strip actually does something.

**Give §10 a suppression syntax** (`nolint`, or `hidden` implying it). Rejected on two
counts. It is a syntax change, so it belongs in a proposal rather than a bug fix (rule 5);
and it would make every author of every secret room write a second line to silence a
warning that should never have fired. Suppression is for lints that are *sometimes* wrong.

**Do nothing, and document the warning as expected.** Rejected: the workaround an author
would reach for is to add an opening, and a document edited to satisfy a false warning is
a document made worse by its own tooling.

## Consequences

**Easier.** `check` and `render` now agree about a document, in both modes — the property
this ADR is tested against, and the one that fails loudly if the lint input is ever
re-narrowed. Secret entrances stop being second-class: a map whose only way in is `hidden`
is now clean, which it always was.

**Harder — and this is the real cost.** A player-mode warning can now name geometry that
exists only because of a hidden entity. `this connector lands on 'earth' on level 'cellar'`
may be emitted for a connector that is not on the player's sheet. This is *authoring*
output on stderr, and the author is the GM, so nothing reaches a player who was not already
holding the GM's terminal — but it is a genuine widening of what player-mode output can
mention, and it is recorded here rather than discovered later. Anyone piping a player
render's stderr somewhere a player can read it should know this.

**Constrains.** Any future lint reads the declared set by construction; a lint that wants
mode-dependent behaviour now has to argue against this ADR. Conversely, anything that must
reason about *what is drawn* — UVTT export, occlusion, the reciprocal landing — must keep
reading the stripped set, and the two fields exist so that the distinction is visible at
the call site rather than implied.

**Adjacent and deliberately not fixed here.**
[#319](https://github.com/Nossimonov/Chartdown/issues/319) needs the same declared set for
the reciprocal-landing `occupied` guard, where a hidden connector is silently replaced by
an automatic landing — a secret that *leaks onto the drawn map*, which is worse than this
one. The plumbing this ADR adds is what #319 will use, but wiring it there moves rendered
output, and #320's whole claim is that nothing rendered moves. They are separate commits
for that reason.
