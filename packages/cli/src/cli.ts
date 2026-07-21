/**
 * The Chartdown CLI: `chartdown render map.cd -o map.svg` and
 * `chartdown check map.cd`. Diagnostics go to stderr, one per line,
 * `file:line: severity: message`. Exit codes: 0 clean, 1 the document
 * has errors (render still writes best-effort output), 2 bad usage.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "@chartdown/core";
import { render, type RenderMode } from "@chartdown/render-svg";

const USAGE = [
  "usage: chartdown render <file.cd> [-o out.svg] [--mode player|gm]",
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
for (let i = 2; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "-o" || arg === "--out") out = args[++i] ?? fail("missing value for -o");
  else if (arg === "--mode") {
    const value = args[++i];
    if (value !== "player" && value !== "gm") fail("--mode must be player or gm");
    mode = value;
  } else fail(`unknown option '${arg}'`);
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

const { document, diagnostics } = parse(source, { libraries });
for (const d of diagnostics) console.error(`${file}:${d.line}: ${d.severity}: ${d.message}`);
const hasErrors = diagnostics.some((d) => d.severity === "error");

if (command === "check") {
  console.error(hasErrors ? "invalid" : "ok");
  process.exit(hasErrors ? 1 : 0);
}

const svg = render(document, { mode });
const outPath = out ?? `${file.replace(/\.cd$/, "")}.svg`;
writeFileSync(outPath, svg);
console.error(`${hasErrors ? "rendered with errors" : "rendered"}: ${outPath}`);
process.exit(hasErrors ? 1 : 0);
