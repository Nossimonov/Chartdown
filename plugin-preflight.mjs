/**
 * Would the Obsidian store's scan pass? (#350)
 *
 * Every plugin release up to 0.4.0 was followed by a patch release to clear
 * something the store's scan objected to — and the scan CACHES its result per
 * version, so a rejected release cannot be re-scanned. The fix always costs a
 * version number, and the fix is usually one line.
 *
 * | release | what the scan caught |
 * |---|---|
 * | 0.2.1 | stale `@chartdown` pins, and test files published as plugin source |
 * | 0.3.1 | `styles.css` — twelve opens, thirteen closes |
 * | 0.4.0 | version surfaces drifting between manifest, package.json, lockfile |
 *
 * 0.5.0 was the first release cut behind this check, and the first the store
 * passed with no patch behind it. That is correlation rather than proof — the
 * counterfactual is not observable — but the four classes below were verified
 * absent BEFORE the dispatch rather than discovered after, which had not
 * happened before. The check earned itself during that release: the lockfile
 * entry carries a `name` line between the key and the version, the first edit
 * pattern missed it, and this is what said so.
 *
 * Two of those already have tests. What none of them had is a single command
 * that answers "is this releasable" over the ARTIFACT — the three files that go
 * in the zip — rather than over the source tree. A linter cannot see any of it:
 * the code was fine every time, and what shipped was not.
 *
 * Deliberately NOT a replica of the store's scan, which is closed and changes.
 * It is the set of things that have actually bitten this project, plus the
 * manifest rules Obsidian documents. A clean run here is not a promise the
 * scan passes; a dirty run is a promise it does not.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = "packages/obsidian";
const DIST = join(PLUGIN, "dist");
/** Exactly what an Obsidian release contains. Anything else is a finding. */
const SHIPPED = ["main.js", "manifest.json", "styles.css"];

/**
 * All paths are resolved against a ROOT so the checks can be run over a
 * fixture. That is not decoration: every check below exists because something
 * shipped, and a check that has never been shown to fail is not cover — the
 * lesson the corpus taught this project in #333.
 */
let ROOT = ".";
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/^﻿/, "");
const json = (...p) => JSON.parse(read(...p));
const listDist = () => readdirSync(join(ROOT, DIST));

