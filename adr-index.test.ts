/**
 * The ADR index describes the ADRs that exist (#335).
 *
 * CONTRIBUTING leans on the index table to make two ADRs claiming one number
 * surface as a git conflict — which handles COLLISION and says nothing about
 * INTEGRITY. On 2026-08-10 a row pointing at a file that had been deleted was
 * committed and survived a full `npm test`; it was caught by eye, on a diff
 * that happened to be read closely.
 *
 * These assert what the index promises: every ADR has exactly one row, every
 * row resolves to a file, and the numbering has no gaps. The template is
 * `0000` and deliberately has no row.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(fileURLToPath(new URL(".", import.meta.url)), "docs", "decisions");
const README = readFileSync(join(dir, "README.md"), "utf8");

/** `0001-slug.md` → { n: 1, file: "0001-slug.md" }; the 0000 template excluded. */
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith("0000-"))
  .map((file) => ({ n: Number(file.slice(0, 4)), file }))
  .sort((a, b) => a.n - b.n);

/** Rows are `| [0001](0001-slug.md) | Title | Status |`. */
const rows = [...README.matchAll(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|/gm)]
  .map((m) => ({ n: Number(m[1]), target: m[2]! }));

describe("every ADR is in the index", () => {
  it("one row each, and no row without a file", () => {
    expect(rows.map((r) => r.n)).toEqual(files.map((f) => f.n));
  });

  it("every row's link resolves to the file it names", () => {
    // The 2026-08-10 failure exactly: a row survived its file being deleted.
    const present = new Set(files.map((f) => f.file));
    for (const row of rows) {
      expect(present.has(row.target), `${String(row.n).padStart(4, "0")} → ${row.target} does not exist`).toBe(true);
      expect(row.target.startsWith(String(row.n).padStart(4, "0")), `row ${row.n} links to ${row.target}`).toBe(true);
    }
  });

  it("the numbering is contiguous from 0001", () => {
    // A gap means a renumber went half-done — CONTRIBUTING's "whoever merges
    // second renumbers" is a manual edit of a file, a row and any references.
    expect(files.map((f) => f.n)).toEqual(files.map((_, i) => i + 1));
  });

  it("the template carries no row", () => {
    expect(rows.some((r) => r.n === 0)).toBe(false);
    expect(readdirSync(dir)).toContain("0000-template.md");
  });
});
