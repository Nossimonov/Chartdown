/**
 * The example corpus is the parser's acceptance suite (issue #21 done-state):
 * every .cd in examples/ parses with zero errors and a stable AST snapshot.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const examplesDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "examples");

const exampleFiles: { name: string; path: string }[] = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, path: join(examplesDir, entry.name, `${entry.name}.cd`) }));

describe("example corpus", () => {
  it("finds the seven examples", () => {
    expect(exampleFiles.map((f) => f.name).sort()).toEqual([
      "brenmark",
      "gilded-tankard",
      "fairwater-manor",
      "gumdrop-vale",
      "redford-crossing",
      "sundered-reach",
      "vessany",
    ].sort());
  });

  for (const file of exampleFiles) {
    describe(file.name, () => {
      const source = readFileSync(file.path, "utf8");
      const { document, diagnostics } = parse(source);

      it("parses with zero errors", () => {
        expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      });

      it("produces no warnings", () => {
        expect(diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
      });

      it("AST snapshot is stable", () => {
        expect(document).toMatchSnapshot();
      });
    });
  }
});
