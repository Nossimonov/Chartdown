/**
 * Pure logic for the GitHub Action driver (issue #60): file discovery,
 * fence extraction, output naming, and the render/verify decision — all
 * SDK- and fs-callback-free so it tests as plain functions.
 */

import { parse } from "@chartdown/core";
import { renderSource, type RenderMode } from "@chartdown/render-svg";

export interface ActionOptions {
  mode: "player" | "gm" | "both";
  markdown: boolean;
  verify: boolean;
  theme?: string;
}

export interface RenderJob {
  /** Output path, relative to the scanned root. */
  outPath: string;
  svg: string;
}

export interface FileReport {
  path: string;
  errors: string[];
  jobs: RenderJob[];
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".obsidian", "dist"]);

export const shouldSkipDir = (name: string): boolean => SKIP_DIRS.has(name) || name.startsWith(".");

/** Theme and vocabulary documents are Chartdown but not maps — nothing to render. */
export const isMapDocument = (source: string): boolean => /^map\s*:/m.test(source);

/** ```chartdown fences in a Markdown document, in order. */
export function extractFences(markdown: string): string[] {
  const out: string[] = [];
  const re = /```chartdown[^\S\r\n]*\r?\n([\s\S]*?)```/g;
  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) out.push(m[1]!);
  return out;
}

const modesFor = (mode: ActionOptions["mode"]): RenderMode[] =>
  mode === "both" ? ["player", "gm"] : [mode];

const outName = (base: string, mode: RenderMode): string => `${base}${mode === "gm" ? "-gm" : ""}.svg`;

/** Render one .cd document to its sibling SVG(s). */
export function renderCdFile(path: string, source: string, opts: ActionOptions): FileReport {
  const base = path.replace(/\.cd$/, "");
  const report: FileReport = { path, errors: [], jobs: [] };
  for (const mode of modesFor(opts.mode)) {
    const options: Parameters<typeof renderSource>[1] = { mode };
    if (opts.theme !== undefined) options.theme = opts.theme;
    const { svg, diagnostics } = renderSource(source, options);
    for (const d of diagnostics) {
      if (d.severity === "error") report.errors.push(`${path}:${d.line}: ${d.message}`);
    }
    report.jobs.push({ outPath: outName(base, mode), svg });
  }
  return report;
}

/** Render every chartdown fence in a Markdown file to `<md-base>.<doc-id>.svg` beside it. */
export function renderMarkdownFile(path: string, markdown: string, opts: ActionOptions): FileReport {
  const report: FileReport = { path, errors: [], jobs: [] };
  const base = path.replace(/\.(md|markdown)$/i, "");
  const seen = new Map<string, number>();
  for (const source of extractFences(markdown)) {
    const docId = parse(source).document.docId;
    const n = (seen.get(docId) ?? 0) + 1;
    seen.set(docId, n);
    const suffix = n > 1 ? `-${n}` : "";
    for (const mode of modesFor(opts.mode)) {
      const options: Parameters<typeof renderSource>[1] = { mode };
      if (opts.theme !== undefined) options.theme = opts.theme;
      const { svg, diagnostics } = renderSource(source, options);
      for (const d of diagnostics) {
        if (d.severity === "error") report.errors.push(`${path} (fence ${docId}):${d.line}: ${d.message}`);
      }
      report.jobs.push({ outPath: outName(`${base}.${docId}${suffix}`, mode), svg });
    }
  }
  return report;
}
