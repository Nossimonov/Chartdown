/**
 * The pure half of the plugin: turn a chartdown fence's text into DOM inside
 * the element Obsidian hands us. Uses Obsidian's DOM helpers (createEl/empty,
 * per obsidianmd/prefer-create-el); tests provide a minimal shim for them.
 */

import { renderSource } from "@chartdown/render-svg";

export type RenderMode = "player" | "gm";

export function renderChartdownBlock(source: string, el: HTMLElement, mode: RenderMode): void {
  const { svg, diagnostics } = renderSource(source, { mode });

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const node = el.ownerDocument.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  // Scale to the note's width; the viewBox keeps the aspect ratio.
  node.removeAttribute("width");
  node.removeAttribute("height");
  node.classList.add("chartdown-map");
  el.appendChild(node);

  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const box = el.createDiv({ cls: "chartdown-diagnostics" });
    for (const d of errors) {
      box.createDiv({ text: `line ${d.line}: ${d.message}` });
    }
  }
}
