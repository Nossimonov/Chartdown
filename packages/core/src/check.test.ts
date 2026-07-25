import { describe, expect, it } from "vitest";
import { checkSource, documentKind } from "./check";

describe("document-kind dispatch (#110, #102)", () => {
  it("kind: is the positive discriminator and beats inference", () => {
    // Sections say "theme"; the declaration says vocabulary and wins.
    expect(documentKind("kind: vocabulary\n[vocab]\nhall : building\n")).toBe("vocabulary");
    expect(documentKind("kind: theme\n[theme]\nbuilding : fill=#112233\n")).toBe("theme");
    expect(documentKind("map: battlemap\n")).toBe("map");
  });

  it("inference still covers documents written before kind: existed", () => {
    expect(documentKind("[vocab]\nhall : building\n")).toBe("vocabulary");
    expect(documentKind("[theme]\nbuilding : fill=#112233\n")).toBe("theme");
    // Undecidable stays "map", so a malformed map says so rather than lying.
    expect(documentKind("[terrain]\nforest : area A1..B2\n")).toBe("map");
  });

  it("a misspelled kind is loud however the document then routes", () => {
    const { diagnostics } = checkSource("kind: spaceship\n[vocab]\nhall : building\n");
    expect(diagnostics.some((d) => d.severity === "error" && /unknown document kind/.test(d.message))).toBe(true);
  });

  it("a theme document's own kind: line is not an unknown header", () => {
    const { diagnostics } = checkSource("kind: theme\nuse: default\n[theme]\nbuilding : fill=#112233\n");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.some((d) => /ignoring header line/.test(d.message))).toBe(false);
  });
});
