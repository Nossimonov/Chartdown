# 0038 — A placement form means the same thing on every map kind: the half-plane places battlemap terrain, ink to the centerline and cells by their centres

- **Status:** Accepted
- **Date:** 2026-07-30
- **Issue:** [#231](https://github.com/Nossimonov/Chartdown/issues/231)

## Context

A user wrote a battlemap and wanted to say that the dark wood is north of the babbling brook. The language already has the sentence — `relational = … | ( [ measure ] , compass , "of" , ref )` is in the closed grammar, and on a region map `sea "The Argen Sea" : west of coast` has meant exactly this since spec 05 §2. On a battlemap the same line parses, `check` reports `ok`, and nothing is drawn ([#233](https://github.com/Nossimonov/Chartdown/issues/233)).

The silence is a defect either way, but *how* it is fixed depends on a rule spec 06 §6 states in passing:

> *Extent is always declared, never derived*: a "fill to the river" mechanic was considered and rejected — geometric fill would make tactical cells depend on renderer finishing, and cell-space fill would make one entity's extent silently track another's edits. Authors declare the bank cells they mean.

So the form is refused on battlemaps by decision rather than by oversight. Instead of that rule the author writes four ranges — `forest dark-wood "Dark Wood" : A1..M9 N1..T4 N5..O6 P5..Q5` — because the brook runs diagonally from `N7` to `S4` and a rectangle cannot follow a diagonal. Checked column by column, **that tiling is correct**: this is not a decision forced by anyone getting a wrong map. It is forced by what the correct map costs to maintain. Move one vertex of the brook and all four ranges are silently stale, because nothing in `A1..M9 N1..T4 N5..O6 P5..Q5` records that those numbers came from a river.

What demands a decision is not the tedium but the **split**. A feature may depend on another feature on a region map and may not on a battlemap, so one grammar production means something on one map kind and nothing on the other. A language whose vocabulary is closed and whose forms are shared cannot also have forms that quietly change meaning with the header. The asymmetry is the defect; unifying the two is the fix, and §6's rejection is what stands in the way.

**"Declared, never derived" appears three times in spec 06, and only one of them is reversed here.** §3 makes a structure's *openness* declared (load-bearing for [ADR 0008](0008-open-structures-declared.md)); §5 makes *elevation* declared; §6 makes *terrain extent* declared. They share a phrase and not a rule: the first two govern a property an author states about one entity, and only §6 governs whether an entity's extent may be resolved from another entity. This ADR reverses §6's, and §3 and §5 stand.

[ADR 0017](0017-openings-perforate-terrain.md) also cites §6's rejection as precedent for a *general* principle — that an author should not maintain two representations of one thing that can silently disagree. That principle survives untouched, because a half-plane is not a second representation of the forest. It is the only one, which is precisely the argument.

## Decision

**A relational half-plane places terrain on a battlemap, and means what it means on a region map.** `north of babbling-brook` is the region form's sentence asked of a grid.

```chartdown
map: battlemap
grid: square 20x20
scale: 5ft

[terrain]
river babbling-brook "Babbling Brook" : path A10 J10 L10 N9 N7 S4 T4 width=1
forest dark-wood "Dark Wood" : north of babbling-brook
```

**Ink and cell coverage are answered separately**, as spec 06 §6 already answers them for a path band ("this governs where the ink stops, **not what the path covers**", [#145](https://github.com/Nossimonov/Chartdown/issues/145)):

- **The fill's ink stops at the reference's centerline.** Area terrain renders beneath path bands (§6 layering), so the centerline is what makes the fill reach the whole edge it claims to fill to. Measured: a `width=1` band draws at `1 × 32 × 0.85 = 27.2px` inside a 32px cell, leaving **2.4px of the cell showing on each side**. Stopping the fill at the near cell boundary makes that 2.4px *paper* — a hairline gap running the entire length of the reference, on every map that uses the form. Stopping at the centerline makes it the fill, which is the bank reading §6 already endorses: "a declared terrain cell grazed by a river's band reads as its bank (mud shows through at the water's edge)."
- **A cell is in the half-plane when its centre lies strictly beyond the course.** This is §6's existing rule — "a path's cells, crossings and lints keep reading the **centres**" — and needs no new convention.
- **Ties go to the reference, never to the fill.** A cell whose centre lies *on* the course is not beyond it, so it belongs to the watercourse and not to the wood.

The cell set is a pure function of the referenced entity's declared course, so it is deterministic under spec 02 §8.2 and re-renders identically.

**The tie rule is not invented for the implementation's convenience.** Compared against the reporter's hand-tiling — the 22 cells the brook passes through against the 151 declared as forest — the rule agrees with what the author did by hand in **20 of 22** cases: along every straight run their forest and the brook's cells are strictly disjoint, and on the diagonal they included exactly the cells whose centres fall north of the line. The two that disagree are the brook's terminal cells `S4`/`T4`, swept in because `N1..T4` is one clean rectangle and excluding two corners would have cost extra ranges. A rule handing ties to the fill would contradict the document that motivated the feature.

## Alternatives considered

- **Do nothing — keep the split and make it loud.** Refuse the form on battlemaps with an error naming the fix, which is [#233](https://github.com/Nossimonov/Chartdown/issues/233)'s other resolution and follows [#207](https://github.com/Nossimonov/Chartdown/issues/207)'s precedent exactly. Rejected: it is the cheapest change and it preserves the thing actually wrong here — one form with two meanings decided by a header. It also asks every author who learns `west of coast` to discover by error message that the sentence stops working when they open a battlemap.
- **Authoring-time expansion.** A tool reads `north of babbling-brook` and emits the four ranges to paste, the shape of the `chartdown-measure` proposals ([#204](https://github.com/Nossimonov/Chartdown/issues/204), [#205](https://github.com/Nossimonov/Chartdown/issues/205)). This answers **both** of §6's objections without touching the spec, and it is the strongest alternative. Rejected because it fixes the typing and not the coupling: the pasted ranges still go stale when the brook moves, the author must remember to re-run it, and the document still never records that the forest's edge is the brook. It also leaves the two-meanings-per-form problem exactly where it was.
- **Permit it only where the reference is axis-aligned.** Cheap, safe, and useless for the motivating case, which is a diagonal — the whole reason the hand-tiling costs four ranges instead of one.
- **Hand ties to the fill** (a cell whose centre is on the course belongs to the half-plane). Rejected on the evidence above: the reporter's own document excludes the watercourse's cells along every straight run, and a rule that painted the brook's bed as forest would be wrong in the common case to save a comparison.
- **Resolve the fill geometrically and quantise nothing.** Rejected: it is precisely §6's first objection — tactical cells would depend on how the renderer finishes ink, and a cell's terrain is what rules read.

## Consequences

**Easier.** One form, one meaning, on every map kind. A forest that is meant to stop at a river says so in the line a reader will see, instead of in four ranges whose provenance is lost. Editing the brook moves the wood, which is what the author asked for.

**Harder, and the honest losses:**

- **A battlemap's tactical cells can now change because a different entity was edited.** This is the risk §6 named, and unifying does not dissolve it — it accepts it in exchange for the coupling being *stated*. The distinction being relied on is that §6's objection turns on the word "silently", and a written `north of babbling-brook` is not silent; the hand-tiled version is the one whose dependency is invisible. That reading is a judgement, not a proof.
- **It sits in tension with [#179](https://github.com/Nossimonov/Chartdown/issues/179)'s "a feature's drawn shape MUST NOT depend on what else the map happens to contain."** The defence is that #179 forbids *incidental* dependence — a shape moving because of an unrelated feature elsewhere — whereas this dependence is named by the author in the placement itself. The rule should be read as constraining what a document did not ask for, and this ADR makes that reading explicit rather than leaving the two to be reconciled later.
- **A derived cell set reaches the UVTT export** (spec 06 §9), so exported geometry now depends on a resolved reference. Not resolved here.
- **The `terrain-crosses-wall` lint needs no exemption, and this was checked rather than assumed.** The concern is that a half-plane escapes every footprint by construction — but §10's whole-footprint rule already exempts exactly that, and exists for exactly that reason: it is what keeps spec 06 §5's blanket ground layer, `earth : area A1..T20`, from reporting every room on the map. Measured on five structures against one area, the wholly-inside and wholly-outside cases emit nothing and only **straddling** structures warn, one apiece.

  That remaining warning is **kept deliberately**. A wood covering half a lodge's footprint is a real thing for an author to look at, and under a derived extent the lint is what makes the coupling auditable: edit the brook, and the consequence is reported instead of absorbed silently. The hazard §6 named is not that extents track each other but that they do so unnoticed — so the lint is where this ADR pays that objection back, and it is load-bearing rather than incidental.

  It does presuppose a message an author can act on, which today's is not: it names neither the structure nor the crossing, so several crossings arrive as identical lines at one line number ([#234](https://github.com/Nossimonov/Chartdown/issues/234), true on `main` independently of this decision). Where the extent is **derived**, that message must also name the reference, since the cause may be an edit to an entity the reported line does not mention.
- **Spec 06 §6's paragraph must be rewritten, not merely contradicted.** The prose is cited elsewhere, and leaving a rejected mechanic described as rejected while the renderer implements it is the drift process rule 4 exists to prevent.

**Constrains future decisions.** Any further derived-extent form must state its ink rule and its cell rule separately — the two questions are independent, as spec 06 §6 already found for path bands, and answering only one of them is what would let an implementation quietly decide the other.
