// One-command version bump (#90): `npm run bump -- 0.4.0` rewrites EVERY
// surface the version lives on, so releasing never depends on remembering
// the list. The core test suite independently asserts all surfaces agree —
// the script is the easy way, the test is the enforcement.
//
// Surfaces: six packages/*/package.json (+ render-svg's pin on core),
// SPEC_VERSION in the parser (major.minor — the spec and packages version
// together), the digest and grammar headers (served publicly as
// llms-full.txt), the spec README status line, and the CHANGELOG (the
// [Unreleased] items roll into the new section with compare links).
// The Obsidian plugin's 0.1.x lane is deliberately separate.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("usage: npm run bump -- <x.y.z>");
  process.exit(1);
}

const PACKAGES = ["core", "render-svg", "cli", "browser", "mcp", "action"];
const read = (path) => readFileSync(path, "utf8");
const current = JSON.parse(read("packages/core/package.json").replace(/^﻿/, "")).version;
if (next === current) {
  console.error(`already at ${current} — nothing to do`);
  process.exit(1);
}
const spec = (v) => v.split(".").slice(0, 2).join(".");
const today = new Date().toISOString().slice(0, 10);

/** Replace exact text, byte-preserving everything else; loud when absent. */
function replaceIn(path, from, to, { optional = false } = {}) {
  const text = read(path);
  if (!text.includes(from)) {
    if (optional) return;
    console.error(`✗ ${path}: expected to find ${JSON.stringify(from)} — fix by hand, then re-run`);
    process.exit(1);
  }
  writeFileSync(path, text.split(from).join(to));
  console.log(`✓ ${path}`);
}

for (const name of PACKAGES) {
  replaceIn(`packages/${name}/package.json`, `"version": "${current}"`, `"version": "${next}"`);
}
replaceIn("packages/render-svg/package.json", `"@chartdown/core": "${current}"`, `"@chartdown/core": "${next}"`);
replaceIn("packages/core/src/parse.ts", `SPEC_VERSION = "${spec(current)}"`, `SPEC_VERSION = "${spec(next)}"`, { optional: spec(current) === spec(next) });
for (const artifact of ["docs/spec/digest.md", "docs/spec/grammar.ebnf", "docs/spec/README.md"]) {
  replaceIn(artifact, `spec v${spec(current)}`, `spec v${spec(next)}`, { optional: spec(current) === spec(next) });
}
replaceIn("README.md", `Spec v${spec(current)}`, `Spec v${spec(next)}`, { optional: spec(current) === spec(next) });
replaceIn("README.md", `@chartdown/browser@${spec(current)}`, `@chartdown/browser@${spec(next)}`, { optional: spec(current) === spec(next) });

// CHANGELOG: the [Unreleased] items become the new section; links follow.
const changelog = read("CHANGELOG.md");
if (/## \[Unreleased\]\s*\n## \[/.test(changelog)) {
  console.warn("⚠ CHANGELOG [Unreleased] is empty — the release gate requires a written section; add one before tagging");
}
replaceIn("CHANGELOG.md", "## [Unreleased]", `## [Unreleased]\n\n## [${next}] — ${today}`);
replaceIn(
  "CHANGELOG.md",
  `[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v${current}...HEAD`,
  `[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v${next}...HEAD\n[${next}]: https://github.com/Nossimonov/Chartdown/compare/v${current}...v${next}`,
);

execSync("npm install --package-lock-only", { stdio: "inherit" });
console.log(`\n${current} → ${next} on every surface. Review the diff (git diff), run npm test,`);
console.log(`commit, and after the PR merges to main: git tag v${next} && git push origin v${next}`);
