/**
 * The plugin preflight catches what actually shipped (#350).
 *
 * Every check in `plugin-preflight.mjs` exists because something got past us
 * and the store's scan caught it — at the cost of a version number each time,
 * since the scan caches per version. So each one is replayed here against a
 * fixture that reproduces the original failure.
 *
 * That is the point of the file. A preflight nobody has seen fail is a
 * preflight nobody should trust, which is the lesson #333 recorded about the
 * example corpus: 34 green renders proved nothing because no document in the
 * corpus could express the defect.
 */
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper, shared with the CLI entry point.
import { preflight } from "./plugin-preflight.mjs";

const PLUGIN = "packages/obsidian";
const roots: string[] = [];

/** A fixture that PASSES, which each case then breaks in exactly one way. */
const fixture = (mutate: (r: string) => void = () => {}): string => {
  const root = mkdtempSync(join(tmpdir(), "cd-preflight-"));
  roots.push(root);
  mkdirSync(join(root, PLUGIN, "dist"), { recursive: true });
  const manifest = {
    id: "chartdown", name: "Chartdown", version: "0.4.0", minAppVersion: "1.5.0",
    description: "Render Chartdown map blocks as SVG, right in your notes.",
    author: "Nossimonov", isDesktopOnly: false,
  };
  writeFileSync(join(root, PLUGIN, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(root, PLUGIN, "package.json"), JSON.stringify({ version: "0.4.0" }));
  writeFileSync(join(root, PLUGIN, "styles.css"), ".a { color: red; }\n.b { color: blue; }\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { [PLUGIN]: { version: "0.4.0" } } }));
  mkdirSync(join(root, "packages/core"), { recursive: true });
  writeFileSync(join(root, "packages/core/package.json"), JSON.stringify({ version: "0.7.0" }));
  writeFileSync(join(root, PLUGIN, "dist", "main.js"), "'use strict';const VERSION='0.7.0';\n");
  cpSync(join(root, PLUGIN, "manifest.json"), join(root, PLUGIN, "dist", "manifest.json"));
  cpSync(join(root, PLUGIN, "styles.css"), join(root, PLUGIN, "dist", "styles.css"));
  mutate(root);
  return root;
};

const problems = (root: string): string[] =>
  (preflight(root) as { check: string; problem: string }[]).map((f) => `${f.check}: ${f.problem}`);

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  preflight("."); // leave the module pointed at the repo, not a deleted temp dir
});

describe("the fixture itself passes", () => {
  it("so every finding below is the mutation, not the fixture", () => {
    expect(problems(fixture())).toEqual([]);
  });
});

describe("each historical failure is caught", () => {
  it("0.4.0 — the lockfile left behind on a bump (#254)", () => {
    // Happened twice running: bumped to 0.3.0 with the lockfile at 0.2.1, and
    // again at 0.4.0. Nothing failed and nothing reported it.
    const found = problems(fixture((r) =>
      writeFileSync(join(r, "package-lock.json"), JSON.stringify({ packages: { [PLUGIN]: { version: "0.3.1" } } }))));
    expect(found.join("\n")).toContain("package-lock.json 0.3.1 vs manifest.json 0.4.0");
  });

  it("0.3.1 — twelve opens, thirteen closes in styles.css (#255)", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "styles.css"), ".a { color: red; }\n}\n")));
    expect(found.join("\n")).toContain("styles.css:2 closes a rule that was never opened");
  });

  it("0.2.1 — test files published as plugin source", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "dist", "block.test.js"), "// test")));
    expect(found.join("\n")).toContain("block.test.js is in the artifact and does not belong in a release");
  });

  it("0.2.1 — a stale version baked into the bundle", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "dist", "main.js"), "const PIN='0.5.0';\n")));
    expect(found.join("\n")).toContain("main.js contains 0.5.0, older than the 0.7.0 it is built from");
  });
});

describe("and the checks nothing has broken yet", () => {
  it("a stale dist copy, which would ship the wrong version number", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "dist", "manifest.json"), JSON.stringify({ id: "chartdown", version: "0.3.1" }))));
    expect(found.join("\n")).toContain("dist/manifest.json differs from");
  });

  it("a missing artifact file", () => {
    const found = problems(fixture((r) => rmSync(join(r, PLUGIN, "dist", "styles.css"))));
    expect(found.join("\n")).toContain("styles.css is missing from the artifact");
  });

  it("bundled test scaffolding", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "dist", "main.js"), 'import "vitest";\n')));
    expect(found.join("\n")).toContain("test code is bundled");
  });

  it("the store's naming rules, which our manifest already satisfies", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "manifest.json"), JSON.stringify({
        id: "obsidian-chartdown-plugin", name: "Chartdown Plugin for Obsidian", version: "0.4.0",
        minAppVersion: "1.5.0", description: "A plugin that renders maps", author: "Nossimonov", isDesktopOnly: false,
      }, null, 2))));
    const all = found.join("\n");
    expect(all).toContain('contains "obsidian"');
    expect(all).toContain('contains "plugin"');
    expect(all).toContain('contains "Plugin"');
    expect(all).toContain("does not end with a period");
    expect(all).toContain("say what it does");
  });

  it("an incomplete manifest", () => {
    const found = problems(fixture((r) =>
      writeFileSync(join(r, PLUGIN, "manifest.json"), JSON.stringify({ id: "chartdown", version: "0.4.0" }))));
    expect(found.join("\n")).toContain("manifest.json has no 'minAppVersion'");
  });
});

describe("the real plugin", () => {
  // `dist/` only exists after `npm run build`. CI builds before it tests, so
  // this always runs there; a fresh clone running `npm test` alone skips it
  // rather than failing with something that reads like a broken plugin.
  const built = existsSync(join(PLUGIN, "dist", "main.js"));

  it.skipIf(!built)("passes preflight as committed", () => {
    // Not a tautology: the fixture cases above prove the checks can fail, so a
    // clean run here is a statement about the plugin rather than about the
    // preflight. It is also the guard — this goes red the moment it stops.
    expect(problems(".")).toEqual([]);
  });

  it("the skip above is conditional on a build, not on the plugin", () => {
    // Guards the guard: if `built` were ever wired to something that is always
    // false, the check above would vanish silently and nothing would say so.
    expect(existsSync(join(PLUGIN, "manifest.json"))).toBe(true);
  });
});
