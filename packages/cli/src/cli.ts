/**
 * The Chartdown CLI: `chartdown render map.cd -o map.svg` and
 * `chartdown check map.cd`. Diagnostics go to stderr, one per line,
 * `file:line: severity: message`. Exit codes: 0 clean, 1 the document
 * has errors (render still writes best-effort output), 2 bad usage.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkDetailSeams, checkSource, documentKind, parse } from "@chartdown/core";
import { render, type RenderMode } from "@chartdown/render-svg";

const USAGE = [
  "usage: chartdown render <file.cd> [-o out.svg] [--mode player|gm] [--theme theme.cd]",
  "       chartdown check <file.cd>",
].join("\n");

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args[0];
if (command !== "render" && command !== "check") fail(`unknown command '${command ?? ""}'`);
const file = args[1] ?? fail("missing input file");

let out: string | null = null;
let mode: RenderMode = "player";
let themePath: string | null = null;
for (let i = 2; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "-o" || arg === "--out") out = args[++i] ?? fail("missing value for -o");
  else if (arg === "--mode") {
    const value = args[++i];
    if (value !== "player" && value !== "gm") fail("--mode must be player or gm");
    mode = value;
  } else if (arg === "--theme") themePath = args[++i] ?? fail("missing value for --theme");
  else fail(`unknown option '${arg}'`);
}

// Theme sources (spec 08 §5): the theme file plus its use: imports from disk,
// in order ('default' is implicit and skipped — the renderer always layers it first).
const themeSources: string[] = [];
if (themePath) {
  const themeSource = readFileSync(themePath, "utf8");
  for (const match of themeSource.matchAll(/^use:\s*(.+?)\s*(?:;.*)?$/gm)) {
    const value = match[1]!.trim();
    if (value === "default") continue;
    const usePath = resolve(dirname(themePath), value);
    if (existsSync(usePath)) themeSources.push(readFileSync(usePath, "utf8"));
    else console.error(`${themePath}: warning: theme import '${value}' not found`);
  }
  themeSources.push(themeSource);
}

const source = readFileSync(file, "utf8");

// First parse discovers use: libraries; load them from disk relative to the document.
const libraries: Record<string, string> = {};
for (const header of parse(source).document.header) {
  if (header.key === "use") {
    const libraryPath = resolve(dirname(file), header.value);
    if (existsSync(libraryPath)) libraries[header.value] = readFileSync(libraryPath, "utf8");
  }
}

// `detail=` sub-maps, loaded the same way, so the seam between two documents
// can be checked (#109). Only supplied for `check`: rendering a parent has
// never needed the child, and reading files the render does not use would make
// a render fail on a missing sub-map that does not affect its output.
const details: Record<string, string> = {};
for (const section of parse(source).document.sections) {
  for (const entry of section.entries) {
    if (entry.kind !== "entity") continue;
    const value = entry.pairs.find((p) => p.key === "detail")?.value;
    if (value === undefined) continue;
    const detailPath = resolve(dirname(file), value);
    if (existsSync(detailPath)) details[value] = readFileSync(detailPath, "utf8");
  }
}

// `check` validates whichever KIND of document this is (#102): a vocabulary
// and a theme need no `map:` (spec 04 §2, spec 08 §1), and validating them
// against the map rules discarded them wholesale.
if (command === "check") {
  const kind = documentKind(source);
  let checkDiagnostics;
  if (kind === "map") {
    // A map is also RENDERED (output discarded) so render-side diagnostics
    // are reachable from check (#120) — otherwise the command authors and CI
    // run reports `ok` for a document containing lines the renderer drops.
    // GM mode, so nothing is skipped.
    const parsed = parse(source, { libraries });
    const seams = checkDetailSeams(source, { libraries, details });
    const rendered = render(parsed.document, themeSources.length > 0 ? { mode: "gm", theme: themeSources } : { mode: "gm" });
    checkDiagnostics = [...parsed.diagnostics, ...rendered.diagnostics, ...seams];
  } else {
    checkDiagnostics = checkSource(source, { libraries }).diagnostics;
  }
  for (const d of checkDiagnostics) console.error(`${file}:${d.line}: ${d.severity}: ${d.message}`);
  const invalid = checkDiagnostics.some((d) => d.severity === "error");
  console.error(invalid ? "invalid" : `ok (${kind} document)`);
  process.exit(invalid ? 1 : 0);
}

const { document, diagnostics } = parse(source, { libraries });
for (const d of diagnostics) console.error(`${file}:${d.line}: ${d.severity}: ${d.message}`);
const hasErrors = diagnostics.some((d) => d.severity === "error");

const { svg, diagnostics: renderDiagnostics } = render(
  document,
  themeSources.length > 0 ? { mode, theme: themeSources } : { mode },
);
for (const d of renderDiagnostics) console.error(`${file}:${d.line}: ${d.severity}: ${d.message}`);
const outPath = out ?? `${file.replace(/\.cd$/, "")}.svg`;
writeFileSync(outPath, svg);
console.error(`${hasErrors ? "rendered with errors" : "rendered"}: ${outPath}`);
process.exit(hasErrors ? 1 : 0);
