/**
 * Obsidian plugin entry (issues #38/#41): registers the `chartdown`
 * code-block processor — each block mounts with a toolbar (GM/player toggle,
 * SVG and UVTT export) — and one setting: the DEFAULT view for newly
 * rendered blocks. Default player, fail-closed per spec 01 §6.
 */

import { Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { parse } from "@chartdown/core";
import { mountChartdownBlock } from "./block";
import type { RenderMode } from "./render";

interface ChartdownSettings {
  mode: RenderMode;
}

const DEFAULT_SETTINGS: ChartdownSettings = { mode: "player" };

/** Rasterize a region of an SVG to base64 PNG via an offscreen canvas. */
async function rasterize(
  svg: string,
  region: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize the map SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas available");
    ctx.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, outW, outH);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default class ChartdownPlugin extends Plugin {
  settings: ChartdownSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<ChartdownSettings> | null) };
    this.registerMarkdownCodeBlockProcessor("chartdown", (source, el, ctx) => {
      const slash = ctx.sourcePath.lastIndexOf("/");
      const folder = slash >= 0 ? ctx.sourcePath.slice(0, slash + 1) : "";
      mountChartdownBlock(source, el, {
        initialMode: this.settings.mode,
        baseName: parse(source).document.docId,
        io: {
          writeFile: async (name, contents) => {
            await this.app.vault.adapter.write(folder + name, contents);
          },
          notify: (message) => {
            new Notice(message);
          },
          rasterize,
        },
      });
    });
    this.addSettingTab(new ChartdownSettingTab(this.app, this));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class ChartdownSettingTab extends PluginSettingTab {
  private readonly plugin: ChartdownPlugin;

  constructor(app: App, plugin: ChartdownPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Default to GM view")
      .setDesc(
        "New map blocks start in GM view (hidden tokens, [gm] notes, triggers). " +
          "Each map also has its own toolbar toggle. Off, maps start as the " +
          "player view — secrets stripped fail-closed.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mode === "gm").onChange(async (value) => {
          this.plugin.settings.mode = value ? "gm" : "player";
          await this.plugin.saveSettings();
        }),
      );
  }
}
