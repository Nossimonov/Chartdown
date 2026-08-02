/**
 * The `.cd` file view (#237): Obsidian glue, deliberately thin.
 *
 * The plugin registered only a markdown code-block processor, so it handled a
 * fence inside a note and nothing else. No view claimed the `.cd` extension,
 * which left the language's own file type unopenable in the one place a GM
 * keeps their campaign — the same shape as #225, where nothing malfunctioned
 * because nothing was ever invoked.
 *
 * `TextFileView` owns the save lifecycle: Obsidian calls `getViewData` when it
 * decides to write and `setViewData` when the file changes underneath us, so
 * nothing here tracks dirtiness. Everything worth testing lives in
 * `filepane.ts`, which needs no Obsidian to run.
 */

import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { mountChartdownFile, type FilePane } from "./filepane";
import type { BlockIO } from "./block";
import type { RenderMode } from "./render";

export const CHARTDOWN_VIEW_TYPE = "chartdown-map";

export interface FileViewDeps {
  /** The default render mode, from settings — player unless told otherwise. */
  mode(): RenderMode;
  /** Block side effects, scoped to the folder this file lives in. */
  io(folder: string): BlockIO;
}

export class ChartdownFileView extends TextFileView {
  private deps: FileViewDeps;
  private pane: FilePane | null = null;

  constructor(leaf: WorkspaceLeaf, deps: FileViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return CHARTDOWN_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Chartdown map";
  }

  override getIcon(): string {
    return "map";
  }

  /** What gets written: the pane's live text, never the last render. */
  override getViewData(): string {
    return this.pane?.source() ?? this.data;
  }

  override setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (clear || !this.pane) this.mount();
    else this.pane.setSource(data);
  }

  override clear(): void {
    this.data = "";
    this.pane?.setSource("");
  }

  override async onOpen(): Promise<void> {
    this.mount();
  }

  private mount(): void {
    const path = this.file?.path ?? "";
    const slash = path.lastIndexOf("/");
    const folder = slash >= 0 ? path.slice(0, slash + 1) : "";
    this.pane = mountChartdownFile(this.contentEl, {
      initialSource: this.data,
      initialMode: this.deps.mode(),
      // A file already carries a name the author chose, so exports take it
      // rather than the doc id: sunless-hollow.cd writes sunless-hollow.svg,
      // beside the source it came from.
      baseName: this.file?.basename ?? "map",
      folderLabel: folder,
      io: this.deps.io(folder),
      onChange: (source) => {
        this.data = source;
        this.requestSave();
      },
    });
  }
}
