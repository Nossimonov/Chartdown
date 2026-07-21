/**
 * Obsidian plugin entry (issue #38): registers the `chartdown` code-block
 * processor and one setting — GM mode. Default is the player view, fail-closed
 * per spec 01 §6: secrets render only when the vault owner opts in.
 */

import { Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { renderChartdownBlock, type RenderMode } from "./render";

interface ChartdownSettings {
  mode: RenderMode;
}

const DEFAULT_SETTINGS: ChartdownSettings = { mode: "player" };

export default class ChartdownPlugin extends Plugin {
  settings: ChartdownSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<ChartdownSettings> | null) };
    this.registerMarkdownCodeBlockProcessor("chartdown", (source, el) => {
      renderChartdownBlock(source, el, this.settings.mode);
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
      .setName("GM mode")
      .setDesc(
        "Render GM secrets: hidden tokens, [gm] notes, and triggers. " +
          "Off, maps show the player view — secrets are stripped fail-closed. " +
          "Re-open affected notes after changing this.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mode === "gm").onChange(async (value) => {
          this.plugin.settings.mode = value ? "gm" : "player";
          await this.plugin.saveSettings();
        }),
      );
  }
}
