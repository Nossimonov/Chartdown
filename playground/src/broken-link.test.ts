/**
 * A broken share link explains itself (#389).
 *
 * The catch loaded the manor demo silently, so the recipient of a truncated
 * link — wrapped by a chat client, clipped by an email footer, copied short —
 * saw a complete, plausible map with nothing to suggest it was not the one that
 * had been shared. A wrong map that looks right is the expensive kind of wrong.
 *
 * The fallback is asserted to be a VALID document rather than merely present:
 * a comment-only file has no `map:` header, fails to check, and would show the
 * reader "missing required 'map:' header line" — noise about the wrong problem.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@chartdown/core";

const source = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "playground.ts"), "utf8");

/** The BROKEN_LINK literal, read out of the playground source. */
const fallback = (): string => {
  const block = /const BROKEN_LINK = \[([\s\S]*?)\]\.join/.exec(source)?.[1];
  expect(block, "BROKEN_LINK literal not found — it was renamed or restructured").toBeDefined();
  return [...block!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!).join("\n");
};

describe("the fallback shown for an unreadable link", () => {
  it("is a document that checks clean", () => {
    // Not decoration: the reader sees it in the editor and it renders.
    const errors = parse(fallback()).diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((d) => d.message)).toEqual([]);
  });

  it("says what happened, in the title so it reaches the canvas", () => {
    // A toast lasts 2.6 seconds; the whole failure is that a substitute looks
    // legitimate, so the explanation has to outlive the toast.
    expect(fallback().split("\n")[0]).toContain("could not be read");
  });

  it("is NOT a real map", () => {
    // The defect itself. `manor` is the demo the catch used to load.
    expect(source).toContain("editor.value = BROKEN_LINK");
    const initCatch = /} catch {[\s\S]*?}/.exec(source.slice(source.indexOf("async function init")))?.[0] ?? "";
    expect(initCatch, "the catch loads a real map again").not.toContain("= manor");
  });

  it("and the failure is also announced", () => {
    expect(source).toContain('flash("This share link could not be read');
  });
});
