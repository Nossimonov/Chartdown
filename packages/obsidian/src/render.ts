/**
 * The pure half of the plugin: turn a chartdown fence's text into DOM inside
 * the element Obsidian hands us. Uses Obsidian's DOM helpers (createEl/empty,
 * per obsidianmd/prefer-create-el); tests provide a minimal shim for them.
 */

import { locationOf, renderSource } from "@chartdown/render-svg";

export type RenderMode = "player" | "gm";

export function renderChartdownBlock(
  source: string,
  el: HTMLElement,
  mode: RenderMode,
  imports?: { libraries: Record<string, string>; documents: Record<string, string> },
): void {
  const { svg, diagnostics } = renderSource(source, { mode, ...imports });

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const node = el.ownerDocument.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  // Scale to the note's width; the viewBox keeps the aspect ratio.
  node.removeAttribute("width");
  node.removeAttribute("height");
  node.classList.add("chartdown-map");
  el.appendChild(node);

  // WARNINGS REACH THE READER TOO (#245). Filtering to errors here made the
  // whole of spec 06 §10 invisible in the one surface a GM actually reads
  // their prep in: those lints are defined as "always WARNINGS, no
  // suppression syntax", which only works if something surfaces them. A map
  // with a river running through a wall rendered looking finished.
  //
  // Kept visually distinct rather than merged into one red box, because they
  // say different things: an error means the map is wrong, a warning means it
  // may not be what you meant.
  const shown = diagnostics.filter((d) => d.severity === "error" || d.severity === "warning");
  if (shown.length > 0) {
    // The box takes the volume of its WORST line: all-warnings should not
    // arrive framed in error red, which is what merely widening the filter
    // would have done.
    const worst = shown.some((d) => d.severity === "error") ? "error" : "warning";
    const box = el.createDiv({ cls: `chartdown-diagnostics chartdown-diagnostics-${worst}` });
    for (const d of shown) {
      box.createDiv({
        cls: d.severity === "error" ? "chartdown-diagnostic-error" : "chartdown-diagnostic-warning",
        text: `${locationOf(d)}: ${d.severity}: ${d.message}`,
      });
    }
  }
}
