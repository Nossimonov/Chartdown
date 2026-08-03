// @vitest-environment happy-dom
/**
 * What a note reader is shown (#245) and the files a document references (#246).
 *
 * These were one question — "does it handle a file that references another
 * file?" — with two answers. It resolved nothing, and the warning saying so
 * was discarded before it reached the note, along with every coherence lint
 * spec 06 §10 defines as "always WARNINGS, no suppression syntax".
 */
import { describe, expect, it } from "vitest";
import { renderChartdownBlock } from "./render";
import { resolveImports, resolveVaultPath, type VaultReader } from "./imports";

const VOCAB = ["kind: vocabulary", "", "[vocab]", "gazebo : structure"].join("\n");

const reader = (files: Record<string, string>): VaultReader => ({
  read: async (folder, relative) => files[resolveVaultPath(folder, relative)] ?? null,
});

const mount = (src: string, imports?: { libraries: Record<string, string>; documents: Record<string, string> }) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  renderChartdownBlock(src, el, "player", imports);
  return el;
};

const box = (el: HTMLElement): string => el.querySelector(".chartdown-diagnostics")?.textContent ?? "";

describe("a warning reaches the note (#245)", () => {
  it("shows a coherence lint that used to be invisible", () => {
    // Spec 06 §10's lints are warnings by design, which only works if a
    // surface shows them. The map rendered looking finished.
    const el = mount([
      "map: battlemap", "grid: square 10x8", "scale: 5ft",
      "[terrain]", "river : path A5 J5",
      "[structures]", 'building hall "The Hall" : C3..F6', "  door : D6.s",
    ].join("\n"));
    expect(box(el)).toMatch(/crossing its wall/);
  });

  it("shows an unreachable room", () => {
    const el = mount(["map: battlemap", "grid: square 10x8", "scale: 5ft", "[structures]", 'building vault "The Vault" : C3..F6'].join("\n"));
    expect(box(el)).toMatch(/nothing can reach it/);
  });

  it("still shows errors, and marks the two apart", () => {
    const el = mount(["map: battlemap", "grid: square 10x8", "scale: 5ft", "[features]", "pit p : area D4..F6"].join("\n"));
    expect(el.querySelector(".chartdown-diagnostic-error")).not.toBeNull();
  });

  it("a warnings-only map is not framed as an error", () => {
    // Widening the filter alone would have put every lint in the error-red
    // box: a room with no door is not the same claim as a map that is wrong.
    const el = mount(["map: battlemap", "grid: square 10x8", "scale: 5ft", "[structures]", 'building vault "The Vault" : C3..F6'].join("\n"));
    expect(el.querySelector(".chartdown-diagnostics-warning")).not.toBeNull();
    expect(el.querySelector(".chartdown-diagnostics-error")).toBeNull();
  });

  it("a clean map shows no box at all", () => {
    const el = mount(["map: battlemap", "grid: square 8x6", "scale: 5ft", "[features]", "statue s : C3"].join("\n"));
    expect(el.querySelector(".chartdown-diagnostics")).toBeNull();
  });
});

describe("the files a document references (#246)", () => {
  it("reads a `use:` library from the vault, relative to the document", async () => {
    const files = { "campaign/lib/v.cd": VOCAB };
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "use: ./lib/v.cd", "", "[structures]", "gazebo g : C3"].join("\n");
    const imports = await resolveImports(src, "campaign/", reader(files));
    expect(imports.libraries["./lib/v.cd"]).toBe(VOCAB);
  });

  it("climbs out of the folder, as a sibling theme does", async () => {
    const files = { "themes/vellum.theme.cd": "kind: theme\n\n[theme]\nwall : stroke=#402d18\n" };
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "use: ../themes/vellum.theme.cd"].join("\n");
    const imports = await resolveImports(src, "maps/", reader(files));
    expect(Object.keys(imports.libraries)).toEqual(["../themes/vellum.theme.cd"]);
  });

  it("resolves an `inset:` parent as a document, not a library", async () => {
    const files = { "region.cd": "map: region\nextent: 200x200mi\n" };
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "inset: ./region.cd at keep"].join("\n");
    const imports = await resolveImports(src, "", reader(files));
    expect(imports.documents["./region.cd"]).toContain("map: region");
    expect(imports.libraries).toEqual({});
  });

  it("a path that does not resolve is simply absent — and the parser then warns", async () => {
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "use: ./missing.cd"].join("\n");
    const imports = await resolveImports(src, "", reader({}));
    expect(imports.libraries).toEqual({});
    // The two issues meet here: the warning exists, and now it is shown.
    const el = mount(src, imports);
    expect(box(el)).toMatch(/not provided to the parser/);
  });

  it("an unparseable document yields no imports rather than throwing", async () => {
    const imports = await resolveImports("!!! not a document", "", reader({}));
    expect(imports).toEqual({ libraries: {}, documents: {} });
  });

  it("a resolved library makes its vocabulary available", () => {
    // The end of the whole chain: with the library in hand, `gazebo` is a
    // structure and the map renders one instead of warning about it.
    const src = ["map: battlemap", "grid: square 8x6", "scale: 5ft", "use: ./v.cd", "", "[structures]", 'gazebo g "The Gazebo" : C3..D4', "  door : C4.s"].join("\n");
    const el = mount(src, { libraries: { "./v.cd": VOCAB }, documents: {} });
    expect(box(el)).not.toMatch(/not provided to the parser/);
  });
});

describe("vault paths", () => {
  it("normalises the forms a document actually writes", () => {
    expect(resolveVaultPath("maps/", "./x.cd")).toBe("maps/x.cd");
    expect(resolveVaultPath("maps/", "../themes/x.cd")).toBe("themes/x.cd");
    expect(resolveVaultPath("", "x.cd")).toBe("x.cd");
    expect(resolveVaultPath("a/b/", "../../c.cd")).toBe("c.cd");
  });
});
