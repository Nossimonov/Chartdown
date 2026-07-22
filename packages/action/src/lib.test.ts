import { readProvenance } from "@chartdown/render-svg";
import { describe, expect, it } from "vitest";
import { extractFences, findOrphans, isMapDocument, renderCdFile, renderMarkdownFile } from "./lib";

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

  it("every job is stamped with provenance recording its own source and output (#78)", () => {
    const cd = renderCdFile("maps\\camp.cd", MAP, { mode: "both", markdown: true, verify: false });
    expect(cd.jobs.map((j) => readProvenance(j.svg))).toEqual([
      { source: "maps/camp.cd", docId: "camp", mode: "player", output: "maps/camp.svg" },
      { source: "maps/camp.cd", docId: "camp", mode: "gm", output: "maps/camp-gm.svg" },
    ]);
    const md = renderMarkdownFile("notes/session-3.md", `\`\`\`chartdown\n${MAP}\n\`\`\`\n`, { mode: "player", markdown: true, verify: false });
    expect(readProvenance(md.jobs[0]!.svg)).toEqual({ source: "notes/session-3.md", docId: "camp", mode: "player", output: "notes/session-3.camp.svg" });
  });
});

describe("orphan cleanup is marker-gated (#78)", () => {
  const stampedAt = (output: string): string =>
    renderCdFile(output.replace(/(-gm)?\.svg$/, ".cd"), MAP, { mode: output.endsWith("-gm.svg") ? "gm" : "player", markdown: true, verify: false }).jobs[0]!.svg;

  it("a marked output no scan job produces is an orphan (docId rename, source deletion, mode change)", () => {
    const { orphans, suspects } = findOrphans(
      [{ path: "maps/old-name.svg", content: stampedAt("maps/old-name.svg") }],
      new Set(["maps/new-name.svg"]),
      new Set(["maps/new-name.cd"]),
    );
    expect(orphans).toEqual(["maps/old-name.svg"]);
    expect(suspects).toEqual([]);
  });

  it("a hand-made SVG is untouched even when its name shadows a deleted source", () => {
    const { orphans, suspects } = findOrphans(
      [{ path: "maps/keep.svg", content: "<svg><circle r=\"5\"/></svg>" }],
      new Set(),
      new Set(),
    );
    expect(orphans).toEqual([]);
    expect(suspects).toEqual([]);
  });

  it("a hand-carried COPY of a generated SVG survives — its marker names the old location", () => {
    const { orphans } = findOrphans(
      [{ path: "archive/camp-v1-frozen.svg", content: stampedAt("maps/camp.svg") }],
      new Set(),
      new Set(),
    );
    expect(orphans).toEqual([]);
  });

  it("path comparison shrugs off separators and case (Windows checkouts)", () => {
    const { orphans } = findOrphans(
      [{ path: "Maps\\Camp.svg", content: stampedAt("maps/camp.svg") }],
      new Set(["maps/other.svg"]),
      new Set(["maps/other.cd"]),
    );
    expect(orphans).toEqual(["Maps\\Camp.svg"]);
  });

  it("unmarked legacy outputs tied to a still-scanned source are suspects, never deletions", () => {
    const { orphans, suspects } = findOrphans(
      [
        { path: "maps/camp.svg", content: "<svg/>" },                    // mode changed to gm-only
        { path: "notes/session-3.gone-fence.svg", content: "<svg/>" },   // fence renamed
        { path: "art/logo.svg", content: "<svg/>" },                     // unrelated hand-made file
      ],
      new Set(["maps/camp-gm.svg"]),
      new Set(["maps/camp.cd", "notes/session-3.md"]),
    );
    expect(orphans).toEqual([]);
    expect(suspects).toEqual(["maps/camp.svg", "notes/session-3.gone-fence.svg"]);
  });
});
