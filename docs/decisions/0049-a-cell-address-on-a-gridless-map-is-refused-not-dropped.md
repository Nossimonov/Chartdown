# 0049 — A cell address on a gridless map is refused, not dropped

- **Status:** Accepted
- **Date:** 2026-08-20
- **Issue:** [#325](https://github.com/Nossimonov/Chartdown/issues/325)
- **Builds on:** [ADR 0043](0043-an-address-form-a-slot-cannot-consume-is-refused.md), [ADR 0020](0020-render-resolution-is-editorial.md), [ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md)

> *0048 was skipped: `issue-321-annotation-names-the-nearest-landing` holds
> `0048-an-annotation-names-the-nearest-landing-of-its-own-flight.md` with PR
> [#337](https://github.com/Nossimonov/Chartdown/pull/337) open and unmerged. `preview` alone
> would have said 0048 was free.*

## Context

Spec 02 §2 is titled *"Cell addresses — one form for every **grid**"* and says the geometry comes
from *"the header's `grid:` declaration"*. Spec 02 §1 splits the two coordinate worlds outright —
*"Bare numbers in placements are cells (grid maps) or world units (gridless maps)"* — and §6 gives
the gridless world its own form, the point `(x,y)`. A `region` map declares no grid and there is no
`grid:` for it to declare, so a cell address written on one names nothing at all.

The parser accepts it anyway, and the map then does not contain what the document says it does.
Measured on `preview` @ `ab1690d`, `@chartdown/core` 0.6.0, whole-SVG md5 against the same document
with an empty `[terrain]` section:

| line on a `map: region` | `check` | render |
|---|---|---|
| *(empty section — baseline)* | `ok` | `5cef7d22da9b5f0ec0f9eb6c70a3e961` |
| `forest w : at C4` | `ok` | **identical to baseline** |
| `forest w : C4` | `ok` | **identical to baseline** |
| `tower u : at D5` | `ok` | **identical to baseline** |
| `[labels] w : at C4` | `ok` | **identical to the same document with no override** |
| `[labels] w : sprawl C4..D5` | `ok` | **identical to the same document with no override** |
| `forest w : area C4..D5` | `ok` | `<polygon points="" fill="#a9c79c" …/>` |
| `grid: square 10x10` in the header | `ok` | **identical to the same document without the line** |
| `forest w : at C4.n` | **error**, correctly | baseline |
| `forest w : (400,400)` | `ok` | draws |

The root cause is a missing case rather than a wrong one. `region.ts`'s placement loop tests
`p.kind === "point"`, `"point-range"`, `"shape"` and `"relational"`; `"address"`, `"range"` and
`"edge"` have no branch, so the placement evaporates and the entity keeps its default of nothing.
The empty polygon is the same hole one level down: `area C4..D5` is a `shape` placement whose args
are filtered with `.filter(arg => arg.kind === "point")`, which discards the range and leaves the
assembled point list empty — and an empty list is still assigned to `out.polygon` and still drawn.

**The rule this issue asks for already exists in the tree, for exactly one construct.**
`packages/render-svg/src/region.ts:1081–1091`, written for [#258](https://github.com/Nossimonov/Chartdown/issues/258)
— this same investigation's own proposal — refuses a cell in a course's `via` payload:

```js
// A region map has no grid, so a `via <cell>` (#258) names
// nothing here. Refused rather than approximated: a cell means a
// square of a grid this document does not have.
```

So the language has already decided this question once, in one slot, and never generalised it.
Everything else — a bare address, an `at` address, a range, an edge, a label override — is still
silently dropped. That asymmetry is what makes a decision necessary rather than a patch: whichever
way it goes, all of the forms should go the same way, and the one that is already in the code
should not be the accident.

Two prior decisions pull in different directions and have to be reconciled rather than picked
between. [ADR 0043](0043-an-address-form-a-slot-cannot-consume-is-refused.md) says an address form
a slot cannot consume is **refused**. [ADR 0020](0020-render-resolution-is-editorial.md) and
[#287](https://github.com/Nossimonov/Chartdown/issues/287) say a header key inert on a map kind
**warns** — `detail:` on a battlemap, `light:` on a region map — because *"nothing about the
document is wrong, only unanswerable at that scale."* A cell address on a region map and a `grid:`
line on a region map are both grid-only constructs on a gridless map, and today both are silent.

## Decision

**On a gridless map a cell address has no referent, and Chartdown says so at the line that wrote
it. Where the address is a placement, the line is refused. Where a grid-only construct merely has
nothing to do, it warns.**

The discriminator is **whether the map is still drawable as written**:

- **A cell address, address range, or edge token in a placement is an error**, wherever it appears
  in the predicate — bare, under `at`, under `on`'s `at` payload, in a course's `via` controls, in
  a shape's argument list, and in a `[labels]` override's `at` or `sprawl` target. There is no
  fallback for these: the entity does not draw, so honouring the document is not possible and
  silence leaves an author looking at a map missing the thing they just wrote.

  The message names the gridless spelling, in the shape spec 02 §5's edge-token refusal already
  uses and the shape `region.ts` already uses for `via`:

  ```
  error: 'C4' is a cell address and this map has no grid — give a point in the
         document's extent units: '(400,400)' (spec 02 §1, §6)
  ```

- **`grid:` on a gridless map is a warning.** The map draws correctly without it; the key is
  understood and inapplicable, exactly as `detail:` is on a battlemap and `light:` is on a region
  map. Spec 01 §2 already says *"Other header keys are defined per map type"*, and #287 already
  settled that an inert key says so rather than sitting silent.

- **An entity that resolves to no geometry contributes no element.** `<polygon points="">` is
  non-conforming under any reading of this decision, and `render` deliberately proceeds past errors
  — it writes the file and exits 1 — so the refusal above does not remove the degenerate element on
  its own.

**The `via` special case in `region.ts` is deleted, not kept beside the general rule.** Two
diagnostics for one line is worse than the silence being fixed, and the case that exists today is
the general rule wearing one slot's clothes.

**Spec 02 gains the sentence.** The rule is currently implied by three separate sentences across §1,
§2 and §6 and stated outright by none, which is how a checker came to be written without it.
CONTRIBUTING rule 2 makes the sentence the first deliverable, not a footnote to the code.

## Alternatives considered

**Do nothing.** Rejected on the measurement rather than on principle: five distinct spellings render
byte-identically to their own absence and one emits an element no renderer can draw. This is the
family [#239](https://github.com/Nossimonov/Chartdown/issues/239),
[#248](https://github.com/Nossimonov/Chartdown/issues/248),
[#233](https://github.com/Nossimonov/Chartdown/issues/233) and
[#252](https://github.com/Nossimonov/Chartdown/issues/252) have spent a phase closing, and the
`via` refusal already in `region.ts` means "do nothing" is not even the status quo — it is the
status quo for six forms out of seven.

**Warn instead of erroring.** The consistent-looking choice, since the sibling header rules warn,
and it would make the change non-breaking under
[ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md). Rejected because the two
cases differ in what the reader is left holding. `light: dark` on a region map produces a correct
map that simply has no wash — the author loses an effect. `forest w : at C4` produces a map with **no
forest**, and a warning in a stream the author may not be reading leaves them with a document and a
picture that disagree. ADR 0043 drew this line already, for the same reason, and erring toward the
warning here would make the two ADRs contradict each other on the same axis. It would also require
keeping the entity's non-render as *specified* behaviour, which nothing in the spec supports.

**Honour `grid:` on a region map and give the address a referent.** The most interesting
alternative, and the one #325's own body raises: `grid: square 10x10` parses on a region map today,
so a small change would let `C4` mean a tenth of the extent. Rejected on reading
`parse.ts:571` and `ast.ts:261` — `grid:` is stored on the document unconditionally and nothing
downstream of a `region` map ever reads it, so this is not a small change but a new coordinate
system for a map kind that already has one. It also directly contradicts
[ADR 0038](0038-a-placement-form-means-the-same-thing-on-every-map-kind.md): a region map's world
units and a grid overlaid on them would give the same map two incompatible spellings for one
position, and `(400,400)` and `C4` would both be legal and mean different things. If someone wants a
gridded region map, that is a proposal for a new map kind, not a bug fix — and refusing now does not
foreclose it, because the address form stays in the grammar.

**Interpret the address as world units** — `C4` → `(3,4)`. Rejected outright: it is the east-edge
`default:` of ADR 0043 in another costume, silently converting an address form into one that is not
what the author wrote. Three units into a thousand-unit extent is also, in practice, the northwest
corner, so the map would gain a landmark in the wrong place rather than lose one.

**Fix only the empty polygon and leave the addresses silent.** The literal minimum #325 says is
non-conforming *"under any reading."* Rejected because it fixes the one spelling that produces
visible garbage and leaves the five that produce nothing — and the five are the worse failure, since
garbage gets noticed.

**Refuse a polygon with fewer than three points, rather than one with none.** Considered and
deliberately not taken, because it is a wider change than this issue describes. Measured:
`forest w : area (100,100) (200,200)` — no address anywhere — checks `ok` and emits
`<polygon points="102.5,102.5 205,205">`, a two-vertex polygon that draws as a line. That is a live
silent defect reachable with points alone, it wants the *"an outline needs at least three"* warning
the framed-outline path already emits at `region.ts:852–856`, and it is not what #325 reports. It is
filed separately rather than folded in; see Consequences.

## Consequences

**BREAKING under [ADR 0041](0041-breaking-means-a-clean-document-stops-checking-clean.md):** a
document writing `forest w : at C4` on a region map checks clean today and will error. What breaks is
a document that was already not getting what it asked for — in every case measured, the entity was
absent from the render — so no map changes appearance, and the release cut from `preview` becomes a
minor.

**The corpus does not move.** No committed example writes an address or a `grid:` line on a region
map: `examples/vessany`, `examples/gumdrop-vale` and `examples/sundered-reach` are the three region
documents in the tree and none contains either. Nor do the vaults — `../Whispers` holds two region
documents and neither writes an address; `../Calamity` and `../Moria` hold none.

**A `region` document's diagnostics get stricter without its rendering path getting more complex.**
The refusal lives in the core parser beside `checkNoCorner` and the edge-slot check, so it holds for
every consumer of `parse()` whether or not it renders, and the region renderer loses a branch rather
than gaining one.

**What this constrains.** A future proposal for gridded region maps — the third alternative above —
now has to say what happens to `(x,y)`, because this ADR makes the two spellings mutually exclusive
by decision rather than by accident. That is the intended cost: the question becomes visible instead
of being answered by whichever branch of a placement loop happens to run.

**What it leaves open, deliberately.** Two neighbours were measured and are **not** in scope:

- `detail-at=C4` on a region map is accepted (`parse.ts:867` validates only that the value *parses*
  as an address, never against the map kind). A gridless parent has no cell for a sub-map's A1 to sit
  on, so this is the same rule in a `key=value` slot — but `detail=` seams are spec 03 §4's
  mechanism with their own open questions, and refusing one needs an answer for what a gridless seam
  anchors to instead.
- The two-vertex polygon above.

Both are filed rather than fixed, per the scope rule: shipping them inside this change would bury
unfiled work in a filed commit.
