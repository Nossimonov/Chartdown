/**
 * The stylesheet ships as a file, and nothing was reading it (#255).
 *
 * A stray closing brace went out in 0.3.0 and reached the community store's
 * CSS lint, which is stricter than a browser: browsers recover from an
 * unmatched `}` silently, so nothing looked wrong locally, in the vault, or in
 * any render. The scan is the first reader that objects — and its result is
 * cached per version, so the answer to a failed scan is always a new release.
 *
 * These are cheap structural checks, not a CSS parser. They exist because the
 * failure mode is a file nobody validates until it is published.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "styles.css"), "utf8");
/** Comments hold prose with braces in it; the structure is what is under test. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("styles.css is structurally sound", () => {
  it("braces balance", () => {
    expect(bare.split("{").length - 1).toBe(bare.split("}").length - 1);
  });

  it("never closes more than it has opened", () => {
    // The balance check alone passes for `} … {`, which is still broken and is
    // the shape an appended block produces when it carries one brace too many.
    let depth = 0;
    let firstBad: number | null = null;
    bare.split("\n").forEach((line, i) => {
      for (const ch of line) {
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth < 0 && firstBad === null) firstBad = i + 1;
        }
      }
    });
    expect(firstBad, `unmatched '}' at line ${firstBad}`).toBeNull();
    expect(depth).toBe(0);
  });

  it("every class the plugin applies is defined", () => {
    // The other half of the same gap: a rule can be well-formed and still not
    // exist. These are the classes the source attaches at runtime.
    for (const cls of [
      "chartdown-map",
      "chartdown-diagnostics",
      "chartdown-diagnostics-error",
      "chartdown-diagnostics-warning",
      "chartdown-diagnostic-error",
      "chartdown-diagnostic-warning",
      "chartdown-file-view",
      "chartdown-file-toolbar",
      "chartdown-file-body",
      "chartdown-file-source",
      "chartdown-toolbar",
      "chartdown-mode-toggle",
    ]) {
      expect(css, `no rule for .${cls}`).toContain(`.${cls}`);
    }
  });
});
