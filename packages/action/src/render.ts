/**
 * GitHub Action driver (issue #60): walk the repo, render every .cd file
 * (and chartdown fences in Markdown) to sibling SVGs. `verify` mode renders
 * and DIFFS instead of writing — CI fails when committed SVGs drift from
 * their sources, which is how the Chartdown repo dogfoods its own Action.
 *
 * Inputs arrive as INPUT_* env vars from the composite action. Exit codes:
 * 0 clean, 1 render errors or (verify) drift.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMapDocument, renderCdFile, renderMarkdownFile, shouldSkipDir, type ActionOptions, type FileReport } from "./lib";

const env = (name: string, fallback: string): string => process.env[`INPUT_${name}`]?.trim() || fallback;

const root = env("ROOT", ".");
const opts: ActionOptions = {
  mode: (["player", "gm", "both"].includes(env("MODE", "player")) ? env("MODE", "player") : "player") as ActionOptions["mode"],
  markdown: env("MARKDOWN", "true") !== "false",
  verify: env("VERIFY", "false") === "true",
};
const themePath = env("THEME", "");
if (themePath) opts.theme = readFileSync(themePath, "utf8");

const files: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!shouldSkipDir(entry)) walk(full);
    } else if (/\.cd$/.test(entry) || (opts.markdown && /\.(md|markdown)$/i.test(entry))) {
      files.push(full);
    }
  }
};
walk(root);

let rendered = 0;
let unchanged = 0;
const errors: string[] = [];
const drift: string[] = [];

let skipped = 0;
for (const path of files) {
  const content = readFileSync(path, "utf8");
  if (/\.cd$/.test(path) && !isMapDocument(content)) {
    skipped++; // theme or vocabulary document — Chartdown, but not a map
    continue;
  }
  const report: FileReport = /\.cd$/.test(path)
    ? renderCdFile(path, content, opts)
    : renderMarkdownFile(path, content, opts);
  errors.push(...report.errors);
  for (const job of report.jobs) {
    const existing = existsSync(job.outPath) ? readFileSync(job.outPath, "utf8") : null;
    if (existing === job.svg) {
      unchanged++;
      continue;
    }
    if (opts.verify) {
      drift.push(job.outPath);
    } else {
      writeFileSync(job.outPath, job.svg);
      rendered++;
    }
  }
}

console.log(
  `chartdown: ${files.length} source file(s) scanned, ${rendered} SVG(s) written, ${unchanged} up to date` +
    (skipped > 0 ? `, ${skipped} non-map document(s) skipped` : ""),
);
if (errors.length > 0) {
  console.error(`\n${errors.length} render error(s):`);
  for (const e of errors) console.error(`  ${e}`);
}
if (drift.length > 0) {
  console.error(`\n${drift.length} committed SVG(s) drift from their sources (re-render and commit):`);
  for (const d of drift) console.error(`  ${d}`);
}
process.exit(errors.length > 0 || drift.length > 0 ? 1 : 0);
