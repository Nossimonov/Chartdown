# Examples

Chartdown documents live here — **written before the syntax exists**. This is deliberate: per the [vision](../docs/vision.md), we author the maps we *wish* we could write, then design the grammar to make them valid.

## Conventions

- One directory per example: `examples/<slug>/`
  - `<slug>.cd` — the Chartdown source (aspirational until the spec catches up)
  - `README.md` — what map this describes, and a sketch/image of the intended render if available
  - `<slug>.svg` / `<slug>-gm.svg` — **generated** player/GM renders from the reference renderer (`@chartdown/render-svg`); regenerate rather than edit. The CLI (issue #23) will make this a command.
- Each example declares its status at the top of its README:
  - **aspirational** — not yet valid under any spec draft; exists to drive syntax design
  - **spec-aligned** — valid under the current spec draft
- Cover all three target map types. Phase 0 aims for at least one aspirational example each of: a region/fantasy map, a hex chart, and a battlemap.

When a spec change invalidates an example, fixing the example is part of that spec change's PR — examples and spec never contradict each other on `main`.

These pairs double as the language's **few-shot corpus** (see [docs/spec/README.md](../docs/spec/README.md), machine-ingestion artifacts): each `.cd` + README pair is a source↔intended-render example that agents and new users learn from, which is one more reason examples must stay impeccably valid.
