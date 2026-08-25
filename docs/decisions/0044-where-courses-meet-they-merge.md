# 0044 — Where courses meet, they merge: a joining end stops in the water, and no bank is drawn over water

- **Status:** Accepted
- **Date:** 2026-08-08
- **Issue:** [#314](https://github.com/Nossimonov/Chartdown/issues/314), [#315](https://github.com/Nossimonov/Chartdown/issues/315)
- **Builds on:** [ADR 0034](0034-a-border-lies-on-one-side-of-its-line.md), [ADR 0042](0042-a-field-is-drawn-on-the-map-field-of-its-own-panel.md)

## Context

Two issues, filed separately from one observation — that the confluence on the committed `undercellar` example "looks terrible" under a theme that banks its rivers. They turn out to be one picture failing in two ways, and neither fix alone repairs it.

**The joining course runs past the course it joins** ([#314](https://github.com/Nossimonov/Chartdown/issues/314)). Spec 02 §7 says `from … join …` "meets the trunk at the nearest cell", and `nearestOnCourse` resolves exactly that. The overshoot arrives afterwards: a grid course's points are cell centres, and `extendToCellEdge` then pushes each **terminal** point out to its cell's face, so the course fills its end cells rather than stopping at their middles. That is [#145](https://github.com/Nossimonov/Chartdown/issues/145)'s behaviour and it is right for a free end — a stream running into a pond should reach the pond, not stop half a cell short. It is wrong for a joining end, because there the terminal cell belongs to **another course**, and filling it means coming out the far side. Measured on `undercellar`: the trunk's centreline is `x = 136`, the joining course ends at `x = 120`, and the difference is exactly `CELL / 2`.

**Every course's bank is drawn over every earlier course's water** ([#315](https://github.com/Nossimonov/Chartdown/issues/315)). A themed course emits a wide edge band and then a narrower core, per entity, in document order. So the second course's bank lands on the first's water. With the shipped `candyworld` theme on the same example, each course draws a 27.2-wide band and a 19.2-wide core, and the junction becomes a lattice of banks over the water. It gets worse per tributary, and **which** cuts survive depends on the order the lines happen to appear in — so moving a line changes the picture.

The default theme hides the second one entirely: with no `edge=` a course is a single stroke and there is nothing to paint over. It became visible the moment somebody themed a river, which is what themes are for.

## Decision

**Where courses meet, they merge.** Concretely, two rules that only work together:

1. **A joining end stops at its meeting point and is not extended to the cell face.** The cell-face extension exists so a course fills the cell it *terminates* in; a course that joins another does not terminate in a cell of its own, so the extension does not apply. Its band still overlaps the trunk's, because both are drawn wide about their centrelines — and that overlap is what a confluence is.

2. **Every course's bank is drawn before any course's water.** Two passes over the courses rather than one interleaved pass: all edge bands, then all cores. No bank can then land on any water, whatever order the document lists the courses in.

The second rule is the one that makes the picture independent of document order, which is the deeper defect: the same map produced different junctions depending on where a line sat in the file, and nothing about the language says line order is a drawing decision.

**Neither rule is sufficient alone**, which is why they are one decision. Fix only the endpoint and the banks still cross the water. Fix only the layering and the joining course still runs out the far side of the trunk with a squared cap in open ground. Prototyped on `undercellar` under `candyworld`: with both, the water runs continuously through the junction with every bank outside it.

## Alternatives considered

**End the joining course at the trunk's near bank.** What a tributary does in the world — the water stops where the other water starts. Rejected because "where the trunk's water starts" is not a fixed distance: [ADR 0030](0030-a-centerline-carries-its-own-width.md) lets a centreline carry its own width, so the bank moves along the course, and a rule that has to solve for it would make a confluence's geometry depend on a width the joining course cannot see. Overlapping centrelines need no such solve and read the same.

**End it at the trunk's centreline rather than at the meeting cell's centre.** More exact where the trunk runs diagonally, and it contradicts spec 02 §7's own words, which name the *cell*. On a grid the cell is the unit that carries meaning; the two answers differ only where a trunk crosses a cell off-centre, and preferring the projection would make `join` mean something different on a grid than the section says.

**Clip each bank against the other courses' water, as [ADR 0034](0034-a-border-lies-on-one-side-of-its-line.md) clips a border to the region that owns it.** The most faithful analogue, and it produces the same picture as the two-pass rule for every case examined — at the cost of a mask per course and a per-pair intersection. Rejected as a more expensive way to reach the same output; if a later case needs a bank clipped rather than merely underneath, this is the alternative to revisit.

**Leave the layering to document order and tell authors to order their courses.** Rejected outright. It makes line order a rendering instruction, which nothing else in the language does, and it is unwritable advice for a trunk with tributaries on both sides.

## Consequences

The committed `undercellar` example changes, in both modes: the joining course loses its overshoot, and the drawing order of every themed course moves. No other example has courses that meet.

**Free ends are untouched.** A course that terminates in a cell still fills it, so [#145](https://github.com/Nossimonov/Chartdown/issues/145)'s behaviour survives where it was meant to apply. Only a joining end changes, which is the narrowest reading of the fix.

**Two passes bind both renderers, and land in two changes.** Battlemap paths and region courses both interleave today. The battlemap is done here; the region follows separately and deliberately, because its courses are wrapped in bank and coast masks and its *coastlines* are courses too — reordering those would move geometry that [ADR 0034](0034-a-border-lies-on-one-side-of-its-line.md)'s banking and [#165](https://github.com/Nossimonov/Chartdown/issues/165)'s island clipping depend on. The rule is not weaker there; it needs its own change with room to verify it against the corpus, rather than being appended to this one. Until then a themed region confluence still shows the defect, and the issue says so.

What remains order-dependent, and is not addressed here: where two courses' **cores** overlap, the later one is on top. That is invisible while cores share a fill and would matter if two differently-coloured waters met — a canal joining a river under a theme that colours them apart.

Named rather than solved, and it is a larger question than it looks. **Blending two waters realistically needs to know which way each is flowing**, so the blend falls on the correct side of the junction, and the language has never had reason to track that. A course carries an implied order — `from` one end `to` the other — and spec 02 §§6–7 even speak of water "flowing to" a meeting, but no rule anywhere says that order IS the flow, and nothing consumes it as such. A junction needs more than the tributary's own direction, too: which side of the *trunk* the blend belongs on depends on where the trunk's water is going. Reading a blend out of the existing point order would be assuming a meaning the language has not committed to, which is how the layering came to be unspecified in the first place. If two-coloured confluences are ever wanted, declaring flow is the prerequisite, and that is a proposal rather than a rendering fix.

A test asserts the property rather than the picture: **no bank is drawn over any water, in either order the two courses can be written.** That is the claim the old behaviour could not make, and it fails loudly if either rule is lost.

Not byte-identity under reordering, which a first draft of this ADR claimed and the test disproved twice over. Swapping the lines swaps the two `<g>` elements, because entity order survives everywhere else and legitimately should — it decides things like which label claims a contested spot. And a JOINING pair cannot be reordered at all: `join runnel` requires `runnel` declared earlier, since resolution is order-bounded and fail-loud ([ADR 0003](0003-coordinates-and-placement.md)), so the swapped document is illegal rather than merely different. The property is therefore asserted on two INDEPENDENT courses that cross — a river and a road, which reference nothing and may be written either way — and that is the case the order-dependence was ever about. The remaining order-dependence is bank-over-bank where two banks overlap, invisible while banks share a colour, and the same deferred question as core-over-core.
