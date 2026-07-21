/**
 * CLI acceptance: exec the built bundle against the example corpus.
 * Requires `npm run build` first (CI builds before testing); skipped locally
 * when the bundle is absent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const cliPath = join(root, "packages", "cli", "dist", "cli.js");
const example = join(root, "examples", "redford-crossing", "redford-crossing.cd");
const built = existsSync(cliPath);

describe("chartdown CLI", () => {
  it.skipIf(!built)("renders an example to SVG with exit 0", () => {
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const outPath = join(outDir, "out.svg");
    execFileSync(process.execPath, [cliPath, "render", example, "-o", outPath]);
    expect(readFileSync(outPath, "utf8").startsWith("<svg")).toBe(true);
  });

  it.skipIf(!built)("gm mode includes gm content, player does not", () => {
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const gmPath = join(outDir, "gm.svg");
    const playerPath = join(outDir, "player.svg");
    execFileSync(process.execPath, [cliPath, "render", example, "-o", gmPath, "--mode", "gm"]);
    execFileSync(process.execPath, [cliPath, "render", example, "-o", playerPath]);
    expect(readFileSync(gmPath, "utf8")).toContain("Gruk");
    expect(readFileSync(playerPath, "utf8")).not.toContain("Gruk");
  });

  it.skipIf(!built)("check exits 1 on an invalid document", () => {
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const bad = join(outDir, "bad.cd");
    writeFileSync(bad, "map: battlemap\n[features]\ncrates loot : A1\nchest loot : B2\n");
    let status = 0;
    try {
      execFileSync(process.execPath, [cliPath, "check", bad]);
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }
    expect(status).toBe(1);
  });

  it.skipIf(!built)("check exits 0 on the corpus", () => {
    execFileSync(process.execPath, [cliPath, "check", example]);
  });
});
