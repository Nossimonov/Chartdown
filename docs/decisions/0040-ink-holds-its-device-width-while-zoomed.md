# 0040 — Ink holds its device width while zoomed; a measured stroke scales

- **Status:** Accepted
- **Date:** 2026-08-05
- **Issue:** [#274](https://github.com/Nossimonov/Chartdown/issues/274)
- **Builds on:** [ADR 0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md), [ADR 0037](0037-geometry-is-in-map-units-ink-is-in-canvas-units.md)

## Context

[#186](https://github.com/Nossimonov/Chartdown/issues/186) gave a reader the ability to get closer to a map, and Phase 4 spent itself on detail whose whole justification is that it is correct at every scale. The two only pay off together: a channel too narrow to draw at map scale ([ADR 0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md)) is symbolised precisely so that a reader who comes closer can eventually see the passage itself.

They do not currently pay off together. Zooming narrows the `viewBox`, which scales **everything expressed in canvas units** — and the map's linework is expressed in canvas units. Measured across the coastline stroke of a region map with a genuine narrow channel:

| zoom | coast ink |
|---|---|
| ×4 | 2 px |
| ×16 | 15 px |
| ×64 | 32 px |

The probe's channel is 2.59 canvas units wide, with two facing 2.4-unit coastline strokes drawn over it. Because ink and water grow together the ratio never moves, so **the passage is buried at every zoom level**. The image is self-similar: zooming yields a larger picture, never a more detailed one, which is what an OS magnifier already does for any format. ADR 0035's floor is the one thing that behaves, because its symbol is the one stroke already pinned to viewport units.

[ADR 0037](0037-geometry-is-in-map-units-ink-is-in-canvas-units.md) drew the necessary line and stopped one step short of this:

> Anything that decides where the land is, is in map units. Anything that is ink laid on top is in canvas units.

Canvas units are right for a *fitted* map — they are what keeps a coastline legible on a 30mi sheet and on a 3000mi one. But canvas units are not device units, and under zoom the distinction collapses: ink correctly separated from geometry rides along with the geometry anyway.

## Decision

**A stroke is either measured or ink, and the renderer says which.**

- A **measured** stroke's width is a map distance — a course declared `width=20ft` is drawn twenty feet wide. It scales with the view, always. Pinning it would make the map lie about its own dimensions.
- An **ink** stroke's width is a drawing convention — a coastline's weight, a grid line, a halo behind a marker. It is authored in canvas units, as ADR 0037 requires, and **rendered at its device width whenever the view is closer than fitted**.

At fit the two rules agree, because at fit the canvas *is* the viewport; they diverge only once a reader has asked to come closer, which is exactly when the distinction matters. This completes ADR 0037's split rather than reopening it: ink was always the thing whose job is legibility at the drawn size, and under zoom the drawn size stops being the canvas.

**The renderer marks ink, not measured, even though ink is the larger set.** The two possible defaults fail differently, and only one of them fails safely:

| marked | a mark is missed | consequence |
|---|---|---|
| ink | that stroke keeps scaling | no improvement — today's behaviour |
| measured | that stroke gets pinned | a 20ft river narrows as the reader zooms; the map lies |

An omission must cost a feature, never a fact. So the default is to scale, and ink is an explicit claim made at the point of drawing.

**The device width ink holds is the width it had when fitted.** Not the authored number read as pixels: a coastline authored `2.4` in an 820-unit canvas drawn 700px wide *measures* 2.05px at fit, and reinterpreting the `2.4` as device units would step it to 2.4px the moment a reader zoomed. So the renderer emits each ink stroke's authored width alongside the marking, and the viewer — which is the only party that knows how wide the element is — supplies the fitted scale:

```css
.chartdown-zoomed .cd-ink { vector-effect: non-scaling-stroke; stroke-width: calc(var(--cd-w) * var(--cd-fit)); }
```

Ink then sits at exactly its fitted appearance at every zoom level, continuously, with no boundary anywhere. Measured in a browser at a 400px element: fitted ink 1px, ×16 unpinned 10–15px, ×16 pinned 1px.

**Pinning is the viewer's act, not the renderer's.** The renderer's output is unchanged: it carries the marking and the authored width, and a static SVG renders exactly as it does today. A surface that offers zoom applies the fitted width while zoomed; a surface that does not is unaffected. An exported or printed SVG therefore still scales its ink, which is correct — a map enlarged to a poster wants heavier linework, and hairlines on a poster would be a regression rather than a fix.

## Alternatives considered

**Apply `vector-effect: non-scaling-stroke` to every stroke in the SVG.** The one-line version, and it is wrong on the corpus. In `redford-crossing.svg` the river is `stroke-width="54.4"` and the road `27.2`, because a course's width is drawn as a stroke; rendered pinned, the river and the hatching vanish, `brenmark`'s region bands thin out, and `sundered-reach`'s settlement marker loses the halo that separates it from the water. This is what forced the measured/ink distinction to become explicit rather than inferred.

**Infer the distinction from the stroke width.** Ink is thin and measured strokes are usually thick, so a threshold nearly works. Rejected: "nearly" is the whole problem, a 1.2-unit road on a 1600mi map is measured and a 7-unit halo is ink, and the renderer already *knows* which it drew. Inferring a fact that is available for free is how the same class of bug returns on the next surface.

**Pin ink at fit as well, not only while zoomed.** Simpler to describe and to implement, and it makes ink independent of the element's width, which is arguably more consistent. Rejected because it changes every fitted map for every reader in order to fix a case none of them are in: a map viewed at fit in a wide window would get *thinner* linework than it has today. The fitted view is the one that has been designed against, and this decision should be invisible until a reader asks for something new.

**Pin ink at its raw authored width and accept a step at fit.** The simpler mechanism: no custom property, no cooperation from the viewer beyond a class. Rejected because the step is not uniformly small and does not point in a consistent direction — it is the ratio between the element's width and the canvas's 820 units, so a 700px note column steps ink 17% *thicker* while a 1400px window steps it 41% thinner. A reader who zooms to see more detail should not watch the linework change weight, least of all get heavier, and having the renderer emit a number it already knows is a small price to avoid it.

**Have the renderer emit the pinned form directly.** It would need no viewer cooperation, and would work on any surface including ones we do not control. Rejected because it makes the static artefact worse to serve the interactive one — an exported SVG is a deliverable in its own right ([`examples/`](../../examples/) commits them), and scaling ink is the right behaviour for print.

## Consequences

Fitted maps are byte-identical apart from the marking, so no committed example changes shape and no golden SVG moves.

A zoomable surface gains the property #186 was opened to establish: coming closer reveals geometry rather than enlarging a picture. The clearest case is ADR 0035's own — a symbolised channel now converges on the truth it stands for, because the symbol and the coastline both hold still while the water between them opens. Until now only half of that was true, and the half that was missing is the half the reader is looking at.

**A constraint this exposes, recorded because making zoom real is what exposed it.** [ADR 0035](0035-a-channel-too-narrow-to-see-is-drawn-as-a-symbol.md)'s symbol stops being visible at depth because it is drawn in the fill of the water body it lies in — `waterPolys[ch.water]?.fill`, derived rather than declared. That is currently a structural guarantee: there is no theme key for it, so it cannot be set to a colour that contrasts with its surroundings. It is also the one mark on the sheet a theme cannot restyle, which [#275](https://github.com/Nossimonov/Chartdown/issues/275) records as a defect rather than a stance. **Granting that colour must also give the symbol a way to stop being drawn once the passage it stands for is legible** — otherwise it becomes a coloured line lying in open water at depth, which reads as a rendering defect rather than as a symbol that has done its job. The same `--cd-fit` machinery this ADR introduces would carry the zoom at which each symbol becomes redundant.

The ink marking becomes a standing obligation on new drawing code: a stroke that is a drawing convention says so. The failure mode of forgetting is a stroke that scales, which is what it would have done anyway, so the obligation degrades gracefully.

Ink does not change weight at any point in a zoom, including the transition off fit, because the pinned width is derived from the fitted one rather than from the raw authored number. The cost is that the viewer must keep `--cd-fit` current: it is a function of the element's width, so it is recomputed on resize as well as on zoom. A stale value shows up as ink of the wrong weight rather than as anything structural, and the fitted view — which does not pin — is unaffected either way.

A test asserts the property that failed in #274: on a document whose channel is below ADR 0035's floor, the channel's width in device pixels grows with zoom while the coastline ink beside it does not. That is the convergence claim itself, measured, rather than a check that an attribute is present.
