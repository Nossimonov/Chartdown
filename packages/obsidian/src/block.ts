/**
 * The per-map block UI (issue #41): a toolbar — GM/player toggle that
 * re-renders in place, SVG export, UVTT export (one .dd2vtt per level) —
 * above the rendered map. All side effects (writing files, notices, raster)
 * arrive injected through BlockIO, so this whole module tests against a
 * plain DOM.
 */

import { parse } from "@chartdown/core";
import { exportUvttSource, renderSource } from "@chartdown/render-svg";
import { renderChartdownBlock, type RenderMode } from "./render";

export interface BlockIO {
  /** Write a text file next to the note; overwrite silently. */
  writeFile(name: string, contents: string): Promise<void>;
  notify(message: string): void;
  /** Reveal an exported file in the system file explorer (desktop only). */
  reveal?(name: string): void;
  /** Rasterize `region` of an SVG to a base64 PNG (no data-URI prefix). */
  rasterize?(svg: string, region: { x: number; y: number; w: number; h: number }, outW: number, outH: number): Promise<string>;
}

export interface BlockOptions {
  initialMode: RenderMode;
  /** File base for exports, normally the map's doc id. */
  baseName: string;
  /** Vault-relative folder exports land in ("" = vault root) — notices say where. */
  folderLabel: string;
  io: BlockIO;
}

const PIXELS_PER_GRID = 70;

export function mountChartdownBlock(source: string, el: HTMLElement, opts: BlockOptions): void {
  let mode: RenderMode = opts.initialMode;

  const wrapper = el.createDiv({ cls: "chartdown-block" });
  const toolbar = wrapper.createDiv({ cls: "chartdown-toolbar" });
  const modeBtn = toolbar.createEl("button", { cls: "chartdown-mode-toggle" });
  const svgBtn = toolbar.createEl("button", { text: "Export SVG" });
  const uvttBtn = toolbar.createEl("button", { text: "Export UVTT" });
  const mapHost = wrapper.createDiv({ cls: "chartdown-map-host" });

  const rerender = (): void => {
    mapHost.empty();
    renderChartdownBlock(source, mapHost, mode);
    modeBtn.textContent = mode === "gm" ? "GM view" : "Player view";
    modeBtn.setAttribute("aria-pressed", String(mode === "gm"));
  };

  modeBtn.addEventListener("click", () => {
    mode = mode === "gm" ? "player" : "gm";
    rerender();
  });

  svgBtn.addEventListener("click", () => {
    void (async () => {
      const { svg } = renderSource(source, { mode });
      const name = `${opts.baseName}${mode === "gm" ? "-gm" : ""}.svg`;
      await opts.io.writeFile(name, svg);
      opts.io.notify(`Chartdown: exported ${opts.folderLabel}${name} (a real file in your vault folder)`);
      opts.io.reveal?.(name);
    })();
  });

  uvttBtn.addEventListener("click", () => {
    void (async () => {
      const parsed = parse(source).document;
      const levels = parsed.levels.length > 0 ? parsed.levels : [""];
      for (const level of levels) {
        const result = exportUvttSource(source, {
          mode,
          ...(level ? { level } : {}),
          pixelsPerGrid: PIXELS_PER_GRID,
        });
        if (!result.uvtt) {
          const error = result.diagnostics.find((d) => d.severity === "error");
          opts.io.notify(`Chartdown: ${error?.message ?? "UVTT export failed"}`);
          return;
        }
        if (opts.io.rasterize && result.svg && result.imageRegion) {
          const size = (result.uvtt["resolution"] as { map_size: { x: number; y: number } }).map_size;
          result.uvtt["image"] = await opts.io.rasterize(
            result.svg,
            result.imageRegion,
            size.x * PIXELS_PER_GRID,
            size.y * PIXELS_PER_GRID,
          );
        }
        const name = `${opts.baseName}${level ? `-${level}` : ""}.dd2vtt`;
        await opts.io.writeFile(name, JSON.stringify(result.uvtt));
        // Obsidian's file explorer hides unknown extensions — the file is
        // real but invisible in-app, so say where it went and reveal it.
        opts.io.notify(`Chartdown: exported ${opts.folderLabel}${name} (hidden in Obsidian's explorer; it's in your vault folder)`);
        opts.io.reveal?.(name);
      }
    })();
  });

  rerender();
}
