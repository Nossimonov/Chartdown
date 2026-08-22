/**
 * A renderer invariant is reported, not thrown at the caller (#341).
 *
 * ADR 0043 made an unhandled edge direction throw rather than silently draw an
 * east edge. Correct — but nothing caught it, and `check` renders
 * unconditionally (#120), so the author of a corner-placed wall got a Node
 * stack trace and NO diagnostic. The bitter part is that the right message
 * already existed: the parser had refused `C3.nw` by name before the renderer
 * ever ran, and the process died before the print loop reached it.
 *
 * These assert the CALLER'S experience rather than the throw site, because the
 * throw is not the defect — `grid.ts` should keep throwing. What must hold is
 * that a caller gets a result it can print.
 */
import { describe, expect, it } from "vitest";
import { parse } from "@chartdown/core";
import { render, renderSource } from "./index";

const doc = (line: string): string =>
  ["map: battlemap", "grid: square 5x5", "scale: 5ft", "", "[structures]", line].join("\n");

/** What `check` does: parse, then render unconditionally, then print both. */
const asCheckDoes = (src: string): { messages: string[]; threw: boolean } => {
  const parsed = parse(src);
  try {
    const r = render(parsed.document, { mode: "gm" });
    return { messages: [...parsed.diagnostics, ...r.diagnostics].map((d) => d.message), threw: false };
  } catch {
    return { messages: [], threw: true };
  }
};

describe("a renderer invariant reaches the author (#341)", () => {
  for (const line of ["wall : C3.nw", "door : C3.nw"]) {
    it(`\`${line}\` reports instead of crashing`, () => {
      const { messages, threw } = asCheckDoes(doc(line));
      expect(threw).toBe(false);

      // THE POINT OF THE ISSUE: the parser's own refusal survives to the caller.
      // Before this, `check` printed nothing at all for these two documents.
      expect(messages.some((m) => m.includes("names a corner"))).toBe(true);

      // And the invariant is reported as a RENDERER fault, distinct from the
      // document's errors, so the next one is not read as the author's mistake.
      const fault = messages.find((m) => m.includes("renderer could not draw"));
      expect(fault, "no renderer-fault diagnostic").toBeDefined();
      expect(fault).toContain("edgeSegment");        // the invariant, verbatim
      expect(fault).toContain("not a fault in the document");
    });
  }

  it("still returns a valid, placeable sheet", () => {
    // A caller that embeds the output — the Obsidian pane, MCP's raster — needs
    // something well-formed even when the drawing gave out.
    const { document } = { document: parse(doc("wall : C3.nw")).document };
    const { svg } = render(document, { mode: "gm" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("a corner on an archetype that never reaches the throw is untouched", () => {
    // `statue : C3.nw` is refused by the parser and renders without incident —
    // the archetype decides whether the renderer reaches `edgeSegment` at all.
    // It must not acquire a renderer-fault diagnostic it never had.
    const { messages, threw } = asCheckDoes(doc("statue : C3.nw"));
    expect(threw).toBe(false);
    expect(messages.some((m) => m.includes("names a corner"))).toBe(true);
    expect(messages.some((m) => m.includes("renderer could not draw"))).toBe(false);
  });

  it("an ordinary document gains nothing", () => {
    // The guard must be invisible when nothing throws — the negative half.
    for (const line of ["wall : C3.e", "wall : C3", "door : on room at C3.s"]) {
      const r = renderSource(doc(line), { mode: "gm" });
      expect(r.diagnostics.some((d) => d.message.includes("renderer could not draw")), line).toBe(false);
    }
  });

  it("diagnostics earned before the throw are not lost with it", () => {
    // The catch shares the array rather than starting a fresh one, so a theme
    // problem is still reported on a document that later fails to draw.
    const themed = renderSource(doc("wall : C3.nw"), {
      mode: "gm",
      theme: ["kind: theme", "", "[theme]", "nosuchsurface : fill=#ff0000"].join("\n"),
    });
    expect(themed.diagnostics.length).toBeGreaterThan(1);
    expect(themed.diagnostics.some((d) => d.message.includes("renderer could not draw"))).toBe(true);
  });
});
