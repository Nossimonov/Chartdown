/**
 * Obsidian plugin entry (issues #38/#41): registers the `chartdown`
 * code-block processor — each block mounts with a toolbar (GM/player toggle,
 * SVG and UVTT export) — and one setting: the DEFAULT view for newly
 * rendered blocks. Default player, fail-closed per spec 01 §6.
 */

import { Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type SettingDefinitionItem } from "obsidian";
import { parse } from "@chartdown/core";
import { mountChartdownBlock, type BlockIO } from "./block";
import { ChartdownFileView, CHARTDOWN_VIEW_TYPE } from "./fileview";
import { resolveImports, resolveVaultPath, type VaultReader } from "./imports";
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
    const canvas = createEl("canvas");
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

/**
 * Clipboard presence WITHOUT reading content: Electron's availableFormats()
 * is metadata only (reading a user's clipboard uninvited is bad manners —
 * the paste flow reads it exactly once, on an explicit click). Mobile has no
 * Electron; resolve true so the button never disables on a guess.
 */
async function clipboardHasText(): Promise<boolean> {
  try {
    const electron = (window as unknown as { require?: (m: string) => { clipboard?: { availableFormats(): string[] } } }).require?.("electron");
    const formats = electron?.clipboard?.availableFormats();
    if (formats) return formats.some((f) => f.startsWith("text/"));
  } catch {
    // fall through — unknowable here
  }
  return true;
}

export default class ChartdownPlugin extends Plugin {
  settings: ChartdownSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    const raw: unknown = await this.loadData();
    const mode = raw !== null && typeof raw === "object" ? (raw as { mode?: unknown }).mode : undefined;
    this.settings = { mode: mode === "gm" ? "gm" : "player" };
    // A `.cd` file opens to its map (#237). The plugin claimed no extension
    // before this, so the language's own file type could not be opened in the
    // one place a GM keeps their campaign. Registering the view claims `.cd`
    // for the vault while the plugin is enabled.
    this.registerView(CHARTDOWN_VIEW_TYPE, (leaf) => new ChartdownFileView(leaf, {
      mode: () => this.settings.mode,
      io: (folder) => this.blockIo(folder),
      imports: (source, folder) => resolveImports(source, folder, this.vaultReader()),
    }));
    this.registerExtensions(["cd"], CHARTDOWN_VIEW_TYPE);

    this.registerMarkdownCodeBlockProcessor("chartdown", async (source, el, ctx) => {
      const slash = ctx.sourcePath.lastIndexOf("/");
      const folder = slash >= 0 ? ctx.sourcePath.slice(0, slash + 1) : "";
      // Read what the document references BEFORE rendering (#246). The
      // processor may return a promise, which is what makes this possible
      // here; the file view has to load and redraw instead.
      const imports = await resolveImports(source, folder, this.vaultReader());
      mountChartdownBlock(source, el, {
        imports,
        initialMode: this.settings.mode,
        baseName: parse(source).document.docId,
        folderLabel: folder,
        io: {
          ...this.blockIo(folder),
          replaceSource: async (newSource) => {
            // The processor's section info maps this block back to its fence
            // lines; replace strictly BETWEEN the markers so the fence itself
            // (and everything else in the note) is untouched.
            const info = ctx.getSectionInfo(el);
            const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            if (!info || !(file instanceof TFile)) {
              new Notice("Chartdown: couldn't locate this block in its note — reopen the note and try again.", 8000);
              return;
            }
            await this.app.vault.process(file, (data) => {
              const lines = data.split("\n");
              return [...lines.slice(0, info.lineStart + 1), ...newSource.split("\n"), ...lines.slice(info.lineEnd)].join("\n");
            });
          },
        },
      });
    });
    this.addSettingTab(new ChartdownSettingTab(this.app, this));
  }

  /**
   * Vault-side path resolution for `use:` and `inset:` (#246). Kept behind the
   * same injected-side-effect shape as everything else here, so the resolution
   * itself tests without Obsidian.
   */
  private vaultReader(): VaultReader {
    return {
      read: async (folder, relative) => {
        const path = resolveVaultPath(folder, relative);
        try {
          if (!(await this.app.vault.adapter.exists(path))) return null;
          return await this.app.vault.adapter.read(path);
        } catch {
          return null; // unreadable is indistinguishable from absent, and warns the same way
        }
      },
    };
  }

  /**
   * Everything a mounted map may do to the vault, minus `replaceSource` —
   * the one side effect that genuinely differs, since a fence edits between
   * its own markers while a `.cd` file IS the block. Shared so the two
   * mounting points cannot drift into offering different affordances.
   */
  private blockIo(folder: string): BlockIO {
    return {
      writeFile: async (name, contents) => {
        await this.app.vault.adapter.write(folder + name, contents);
      },
      notify: (message) => {
        new Notice(message, 8000);
      },
      copy: async (text) => {
        await navigator.clipboard.writeText(text);
      },
      readClipboard: async () => navigator.clipboard.readText(),
      clipboardHasText,
      reveal: (name) => {
        // Desktop API; opens the system file explorer with the file
        // selected — the "get it out as a file" affordance.
        (this.app as unknown as { showInFolder?: (path: string) => void }).showInFolder?.(folder + name);
      },
      rasterize,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

const GM_MODE_DESC =
  "New map blocks start in GM view (hidden tokens, [gm] notes, triggers). " +
  "Each map also has its own toolbar toggle. Off, maps start as the " +
  "player view — secrets stripped fail-closed.";

class ChartdownSettingTab extends PluginSettingTab {
  private readonly plugin: ChartdownPlugin;

  constructor(app: App, plugin: ChartdownPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Declarative settings (Obsidian 1.13+): renders the tab AND indexes the
  // setting for the global settings search.
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Default to GM view",
        desc: GM_MODE_DESC,
        aliases: ["gm", "player", "secrets", "hidden"],
        control: { type: "toggle", key: "gm-mode", defaultValue: false },
      },
    ];
  }

  override getControlValue(key: string): unknown {
    return key === "gm-mode" ? this.plugin.settings.mode === "gm" : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "gm-mode") return;
    this.plugin.settings.mode = value === true ? "gm" : "player";
    await this.plugin.saveSettings();
  }

  // Fallback for Obsidian < 1.13 (minAppVersion is 1.5.0); ignored on 1.13+
  // where the definitions above render the tab.
  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Default to GM view")
      .setDesc(GM_MODE_DESC)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mode === "gm").onChange(async (value) => {
          this.plugin.settings.mode = value ? "gm" : "player";
          await this.plugin.saveSettings();
        }),
      );
  }
}
