/**
 * What a `key=` pair is allowed to be (#195).
 *
 * The set is RESOLVED from the vocabulary rather than listed, because the
 * language's whole design is an open vocabulary: a word earns its facets by
 * derivation, and a field word makes its own name a parameter.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./parse";

describe("an unknown key= is reported (#195)", () => {
  // A typo in a VALUE was caught; a typo in the KEY was not, so `taepr=0.3`
  // silently lost the taper and drew a wedge where a parallel-sided inlet was
  // asked for. The same hole spec 01's closed value sets close for header keys,
  // left open one level down.
  const doc = (line: string): string => `map: region
extent: 60x60mi

[water]
coastline shore : from (30,0) via (30,30) to (30,60)
sea "S" : west of shore
${line}
`;
  const warnings = (src: string): string[] =>
    parse(src).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  it("names the key and the word", () => {
    const [msg] = warnings(doc(`sound a "A" : on shore at (30,10) size=2mi wibble=nonsense`));
    expect(msg).toMatch(/'wibble=' is not a parameter 'sound' can use/);
    expect(msg).toMatch(/it is ignored/);
  });

  it("catches the three spellings #168 tried for a direction", () => {
    // All three checked clean and none of them did anything.
    expect(warnings(doc(`sound a "A" : on shore at (30,10) size=2mi toward=(12,70)`))).toHaveLength(1);
    expect(warnings(doc(`sound a "A" : on shore at (30,10) size=2mi bearing=315`))).toHaveLength(1);
  });

  it("accepts what the ARCHETYPE can consume, not just what the word declares", () => {
    // The stdlib states `reach=`/`taper=` only where it has a non-default to
    // give, so `bay` declares no taper and `island` no reach — and both accept
    // one, because they belong to placed morphology as such (spec 05 §4).
    expect(warnings(doc(`bay b "B" : on shore at (30,10) size=2mi taper=0.3`))).toEqual([]);
    expect(warnings(doc(`island i "I" : near shore at (20,20) size=3mi reach=2`))).toEqual([]);
  });

  it("accepts a facet the vocabulary earns by derivation", () => {
    // `fjord` inherits `morph=` from `bay` without restating it.
    expect(warnings(doc(`fjord f "F" : on shore at (30,10) size=2mi reach=20 taper=0.15`))).toEqual([]);
  });

  it("says nothing about an undefined word", () => {
    // Spec 04 §3 promises a word may be used without defining it first, and an
    // undefined one has no declared facets to compare against.
    expect(warnings(doc(`zorbleflax z "Z" : on shore at (30,10) size=2mi wibble=1`))).toEqual([]);
  });

  it("lets an x- prefix carry extension data without argument", () => {
    expect(warnings(doc(`sound a "A" : on shore at (30,10) size=2mi x-internal=7`))).toEqual([]);
  });
});
