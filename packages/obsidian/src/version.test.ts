/**
 * The plugin's version surfaces agree (#254).
 *
 * `npm run bump` rewrites every version surface **except** this plugin's,
 * deliberately — it versions on its own lane. The consequence is that bumping
 * it is a manual edit of four files with nothing checking they agree, and
 * bumping to 0.3.0 left `package-lock.json` at 0.2.1. Nothing failed and
 * nothing reported it; it was fixed months later as a side effect of an
 * unrelated dependency PR that happened to run `npm install`.
 *
 * The language's surfaces learned this already (#90): the script is the easy
 * way, the test is the enforcement. This is the plugin's half of that, and it
 * exists because the surfaces here are FEW and move RARELY — which makes drift
 * likelier to survive, not less, since nobody carries the list in their head.
 *
 * Written while bumping to 0.4.0, where the lockfile was missed again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]): string => readFileSync(join(here, "..", ...p), "utf8").replace(/^﻿/, "");
const json = (...p: string[]): { version?: string } => JSON.parse(read(...p)) as { version?: string };

const manifest = json("manifest.json").version;

describe("every plugin version surface says the same thing", () => {
  it("manifest.json declares a version at all", () => {
    // The release workflow reads this one, so it is the reference the others
    // are checked against rather than one vote among four.
    expect(manifest).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("package.json agrees with manifest.json", () => {
    expect(json("package.json").version).toBe(manifest);
  });

  it("package-lock.json agrees — the one that drifted", () => {
    const lock = JSON.parse(readFileSync(join(here, "..", "..", "..", "package-lock.json"), "utf8").replace(/^﻿/, "")) as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages["packages/obsidian"]?.version).toBe(manifest);
  });

  it("the changelog's newest section is this version", () => {
    // A version with no notes is a release users cannot decode, and the store
    // shows this file's section verbatim.
    const first = /^## \[([^\]]+)\]/m.exec(read("CHANGELOG.md"));
    expect(first?.[1]).toBe(manifest);
  });
});
