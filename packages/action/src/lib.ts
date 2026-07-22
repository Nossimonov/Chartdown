/**
 * Pure logic for the GitHub Action driver (issue #60): file discovery,
 * fence extraction, output naming, and the render/verify decision — all
 * SDK- and fs-callback-free so it tests as plain functions.
 */

import { parse } from "@chartdown/core";
import { readProvenance, renderSource, stampProvenance, type RenderMode } from "@chartdown/render-svg";

export interface ActionOptions {
  mode: "player" | "gm" | "both";
  markdown: boolean;
  verify: boolean;
  theme?: string;
}

/** One canonical spelling per path — forward slashes on every OS. */
export const normalizePath = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

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
  const docId = parse(source).document.docId;
  for (const mode of modesFor(opts.mode)) {
    const options: Parameters<typeof renderSource>[1] = { mode };
    if (opts.theme !== undefined) options.theme = opts.theme;
    const { svg, diagnostics } = renderSource(source, options);
    for (const d of diagnostics) {
      if (d.severity === "error") report.errors.push(`${path}:${d.line}: ${d.message}`);
    }
    const outPath = outName(base, mode);
    report.jobs.push({
      outPath,
      svg: stampProvenance(svg, { source: normalizePath(path), docId, mode, output: normalizePath(outPath) }),
    });
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
      const outPath = outName(`${base}.${docId}${suffix}`, mode);
      report.jobs.push({
        outPath,
        svg: stampProvenance(svg, { source: normalizePath(path), docId, mode, output: normalizePath(outPath) }),
      });
    }
  }
  return report;
}

export interface OrphanReport {
  /** Marker-confirmed orphans (the #78 three-condition test) — safe to delete. */
  orphans: string[];
  /** Unmarked files that merely LOOK derived from a scanned source — warn-only, never deleted. */
  suspects: string[];
}

/**
 * The three-condition orphan test (#78): delete only what (1) bears the
 * provenance marker, (2) still sits at the path the marker recorded — a
 * hand-carried copy fails this and survives as a deliberate snapshot — and
 * (3) no job in the current scan produces. Name-pattern inference never
 * deletes anything: a hand-made SVG sharing a source's name is exactly the
 * file this gate exists to protect.
 */
export function findOrphans(
  svgs: ReadonlyArray<{ path: string; content: string }>,
  producedPaths: ReadonlySet<string>,
  sourcePaths: ReadonlySet<string>,
): OrphanReport {
  // Case-folded comparison: Windows checkouts disagree on case, not identity.
  const fold = (p: string): string => normalizePath(p).toLowerCase();
  const produced = new Set([...producedPaths].map(fold));
  const sources = new Set([...sourcePaths].map(fold));
  const report: OrphanReport = { orphans: [], suspects: [] };
  for (const f of svgs) {
    if (produced.has(fold(f.path))) continue; // a live output
    const marker = readProvenance(f.content);
    if (marker) {
      if (fold(marker.output) === fold(f.path)) report.orphans.push(f.path);
    } else if (looksDerived(fold(f.path), sources)) {
      report.suspects.push(f.path);
    }
  }
  return report;
}

/** Pre-marker legacy heuristic: unmarked output tied to a STILL-SCANNED source (mode change, fence rename). */
function looksDerived(foldedPath: string, foldedSources: ReadonlySet<string>): boolean {
  const base = foldedPath.replace(/\.svg$/, "").replace(/-gm$/, "");
  if (foldedSources.has(`${base}.cd`)) return true;
  const dot = base.lastIndexOf(".");
  if (dot > base.lastIndexOf("/")) {
    const mdBase = base.slice(0, dot);
    return foldedSources.has(`${mdBase}.md`) || foldedSources.has(`${mdBase}.markdown`);
  }
  return false;
}
