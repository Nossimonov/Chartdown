// One-command version bump (#90): `npm run bump -- 0.4.0` rewrites EVERY
// surface the version lives on, so releasing never depends on remembering
// the list. The core test suite independently asserts all surfaces agree —
// the script is the easy way, the test is the enforcement.
//
// Surfaces: seven packages/*/package.json (+ render-svg's pin on core),
// SPEC_VERSION in the parser (major.minor — the spec and packages version
// together), the digest and grammar headers (served publicly as
// llms-full.txt), the spec README status line, and the CHANGELOG (the
// [Unreleased] items roll into the new section with compare links).
// The Obsidian plugin versions on its own lane, deliberately.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { refuseBump } from "./release-guards.mjs";

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("usage: npm run bump -- <x.y.z>");
  process.exit(1);
}

const PACKAGES = ["core", "render-svg", "cli", "browser", "mcp", "measure", "action"];
const read = (path) => readFileSync(path, "utf8");
const current = JSON.parse(read("packages/core/package.json").replace(/^﻿/, "")).version;
if (next === current) {
  console.error(`already at ${current} — nothing to do`);
  process.exit(1);
}
const spec = (v) => v.split(".").slice(0, 2).join(".");
const today = new Date().toISOString().slice(0, 10);

// THE CHANGELOG GATE, AND IT RUNS BEFORE ANYTHING IS REWRITTEN. 0.4.0 shipped
// with ONE bullet for 117 commits: the section had been written onto the wrong
// branch, `git push origin preview` reported success for a no-op because it
// pushes that REF rather than HEAD, and the old check — which only asked
// whether [Unreleased] was EMPTY — saw one bullet and passed. Thin notes are
// the same failure as absent ones, and thin is the one that gets through.
//
// Measured against the commits since the last tag, because "enough" is not a
// constant: a three-commit patch needs less than a hundred-commit phase.
// Ahead of every replaceIn, so a refusal never leaves the tree half-bumped.
{
  const changelog = read("CHANGELOG.md");
  const head = changelog.indexOf("## [Unreleased]");
  const section = changelog.slice(head + "## [Unreleased]".length, changelog.indexOf("## [", head + 5));
  const bullets = (section.match(/^- /gm) ?? []).length;
  let commits = 0;
  try {
    const lastTag = execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim();
    commits = Number(execSync(`git rev-list --count ${lastTag}..HEAD`, { encoding: "utf8" }).trim());
  } catch {
    commits = 0; // no tags yet, or not a checkout — the floor of 1 still applies
  }
  const wanted = Math.max(1, Math.min(12, Math.ceil(commits / 12)));
  if (bullets < wanted) {
    console.error(
      `\u2717 CHANGELOG [Unreleased] has ${bullets} bullet(s) for ${commits} commit(s) since the last tag.`,
    );
    console.error("  A release nobody can read is a release nobody can adopt — write the section, then bump.");
    console.error(`  (This check wants at least ${wanted}. Nothing has been modified.)`);
    process.exit(1);
  }

  // THE BREAKING MARKER DECIDES THE VERSION, AND NOTHING READ IT (#334).
  //
  // The gate above counts bullets; it cannot see what one says. CONTRIBUTING
  // makes the changelog the ANSWER to minor-vs-patch — so a BREAKING entry
  // riding out in a patch was possible with every check green, which is the
  // same shape as #310 and #331: a rule in prose with nothing that fails when
  // the habit lapses. Here too, ahead of every replaceIn.
  const refusal = refuseBump(changelog, current, next);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
}

/** Every `examples/<slug>/README.md`. Derived, because a hand list is what failed. */
function globExampleReadmes() {
  return readdirSync("examples", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `examples/${e.name}/README.md`)
    .filter((p) => existsSync(p));
}

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
// llms.txt is the FIRST file an agent reads — served at the site root, ahead of
// the digest it points at — and it was never on this list, so it told every
// agent the language was v0.2 for five minor versions (#363). Found by the owner
// writing a map for an actual game, which is the one test nothing here performs.
replaceIn("playground/llms.txt", `whole v${spec(current)} language`, `whole v${spec(next)} language`, { optional: spec(current) === spec(next) });
// Package READMEs and example status lines both went stale unnoticed (#365):
// npm publishes a package README regardless of `files`, so browser's CDN pin is
// the install line on its public page, and it sat at 0.1 through 0.7. The
// example status lines were WORSE — #352 corrected them from a stale v0.1 to a
// hardcoded v0.6, fixing the instance and reproducing the defect.
replaceIn("packages/browser/README.md", `@chartdown/browser@${spec(current)}`, `@chartdown/browser@${spec(next)}`, { optional: spec(current) === spec(next) });
for (const readme of globExampleReadmes()) {
  replaceIn(readme, `spec v${spec(current)}`, `spec v${spec(next)}`, { optional: true });
}
replaceIn("README.md", `@chartdown/browser@${spec(current)}`, `@chartdown/browser@${spec(next)}`, { optional: spec(current) === spec(next) });

// CHANGELOG: the [Unreleased] items become the new section; links follow.
replaceIn("CHANGELOG.md", "## [Unreleased]", `## [Unreleased]\n\n## [${next}] — ${today}`);
replaceIn(
  "CHANGELOG.md",
  `[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v${current}...HEAD`,
  `[Unreleased]: https://github.com/Nossimonov/Chartdown/compare/v${next}...HEAD\n[${next}]: https://github.com/Nossimonov/Chartdown/compare/v${current}...v${next}`,
);

execSync("npm install --package-lock-only", { stdio: "inherit" });
console.log(`\n${current} → ${next} on every surface. Review the diff (git diff), run npm test,`);
console.log(`commit, and after the PR merges to main: git tag v${next} && git push origin v${next}`);
