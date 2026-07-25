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

  it.skipIf(!built)("check validates vocabulary and theme documents, which need no map: (#102)", () => {
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const vocab = join(outDir, "lib.cd");
    const theme = join(outDir, "t.theme.cd");
    writeFileSync(vocab, "# Lib\n[vocab]\nhall : building\n");
    // `use: default` is a theme import (spec 08 §5) — not a missing library.
    writeFileSync(theme, "# Theme\nuse: default\n[theme]\nbuilding : fill=#112233\n[glyphs]\nflame : \"M0,7 Z\"\n");
    const run = (file: string): string =>
      execFileSync(process.execPath, [cliPath, "check", file], { stdio: ["ignore", "pipe", "pipe"] , encoding: "utf8" });
    // Neither may error; both are spec-legal documents that carry no map:.
    expect(() => run(vocab)).not.toThrow();
    expect(() => run(theme)).not.toThrow();
  });

  it.skipIf(!built)("check reports errors inside a vocabulary, and unknown theme properties (#102)", () => {
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const badVocab = join(outDir, "bad.cd");
    writeFileSync(badVocab, "[vocab]\nhall : buliding\n");
    let status = 0;
    try {
      execFileSync(process.execPath, [cliPath, "check", badVocab], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }
    expect(status).toBe(1); // a typo'd derivation base is an error, not a silent hole

    const badTheme = join(outDir, "bad.theme.cd");
    writeFileSync(badTheme, "[theme]\ndoor : strokes=#445566\n");
    const out = execFileSync(process.execPath, [cliPath, "check", badTheme], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    expect(String(out)).toBeDefined(); // stderr carries the diagnostic; exit stays 0 (warning)
  });

  it.skipIf(!built)("a document with no map: and no recognisable sections still reports the missing map:", () => {
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const nomap = join(outDir, "nomap.cd");
    writeFileSync(nomap, "[terrain]\nforest : area A1..B2\n");
    let stderr = "";
    try {
      execFileSync(process.execPath, [cliPath, "check", nomap], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain("missing required 'map:'");
  });

  it.skipIf(!built)("--theme restyles output (the lollipop test, CLI edition)", () => {
    const gumdrop = join(root, "examples", "gumdrop-vale", "gumdrop-vale.cd");
    const themePath = join(root, "examples", "gumdrop-vale", "candyworld.theme.cd");
    const outDir = mkdtempSync(join(tmpdir(), "chartdown-"));
    const themed = join(outDir, "themed.svg");
    const plain = join(outDir, "plain.svg");
    execFileSync(process.execPath, [cliPath, "render", gumdrop, "-o", themed, "--theme", themePath]);
    execFileSync(process.execPath, [cliPath, "render", gumdrop, "-o", plain]);
    expect(readFileSync(themed, "utf8")).toContain("#fdf1f5");
    expect(readFileSync(plain, "utf8")).not.toContain("#fdf1f5");
  });
});
