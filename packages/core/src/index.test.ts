import { describe, expect, it } from "vitest";
import { parse, SPEC_VERSION } from "./index";

describe("basics", () => {
  it("tracks the released spec version (spec and packages version together)", () => {
    expect(SPEC_VERSION).toBe("0.3");
  });

  it("parses a minimal document without errors", () => {
    const { document, diagnostics } = parse("map: battlemap\ngrid: square 4x4\n[features]\ncampfire : B2 light=30ft\n");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(document.mapType).toBe("battlemap");
    expect(document.grid).toEqual({ kind: "square", cols: 4, rows: 4 });
  });

  it("derives docId from the title, overridable by id:", () => {
    const a = parse("# Ambush at Redford Crossing\nmap: battlemap\n");
    expect(a.document.docId).toBe("ambush-at-redford-crossing");
    const b = parse("# Whatever\nmap: battlemap\nid: my-map\n");
    expect(b.document.docId).toBe("my-map");
  });
});

describe("archetype inference (spec 04 §3)", () => {
  const errorsOf = (src: string) => parse(src).diagnostics.filter((d) => d.severity === "error");
  const firstEntity = (src: string) => {
    const { document } = parse(src);
    for (const section of document.sections) {
      const entity = section.entries.find((e) => e.kind === "entity");
      if (entity?.kind === "entity") return entity;
    }
    throw new Error("no entity");
  };

  it("unknown words never fail", () => {
    expect(errorsOf("map: region\nextent: 10x10mi\n[features]\nzorbleflax : (8,7)\n")).toEqual([]);
  });

  it("infers terrain from area/blob shapes", () => {
    const e = firstEntity("map: region\nextent: 10x10mi\n[features]\nglombus : blob (4,3) size=2mi\n");
    expect(e.archetype).toBe("terrain");
    expect(e.archetypeSource).toBe("inferred-shape");
  });

  it("infers path from from…to", () => {
    const e = firstEntity("map: region\nextent: 10x10mi\n[features]\nsludgeway : from (1,1) to (9,9)\n");
    expect(e.archetype).toBe("path");
  });

  it("a lone point infers feature only when the section carries no archetype", () => {
    const gm = firstEntity('map: region\nextent: 10x10mi\n[gm]\nzorbleflax : (8,7) "a mystery"\n');
    expect(gm.archetype).toBe("feature");
  });

  it("section context outranks the lone-cell rule — a solo creature in [tokens] is a token", () => {
    const e = firstEntity("map: battlemap\ngrid: square 20x15\n[tokens]\nogre \"Gruk\" : G9 size=2\n");
    expect(e.archetype).toBe("token");
    expect(e.archetypeSource).toBe("inferred-section");
  });

  it("a bare range falls through to section context — staging zones stay tokens", () => {
    const e = firstEntity("map: battlemap\ngrid: square 20x15\n[tokens]\nparty start : J14..L15\n");
    expect(e.archetype).toBe("token");
    expect(e.archetypeSource).toBe("inferred-section");
  });

  it("vocabulary derivation resolves through the chain", () => {
    const e = firstEntity("map: region\nextent: 10x10mi\n[vocab]\nlicorice-forest : forest\n[terrain]\nlicorice-forest : blob (4,4) size=1mi\n");
    expect(e.archetype).toBe("terrain");
    expect(e.archetypeSource).toBe("vocab");
  });

  it("document vocab shadows the standard library", () => {
    const e = firstEntity("map: battlemap\ngrid: square 4x4\n[vocab]\nwagon : zone\n[features]\nwagon : A1..B2\n");
    expect(e.archetype).toBe("zone");
  });
});
