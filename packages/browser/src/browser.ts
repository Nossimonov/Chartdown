/**
 * The embedding surface (the whole strategy's target): drop this script into
 * any HTML page and every fenced Chartdown block renders in place.
 *
 * Recognized blocks: `<pre><code class="language-chartdown">` (what GFM and
 * markdown-it emit for ```chartdown fences), `<pre><code class="chartdown">`,
 * and `<pre class="chartdown">`. Render mode defaults to player (fail-closed);
 * `<script src=... data-mode="gm">` opts into the GM view page-wide.
 */

import { renderSource, type RenderMode } from "@chartdown/render-svg";

const script = document.currentScript as HTMLScriptElement | null;
const mode: RenderMode = script?.dataset["mode"] === "gm" ? "gm" : "player";
/** Optional page-wide theme document URL (spec 08 §5). */
const themeUrl = script?.dataset["theme"];
let themeSource: string | undefined;

function renderBlocks(): void {
  const nodes = document.querySelectorAll<HTMLElement>(
    "pre > code.language-chartdown, pre > code.chartdown, pre.chartdown",
  );
  for (const node of nodes) {
    const host = node.closest("pre") ?? node;
    const source = node.textContent ?? "";
    const { svg, diagnostics } = renderSource(source, themeSource ? { mode, theme: themeSource } : { mode });
    const figure = document.createElement("figure");
    figure.className = "chartdown";
    figure.innerHTML = svg;
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      const list = document.createElement("pre");
      list.className = "chartdown-errors";
      list.textContent = errors.map((d) => `line ${d.line}: ${d.message}`).join("\n");
      figure.append(list);
    }
    host.replaceWith(figure);
  }
}

function start(): void {
  if (themeUrl) {
    fetch(themeUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        themeSource = text;
      })
      .catch(() => undefined)
      .finally(renderBlocks);
  } else {
    renderBlocks();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
