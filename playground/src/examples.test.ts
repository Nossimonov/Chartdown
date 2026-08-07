/**
 * Every example reaches the shop window (#278).
 *
 * The playground's picker is a hand-maintained list — one `import` and one
 * `EXAMPLES` entry per example — and nothing enumerates `examples/`, so adding
 * a directory does nothing until someone remembers this file. `undercellar`
 * arrived with #238's relational placement and was never wired up, which meant
 * the playground offered no example of a feature 0.5.0 had shipped. Nobody
 * noticed for several releases, because nothing was looking.
 *
 * The repository already guards its other "these move together" couplings — CI
 * re-renders every committed example, and a spec change must carry
 * `grammar.ebnf` and `digest.md` with it (#12). This is that guard for the one
 * coupling that had none.
 *
 * Asserted against the SOURCE TEXT rather than by importing the module: the
 * playground is browser code that reaches for `document` at import time, and a
 * test that had to stand a DOM up to count its examples would be testing the
 * wrong thing. The import path is the durable fact — it names the file on disk
 * — where the display label is prose someone may reword.
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const examplesDir = join(here, "..", "..", "examples");
const source = readFileSync(join(here, "playground.ts"), "utf8");

/**
 * A directory holding a same-named `.cd` is a map example. Theme documents are
 * excluded on purpose: `ink-and-vellum.theme.cd` and `candyworld.theme.cd` feed
 * the THEME selector, and the per-example vellum themes are applied rather than
 * offered, so a rule of "every .cd under examples/" would demand entries for
 * files that are correctly absent.
 */
const mapExamples = readdirSync(examplesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => existsSync(join(examplesDir, name, `${name}.cd`)))
  .sort();

describe("the playground offers every example in the repository", () => {
  it("finds the examples on disk at all", () => {
    // Guards the guard: a walk that silently found nothing would pass every
    // assertion below while checking nothing whatsoever.
    expect(mapExamples.length).toBeGreaterThanOrEqual(7);
    expect(mapExamples).toContain("undercellar");
  });

  for (const name of mapExamples) {
    it(`${name} is in the picker`, () => {
      expect(
        source.includes(`examples/${name}/${name}.cd`),
        `examples/${name}/ has no entry in playground.ts — add an import and an EXAMPLES row, `
          + `or the example exists in the repository and nobody can run it`,
      ).toBe(true);
    });
  }

  it("every EXAMPLES row points at a file that exists", () => {
    // The other direction: a renamed or deleted example leaves an import that
    // fails the BUILD rather than a test, which is a worse place to find out.
    for (const [, path] of source.matchAll(/from "\.\.\/\.\.\/(examples\/[^"]+\.cd)"/g)) {
      expect(existsSync(join(here, "..", "..", path!)), `${path} is imported but missing`).toBe(true);
    }
  });
});
