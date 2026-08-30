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
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper, shared with bump.mjs.
import { breakingEntries, FROZEN_EXCEPTIONS, refuseBump, refuseDriftedSection, releasedSection, unreleasedSection } from "./release-guards.mjs";

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

  it("no BREAKING bullet escapes the matcher", () => {
    // This asserted that the word appeared NOWHERE but a marked bullet, which
    // was true when written and is not an invariant: #367's entry says "read as
    // a fix rather than BREAKING under ADR 0041" — a legitimate sentence
    // explaining why a change is NOT breaking, and the kind of prose this
    // changelog is full of.
    //
    // What matters is that no marked bullet is MISSED, so that is what is
    // asserted now.
    const bulletLines = CHANGELOG.split("\n").filter((l) => /^- \*\*BREAKING\b/.test(l.trim()));
    expect(bulletLines.length, "no BREAKING bullets found — the anchor moved").toBeGreaterThan(10);
    expect(breakingEntries(CHANGELOG)).toHaveLength(bulletLines.length);
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

describe("a released section is frozen (#378)", () => {
  // The defect this guards happened three times: an entry aimed at
  // [Unreleased] landed in a shipped section, crediting a release with a fix it
  // does not contain and guaranteeing the fix reaches NO release's notes, since
  // bump rolls only [Unreleased].
  const tagged = (version: string): string | null => {
    try {
      return execSync(`git show v${version}:CHANGELOG.md`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null; // shallow clone, or the tag is not reachable
    }
  };

  const versions = [...CHANGELOG.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]!);

  it("finds the released versions at all", () => {
    expect(versions.length, "no released sections parsed — the heading shape moved").toBeGreaterThan(3);
  });

  it.each(versions)("[%s] matches what it said at its tag", (v) => {
    const atTag = tagged(v);
    if (atTag === null) return; // history unavailable; the bump gate still checks
    expect(refuseDriftedSection(v, releasedSection(CHANGELOG, v), releasedSection(atTag, v))).toBeNull();
  });

  it("and the check is not vacuous — a planted entry is caught", () => {
    // Positive control. Without this the suite above passes on a comparison
    // that never fires, which is how the original defect survived.
    const now = "## [0.6.0] — x\n\n### Fixed\n\n- **a** thing\n- **another** thing\n";
    const atTag = "## [0.6.0] — x\n\n### Fixed\n\n- **a** thing\n";
    const out = refuseDriftedSection("0.6.0", now.trimEnd(), atTag.trimEnd());
    expect(out).toContain("no longer matches its tag");
    expect(out).toContain("gained 1 entry");
  });

  it("0.4.0 is exempt, and the exemption is deliberate", () => {
    // Tagged with one bullet for 117 commits because its section had been
    // written onto the wrong branch; the real notes were written afterwards.
    // Freezing it to its tag would restore the broken version.
    expect(FROZEN_EXCEPTIONS.has("0.4.0")).toBe(true);
    expect(refuseDriftedSection("0.4.0", "anything", "different")).toBeNull();
  });
});
