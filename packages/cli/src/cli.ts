/**
 * The Chartdown CLI: `chartdown render map.cd -o map.svg` and
 * `chartdown check map.cd`. Diagnostics go to stderr, one per line,
 * `file:line: severity: message`. Exit codes: 0 clean, 1 the document
 * has errors (render still writes best-effort output), 2 bad usage.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkDetailSeams, checkInset, checkSource, documentKind, formatPoints, frameShape, parse, parsePoints } from "@chartdown/core";
import { render, type RenderMode } from "@chartdown/render-svg";

const USAGE = [
  "usage: chartdown render <file.cd> [-o out.svg] [--mode player|gm] [--theme theme.cd]",
  "       chartdown check <file.cd>",
  "       chartdown frame [--at <x,y>] <points…>    absolute trace -> anchored outline",
].join("\n");

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args[0];

// `frame` takes points rather than a file, so it is handled before the file
// argument is demanded (#174). Tracing a real coastline gives ABSOLUTE
// coordinates, and a framed outline wants offsets from the anchor — the
// subtraction is trivial and its mistakes are invisible, because a shape
// shifted by a constant is still a plausible island in the wrong place.
if (command === "frame") {
  let at: { x: number; y: number } | undefined;
  const rest: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--at") {
      const parsed = parsePoints(args[++i] ?? fail("missing value for --at"));
      if ("error" in parsed || parsed.length !== 1) fail(`--at wants one point, like --at 40,100`);
      at = parsed[0]!;
    } else rest.push(args[i]!);
  }
  const points = parsePoints(rest.join(" "));
  if ("error" in points) fail(points.error);
  if (points.length < 3) fail(`an outline needs at least three points (got ${points.length})`);
  const framed = frameShape(points, at);
  console.error(
    `${points.length} points, ${framed.extent.width} x ${framed.extent.height} across` +
    `${framed.derived ? " — anchor derived from the shape's centre" : ""}`,
  );
  console.log(`at (${framed.anchor.x},${framed.anchor.y}) area ${formatPoints(framed.offsets)}`);
  // THIS IS A FRAGMENT, NOT A PREDICATE (#368).
  //
  // The offsets are framed against a REFERENT — spec 05 §4's worked line is
  // `island whidbey : near shore at (40,100) area …`, and it is the `near shore`
  // that gives `at` a frame to be relative to. Pasted without a relation, the
  // offsets are read as absolute coordinates, so a negative one lands
  // off-canvas and `check` says nothing. A reporter did exactly that, following
  // this command's own output, and lost a shape into the north-west.
  //
  // Printed to stderr so the line above still pipes cleanly.
  console.error(
    `  paste after a relation, which is what the offsets are framed against:\n` +
    `    marsh m1 "Name" : near <ref> at (${framed.anchor.x},${framed.anchor.y}) area …   (spec 05 §4)`,
  );
  process.exit(0);
}

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

// A theme-sourced diagnostic's line number is a line of the THEME, so it must
// not be printed against the map's path — a reader sent to line 22 of the wrong
// file is worse served than by no diagnostic at all (#116).
const where = (d: { source?: string }): string => (d.source === "theme" && themePath ? themePath : file);

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
// A child declares its parent with `inset: <doc> at <entity>` (#143), so the
// seam is checkable from either end — a map is the sum of its files (ADR 0021).
for (const header of parse(source).document.header) {
  if (header.key !== "inset") continue;
  const parentPath = resolve(dirname(file), header.value.split(/\s+at\s+/)[0]!.trim());
  if (existsSync(parentPath)) details[header.value.split(/\s+at\s+/)[0]!.trim()] = readFileSync(parentPath, "utf8");
}
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
    const seams = [...checkDetailSeams(source, { libraries, documents: details }), ...checkInset(source, { libraries, documents: details })];
    const rendered = render(parsed.document, themeSources.length > 0 ? { mode: "gm", theme: themeSources } : { mode: "gm" });
    checkDiagnostics = [...parsed.diagnostics, ...rendered.diagnostics, ...seams];
  } else {
    checkDiagnostics = checkSource(source, { libraries }).diagnostics;
  }
  for (const d of checkDiagnostics) console.error(`${where(d)}:${d.line}: ${d.severity}: ${d.message}`);
  const invalid = checkDiagnostics.some((d) => d.severity === "error");
  console.error(invalid ? "invalid" : `ok (${kind} document)`);
  process.exit(invalid ? 1 : 0);
}

const { document, diagnostics } = parse(source, { libraries });
for (const d of diagnostics) console.error(`${where(d)}:${d.line}: ${d.severity}: ${d.message}`);
const hasErrors = diagnostics.some((d) => d.severity === "error");

const { svg, diagnostics: renderDiagnostics } = render(
  document,
  themeSources.length > 0 ? { mode, theme: themeSources } : { mode },
);
for (const d of renderDiagnostics) console.error(`${where(d)}:${d.line}: ${d.severity}: ${d.message}`);
const outPath = out ?? `${file.replace(/\.cd$/, "")}.svg`;
writeFileSync(outPath, svg);
console.error(`${hasErrors ? "rendered with errors" : "rendered"}: ${outPath}`);
process.exit(hasErrors ? 1 : 0);
