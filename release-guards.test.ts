/**
 * The changelog decides minor-vs-patch, and now something reads it (#334).
 *
 * CONTRIBUTING has always said the changelog is the ANSWER to which release
 * this is. Nothing enforced it: `bump` takes the version as an argument and its
 * only changelog gate counts bullets, so a BREAKING entry could ship in a patch
 * with every check green. The two releases that got this right got it right
 * because somebody remembered — which is not a mechanism.
 *
 * The matcher is asserted against the COMMITTED history rather than only
 * against fixtures written to match it. A regex that passes its own tests and
 * matches nothing real is the failure this repository keeps meeting.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper, shared with bump.mjs.
import { breakingEntries, refuseBump, unreleasedSection } from "./release-guards.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const CHANGELOG = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const withEntries = (...bullets: string[]): string =>
  ["## [Unreleased]", "", "### Changed", "", ...bullets, "", "## [0.6.0] — 2026-08-08", "", "- something old"].join("\n");

const BREAKING = "- **BREAKING — a document path is a token, not a substring** ([#323](x)). Prose.";
const ORDINARY = "- **A landing is suppressed by a declaration** ([#319](x)). Prose.";

describe("a breaking entry forbids a patch", () => {
  it("refuses, naming the entry and the minor to cut instead", () => {
    const out = refuseBump(withEntries(BREAKING), "0.6.0", "0.6.1") as string;
    expect(out).toContain("cannot be a patch");
    expect(out).toContain("a document path is a token"); // the entry, so the reader can judge it
    expect(out).toContain("0.7.0");                      // what to cut instead
    expect(out).toContain("Nothing has been modified");
  });

  it("allows the minor, and the major", () => {
    expect(refuseBump(withEntries(BREAKING), "0.6.0", "0.7.0")).toBeNull();
    expect(refuseBump(withEntries(BREAKING), "0.6.0", "1.0.0")).toBeNull();
  });

  it("allows a patch when nothing is breaking — one direction only", () => {
    // A minor with no BREAKING entry is ordinary too: features ship in minors.
    expect(refuseBump(withEntries(ORDINARY), "0.6.0", "0.6.1")).toBeNull();
    expect(refuseBump(withEntries(ORDINARY), "0.6.0", "0.7.0")).toBeNull();
  });

  it("reads only [Unreleased], not the releases below it", () => {
    // Every past BREAKING entry is still in the file forever; matching those
    // would refuse every patch this project ever cuts again.
    const past = ["## [Unreleased]", "", "- nothing much", "", "## [0.6.0] — 2026-08-08", "", BREAKING].join("\n");
    expect(refuseBump(past, "0.6.0", "0.6.1")).toBeNull();
  });

  it("a mention of the word is not a marked entry", () => {
    const prose = withEntries("- **A fix** ([#1](x)). This is not BREAKING, and mentions BREAKING twice.");
    expect(refuseBump(prose, "0.6.0", "0.6.1")).toBeNull();
  });
});

describe("the matcher against this repository's real history", () => {
  // Frozen sections — released, immutable, and the only honest test of whether
  // the regex matches what people actually wrote rather than what a fixture says.
  const sectionOf = (version: string): string => {
    const head = CHANGELOG.indexOf(`## [${version}]`);
    expect(head, `no section for ${version}`).toBeGreaterThan(-1);
    const next = CHANGELOG.indexOf("## [", head + 5);
    return CHANGELOG.slice(head, next === -1 ? undefined : next);
  };

  it.each([["0.4.0", 3], ["0.5.0", 3], ["0.6.0", 4]])("%s carries %i BREAKING entries", (v, n) => {
    expect(breakingEntries(sectionOf(v as string))).toHaveLength(n as number);
  });

  it("finds every one of them, and nothing else in the file says BREAKING", () => {
    const all = [...CHANGELOG.matchAll(/BREAKING/g)].length;
    const matched = breakingEntries(CHANGELOG).length;
    expect(matched).toBe(all); // no occurrence escapes the bullet form
  });

  it("the live [Unreleased] section is consistent with the version being prepared", () => {
    // Not a fixture: if this section holds a BREAKING entry, the next release
    // off `preview` is a minor, and this test says so out loud.
    const live = breakingEntries(unreleasedSection(CHANGELOG));
    const current = JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8").replace(/^﻿/, "")).version;
    const patch = current.split(".").map(Number);
    const nextPatch = `${patch[0]}.${patch[1]}.${patch[2] + 1}`;
    expect(Boolean(refuseBump(CHANGELOG, current, nextPatch))).toBe(live.length > 0);
  });
});

describe("the refusal happens before anything is rewritten", () => {
  it("bump.mjs calls the guard ahead of its first replaceIn", () => {
    // The density gate carries the same comment for the same reason: a refusal
    // that leaves the tree half-bumped is worse than no refusal.
    const bump = readFileSync(join(root, "bump.mjs"), "utf8");
    const guard = bump.indexOf("refuseBump(changelog");
    const firstWrite = bump.indexOf("replaceIn(");
    expect(guard, "bump.mjs never calls refuseBump").toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstWrite);
  });
});