/** Every check returns a list of complaints; empty means it passed. */
const CHECKS = {
  "manifest is complete": () => {
    const m = json(PLUGIN, "manifest.json");
    const required = ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"];
    return required.filter((k) => m[k] === undefined).map((k) => `manifest.json has no '${k}'`);
  },

  "manifest follows the store's naming rules": () => {
    const m = json(PLUGIN, "manifest.json");
    const out = [];
    // Obsidian's documented rules. The id and name are what a user searches.
    if (/obsidian/i.test(m.id ?? "")) out.push(`id '${m.id}' contains "obsidian" — the store strips it`);
    if (/plugin/i.test(m.id ?? "")) out.push(`id '${m.id}' contains "plugin"`);
    if (/\bobsidian\b/i.test(m.name ?? "")) out.push(`name '${m.name}' contains "Obsidian"`);
    if (/\bplugin\b/i.test(m.name ?? "")) out.push(`name '${m.name}' contains "Plugin"`);
    const d = m.description ?? "";
    if (d.length > 250) out.push(`description is ${d.length} chars; the limit is 250`);
    if (d && !d.endsWith(".")) out.push("description does not end with a period");
    if (/^(this|a|an)\s+(obsidian\s+)?plugin\b/i.test(d)) out.push(`description opens with "${d.split(" ").slice(0, 3).join(" ")}…" — say what it does`);
    return out;
  },

  "version surfaces agree": () => {
    // #254's failure, twice: the lockfile was left behind on two bumps running.
    const m = json(PLUGIN, "manifest.json").version;
    const p = json(PLUGIN, "package.json").version;
    const lock = json("package-lock.json").packages?.[PLUGIN]?.version;
    const out = [];
    if (m !== p) out.push(`manifest.json ${m} vs package.json ${p}`);
    if (lock !== undefined && lock !== m) out.push(`package-lock.json ${lock} vs manifest.json ${m}`);
    return out;
  },

  "the artifact holds exactly what ships": () => {
    // 0.2.1 published test files as plugin source. A release is three files.
    let present;
    try {
      present = listDist();
    } catch {
      return [`${DIST} does not exist — run \`npm run build\` before releasing`];
    }
    const missing = SHIPPED.filter((f) => !present.includes(f));
    const extra = present.filter((f) => !SHIPPED.includes(f));
    return [
      ...missing.map((f) => `${f} is missing from the artifact`),
      ...extra.map((f) => `${f} is in the artifact and does not belong in a release`),
    ];
  },

  "the artifact's copies are current": () => {
    // `build.mjs` copies manifest and styles into dist. A stale copy ships the
    // wrong version number while the source tree looks correct.
    const out = [];
    for (const f of ["manifest.json", "styles.css"]) {
      try {
        if (read(PLUGIN, f) !== read(DIST, f)) out.push(`dist/${f} differs from ${PLUGIN}/${f} — rebuild`);
      } catch {
        out.push(`dist/${f} is unreadable`);
      }
    }
    return out;
  },

  "the bundle carries no test scaffolding": () => {
    const out = [];
    let js;
    try {
      js = read(DIST, "main.js");
    } catch {
      return []; // the artifact check already reported this
    }
    for (const marker of ["vitest", "__vitest__", "describe(\"", "it.each("]) {
      if (js.includes(marker)) out.push(`main.js contains '${marker}' — test code is bundled`);
    }
    if (/\/\/# sourceMappingURL=/.test(js)) out.push("main.js references a source map that is not shipped");
    return out;
  },

  "no stale version string is bundled": () => {
    // 0.2.1: the published plugin carried `@chartdown` pins two minor versions
    // behind. The plugin bundles core and render-svg from source, so any
    // OLDER x.y.z baked into main.js is a leftover, not a dependency.
    const current = json("packages/core/package.json").version;
    let js;
    try {
      js = read(DIST, "main.js");
    } catch {
      return [];
    }
    const older = [...new Set([...js.matchAll(/\b0\.\d+\.\d+\b/g)].map((m) => m[0]))]
      .filter((v) => cmp(v, current) < 0);
    return older.map((v) => `main.js contains ${v}, older than the ${current} it is built from`);
  },

  "the stylesheet is well-formed": () => {
    // 0.3.1: twelve opens, thirteen closes. Browsers recover silently, so
    // nothing looked wrong in a vault — the scan's CSS lint objected first.
    const css = read(PLUGIN, "styles.css");
    let depth = 0;
    const out = [];
    css.split("\n").forEach((line, i) => {
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}" && --depth < 0) {
          out.push(`styles.css:${i + 1} closes a rule that was never opened`);
          depth = 0;
        }
      }
    });
    if (depth > 0) out.push(`styles.css leaves ${depth} rule(s) unclosed`);
    return out;
  },
};

/** 1 if a > b. Only reached with well-formed x.y.z. */
function cmp(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function preflight(root = ".") {
  ROOT = root;
  return Object.entries(CHECKS).flatMap(([name, run]) => {
    let problems;
    try {
      problems = run();
    } catch (e) {
      problems = [`the check itself failed: ${e.message}`];
    }
    return problems.map((problem) => ({ check: name, problem }));
  });
}

// CLI: `node plugin-preflight.mjs`. Exit 1 on any finding.
if (process.argv[1] && process.argv[1].endsWith("plugin-preflight.mjs")) {
  const found = preflight();
  const version = json(PLUGIN, "manifest.json").version;
  if (found.length === 0) {
    console.log(`chartdown: plugin ${version} passes ${Object.keys(CHECKS).length} preflight checks.`);
    console.log("  This is not a promise the store's scan passes — it is the set of things");
    console.log("  that have bitten us before, plus the manifest rules Obsidian documents.");
  } else {
    console.error(`chartdown: plugin ${version} has ${found.length} preflight finding(s):\n`);
    for (const { check, problem } of found) console.error(`  [${check}] ${problem}`);
    console.error("\nThe store caches its scan per version, so shipping this costs a version number.");
    process.exit(1);
  }
}
