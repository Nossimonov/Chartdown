/**
 * The pure half of the plugin: turn a chartdown fence's text into DOM inside
 * the element Obsidian hands us. Kept free of the `obsidian` module so it
 * tests against a plain DOM (the Obsidian-specific surface stays one thin
 * adapter in main.ts).
 */

import { renderSource } from "@chartdown/render-svg";

export type RenderMode = "player" | "gm";

export function renderChartdownBlock(source: string, el: HTMLElement, mode: RenderMode): void {
  const doc = el.ownerDocument;
  const { svg, diagnostics } = renderSource(source, { mode });

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const node = doc.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  // Scale to the note's width; the viewBox keeps the aspect ratio.
  node.removeAttribute("width");
  node.removeAttribute("height");
  node.classList.add("chartdown-map");
  el.appendChild(node);

  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const box = doc.createElement("div");
    box.className = "chartdown-diagnostics";
    for (const d of errors) {
      const line = doc.createElement("div");
      line.textContent = `line ${d.line}: ${d.message}`;
      box.appendChild(line);
    }
    el.appendChild(box);
  }
}
