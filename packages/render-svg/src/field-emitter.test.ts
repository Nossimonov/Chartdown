/**
 * A field emits through its vocabulary, not through the literal key (#395).
 *
 * Spec 04 §5: a field's NAME IS ITS PARAMETER, so the emitter namespace is
 * derived from the vocabulary — `radiation : field` is what makes
 * `radiation=40ft` mean something. `light` sits in spec 04 §2's load-bearing
 * table marked *Inherited? yes*, and ADR 0016 makes literal-word matching
 * non-conforming. The renderer read the literal key anyway.
 *
 * The ambient half already generalised (`archetypeOf(h.key) === "field"`), so
 * the two halves disagreed and the result was worse than either alone: a
 * derived field darkened the whole sheet and then drew no lamp on it, silently.
 * The UVTT export said it louder — a fully-lit scene containing no lights,
 * which is the exact failure `uvtt.ts`'s ambient code was written to fix.
 *
 * Found by an independent review briefed to hunt #301's class: where else does
 * the code decide something by consulting a word?
 */
import { describe, expect, it } from "vitest";
import { renderSource, exportUvttSource } from "./index";

const HEAD = ["# Probe", "map: battlemap", "chartdown: 0.1", "grid: square 20x15", "scale: 5ft"];
const doc = (...lines: string[]): string => [...HEAD, ...lines].join("\n");

const POOL = "#ffd98a";
const svg = (d: string): string => renderSource(d, { mode: "gm" }).svg;
const uvtt = (d: string): { ambient: string; lights: number } => {
  const u = (exportUvttSource(d).uvtt ?? {}) as {
    environment?: { ambient_light?: string }; lights?: unknown[];
  };
  return { ambient: u.environment?.ambient_light ?? "", lights: (u.lights ?? []).length };
};

const LIT = doc("light: dark", "", "[features]", 'lamp t1 "L" : F6 light=20ft');
const GLOW = doc("glow: dark", "", "[vocab]", "glow : light", "", "[features]", 'lamp t1 "L" : F6 glow=20ft');

describe("a derived field is the field it derives from", () => {
  it("draws the emitter pool, which it did not", () => {
    expect(svg(GLOW)).toContain(POOL);
  });

  it("with the same geometry as the literal word", () => {
    // Not byte identity of the whole sheet — the header word differs — but the
    // pool itself must be the same circle in the same place.
    const pool = (s: string): string | undefined => s.match(/<circle[^>]*#ffd98a[^>]*>/)?.[0];
    expect(pool(svg(GLOW))).toBeDefined();
    expect(pool(svg(GLOW))).toBe(pool(svg(LIT)));
  });

  it("and exports as light, where the wrongness was loudest", () => {
    // Was: ambient ffffffff (fully lit) with 0 lights, from a document that
    // declares a dark room and a lamp in it.
    expect(uvtt(GLOW)).toEqual(uvtt(LIT));
    expect(uvtt(GLOW)).toEqual({ ambient: "ff000000", lights: 1 });
  });
});

describe("vocabulary facet defaults resolve the same way", () => {
  // Spec 06 §2 (#64): a campfire glows unless told otherwise.
  const CAMPFIRE = doc("light: dark", "", "[features]", 'campfire c1 "C" : F6');
  const DERIVED = doc("light: dark", "", "[vocab]", "bonfire : campfire", "", "[features]", 'bonfire b1 "B" : F6');

  it("a stdlib emitter still glows with no pair", () => {
    expect(svg(CAMPFIRE)).toContain(POOL);
    expect(uvtt(CAMPFIRE).lights).toBe(1);
  });

  it("and so does a word derived from it", () => {
    expect(svg(DERIVED)).toContain(POOL);
    expect(uvtt(DERIVED).lights).toBe(1);
  });
});

describe("a setting's own field", () => {
  const RADIATION = doc("", "[vocab]",
    "radiation : field occluded=none states=none,light,heavy,lethal", "",
    "[features]", 'reactor r1 "R" : F6 radiation=40ft');

  it("emits ink — spec 04 §5 owes an unknown field geometry and a lookup", () => {
    // Was byte-comparable to the same document with the reactor line deleted.
    expect(svg(RADIATION)).toContain(POOL);
    expect(svg(RADIATION)).not.toBe(svg(doc("", "[vocab]",
      "radiation : field occluded=none states=none,light,heavy,lethal")));
  });

  it("but is NOT a lamp in a VTT — the interop boundary", () => {
    // UVTT `lights` and `ambient_light` mean illumination. A radiation source
    // arriving in Foundry as a light source would be a wrong export, not a
    // generous one. This is spec 06 §9, not a second class of field.
    expect(uvtt(RADIATION)).toEqual({ ambient: "ffffffff", lights: 0 });
  });
});

describe("what must not move", () => {
  it("an entity with no emitter draws no pool", () => {
    expect(svg(doc("light: dark", "", "[features]", 'table t1 "T" : F6'))).not.toContain(POOL);
  });

  it("the literal spelling is unchanged, pool and export alike", () => {
    expect(svg(LIT)).toContain(POOL);
    expect(uvtt(LIT)).toEqual({ ambient: "ff000000", lights: 1 });
  });

  it("a non-field pair is not mistaken for an emitter", () => {
    // `size=`, `facing=`, `to=` and friends must not be read as fields just
    // because they carry a measure.
    expect(svg(doc("light: dark", "", "[tokens]", "ogre o1 : F6 size=2"))).not.toContain(POOL);
  });
});
