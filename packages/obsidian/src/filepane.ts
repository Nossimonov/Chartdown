/**
 * The `.cd` file pane (#237): the map, with its source a toggle away.
 *
 * Pure DOM and injected side effects, exactly as `block.ts` is, so the part
 * worth getting right is testable without Obsidian. The Obsidian half —
 * claiming the extension, owning the save lifecycle — is `fileview.ts`, and
 * it is thin on purpose.
 *
 * The property this module exists to protect: **`source()` returns what the
 * user has typed**, not the last thing that was rendered. The view saves
 * whatever `source()` says, and a save can land between keystrokes, so a pane
 * that answered with its last render would silently write the previous text
 * over the edit being saved.
 */

import { mountChartdownBlock, type BlockIO } from "./block";
import type { RenderMode } from "./render";

export interface FilePaneOptions {
  initialSource: string;
  initialMode: RenderMode;
  /** File base for exports — a file has a name the author chose. */
  baseName: string;
  folderLabel: string;
  io: BlockIO;
  /** Sources of the files this document references (#246), already read. */
  imports?: { libraries: Record<string, string>; documents: Record<string, string> };
  /** Called whenever the source changes, so the host can request a save. */
  onChange(source: string): void;
}

export interface FilePane {
  /** The current source — the editor's text while editing, else the file's. */
  source(): string;
  /** Replace the source from outside (the file changed underneath us). */
  setSource(next: string): void;
  /** Whether the source pane is showing. */
  editing(): boolean;
  /** Show the map, or the source. */
  toggle(): void;
  /** Supply referenced files that arrived after mounting, and redraw (#246). */
  setImports(imports: { libraries: Record<string, string>; documents: Record<string, string> }): void;
}

export function mountChartdownFile(host: HTMLElement, opts: FilePaneOptions): FilePane {
  let source = opts.initialSource;
  let imports = opts.imports;
  let editing = false;
  let editor: HTMLTextAreaElement | null = null;

  host.empty();
  host.addClass("chartdown-file-view");
  const bar = host.createDiv({ cls: "chartdown-file-toolbar" });
  const toggle = bar.createEl("button", {
    attr: { title: "Switch between the rendered map and its Chartdown source" },
  });
  const body = host.createDiv({ cls: "chartdown-file-body" });

  const current = (): string => (editing && editor ? editor.value : source);

  const draw = (): void => {
    body.empty();
    toggle.setText(editing ? "Map" : "Source");
    if (editing) {
      editor = body.createEl("textarea", { cls: "chartdown-file-source" });
      editor.value = source;
      editor.spellcheck = false;
      editor.addEventListener("input", () => {
        source = editor!.value;
        opts.onChange(source);
      });
      return;
    }
    editor = null;
    mountChartdownBlock(source, body, {
      initialMode: opts.initialMode,
      ...(imports ? { imports } : {}),
      baseName: opts.baseName,
      folderLabel: opts.folderLabel,
      io: {
        ...opts.io,
        // In a note this edits between the fence markers; here the file IS the
        // block, so the paste half replaces the whole of it.
        replaceSource: async (next: string) => {
          source = next;
          opts.onChange(next);
          draw();
        },
      },
    });
  };

  toggle.addEventListener("click", () => {
    // Carry a pending edit across the switch, or toggling would revert it.
    if (editing && editor) source = editor.value;
    editing = !editing;
    draw();
  });

  draw();

  return {
    source: current,
    setSource: (next: string): void => {
      source = next;
      draw();
    },
    editing: (): boolean => editing,
    toggle: (): void => toggle.click(),
    setImports: (next): void => {
      imports = next;
      // An edit in flight outranks a late arrival: redrawing the map while
      // the source pane is open would throw away what is being typed.
      if (!editing) draw();
    },
  };
}
