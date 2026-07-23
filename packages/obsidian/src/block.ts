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
  /** Put text on the system clipboard. */
  copy?(text: string): Promise<void>;
  /** Read the system clipboard as text. */
  readClipboard?(): Promise<string>;
  /**
   * Whether the clipboard currently holds text — determined WITHOUT reading
   * the content (format metadata only). Resolve true when unknowable: never
   * disable the button on a guess.
   */
  clipboardHasText?(): Promise<boolean>;
  /** Replace this block's source lines in the note (between the fence markers). */
  replaceSource?(newSource: string): Promise<void>;
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

/**
 * Copied source leads with a `;` comment breadcrumb (#88): valid Chartdown,
 * invisible to renders — but a reader who pastes the map anywhere else (an
 * LLM chat included) gets pointed at what the text is and where the language
 * reference lives, without the plugin bundling or pushing anything.
 */
const SOURCE_BREADCRUMB = [
  "; Chartdown map (plain-text TTRPG map language)",
  "; language reference: https://nossimonov.github.io/Chartdown/llms-full.txt",
].join("\n");

/**
 * Clipboard → source (#88, the paste half of the round trip): accept either
 * bare Chartdown or an LLM reply wrapping it in a ```chartdown fence, and
 * strip a leading copy of our own breadcrumb so repeated copy→chat→paste
 * loops don't stack comment headers.
 */
export function chartdownFromClipboard(text: string): string {
  const fence = /```chartdown[^\S\r\n]*\r?\n([\s\S]*?)```/.exec(text);
  const lines = (fence ? fence[1]! : text).replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && (lines[0]!.startsWith("; Chartdown map") || lines[0]!.startsWith("; language reference:"))) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

export function mountChartdownBlock(source: string, el: HTMLElement, opts: BlockOptions): void {
  let mode: RenderMode = opts.initialMode;

  const wrapper = el.createDiv({ cls: "chartdown-block" });
  const toolbar = wrapper.createDiv({ cls: "chartdown-toolbar" });
  const modeBtn = toolbar.createEl("button", { cls: "chartdown-mode-toggle" });
  const svgBtn = toolbar.createEl("button", { text: "Export SVG" });
  const uvttBtn = toolbar.createEl("button", { text: "Export UVTT" });
  const copyBtn = toolbar.createEl("button", {
    text: "Copy Chartdown",
    attr: { title: "Copy this map's Chartdown source, headed by a comment pointing at the language reference" },
  });
  const pasteBtn = toolbar.createEl("button", {
    text: "Paste Chartdown",
    attr: { title: "Replace this map with Chartdown from your clipboard (validated first; a bare document or a ```chartdown fence both work)" },
  });
  const mapHost = wrapper.createDiv({ cls: "chartdown-map-host" });

  // Empty clipboard → grayed paste button. The check is format-metadata only
  // (never the content), and it re-runs at the moments the answer can have
  // changed: mount, hovering back onto the toolbar, and after our own copy.
  const syncPasteState = (): void => {
    void (async () => {
      const has = (await opts.io.clipboardHasText?.()) ?? true;
      pasteBtn.disabled = !has;
    })();
  };
  toolbar.addEventListener("mouseenter", syncPasteState);
  syncPasteState();

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

  copyBtn.addEventListener("click", () => {
    void (async () => {
      await opts.io.copy?.(`${SOURCE_BREADCRUMB}\n${source}${source.endsWith("\n") ? "" : "\n"}`);
      opts.io.notify("Chartdown: map source on your clipboard.");
      syncPasteState();
    })();
  });

  pasteBtn.addEventListener("click", () => {
    void (async () => {
      const clip = (await opts.io.readClipboard?.()) ?? "";
      const next = chartdownFromClipboard(clip);
      if (!next) {
        opts.io.notify("Chartdown: clipboard is empty — nothing changed.");
        return;
      }
      // Validation gates the write: a paste can never leave the note holding
      // a document its own renderer rejects.
      const errors = parse(next).diagnostics.filter((d) => d.severity === "error");
      if (errors.length > 0) {
        const first = errors[0]!;
        opts.io.notify(`Chartdown: clipboard isn't a valid map — line ${first.line}: ${first.message} — nothing changed.`);
        return;
      }
      await opts.io.replaceSource?.(next);
      opts.io.notify("Chartdown: map source replaced from clipboard.");
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
