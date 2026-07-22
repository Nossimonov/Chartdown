import { describe, expect, it } from "vitest";
import { extractFences, isMapDocument, renderCdFile, renderMarkdownFile } from "./lib";

const MAP = ["# Camp", "map: battlemap", "grid: square 4x4", "[features]", "campfire : B2"].join("\n");

describe("action driver logic (issue #60)", () => {
  it("extracts chartdown fences from Markdown, in order", () => {
    const md = `# Session 3\n\n\`\`\`chartdown\n${MAP}\n\`\`\`\n\nprose\n\n\`\`\`js\nnot a map\n\`\`\`\n\n\`\`\`chartdown\nmap: hexcrawl\ngrid: hex 2x2 pointy odd-row\n[hexes]\nA1 sea\n\`\`\`\n`;
    const fences = extractFences(md);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toContain("campfire");
    expect(fences[1]).toContain("hexcrawl");
  });

  it("renders .cd files to sibling SVGs, both modes when asked", () => {
    const report = renderCdFile("maps/camp.cd", MAP, { mode: "both", markdown: true, verify: false });
    expect(report.errors).toEqual([]);
    expect(report.jobs.map((j) => j.outPath)).toEqual(["maps/camp.svg", "maps/camp-gm.svg"]);
    expect(report.jobs[0]!.svg).toContain("<svg");
  });

  it("renders Markdown fences to <md-base>.<doc-id>.svg with collision suffixes", () => {
    const md = `\`\`\`chartdown\n${MAP}\n\`\`\`\n\`\`\`chartdown\n${MAP}\n\`\`\`\n`;
    const report = renderMarkdownFile("notes/session-3.md", md, { mode: "player", markdown: true, verify: false });
    expect(report.jobs.map((j) => j.outPath)).toEqual(["notes/session-3.camp.svg", "notes/session-3.camp-2.svg"]);
  });

  it("theme and vocab documents are recognized as non-maps", () => {
    expect(isMapDocument(MAP)).toBe(true);
    expect(isMapDocument("# Candyworld\n\n[theme]\nsea : fill=#f4c\n")).toBe(false);
    expect(isMapDocument("[vocab]\nlicorice-forest : forest\n")).toBe(false);
  });

  it("surfaces render errors with file and line", () => {
    const bad = MAP + "\ntable : on ghost at B2";
    const report = renderCdFile("maps/bad.cd", bad, { mode: "player", markdown: true, verify: false });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toMatch(/^maps\/bad\.cd:\d+/);
  });
});
