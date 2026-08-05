/**
 * A display name written against the colon (#251).
 *
 * `forest "Dark Wood": blob …` was rejected as having no predicate. The
 * header-style split refuses any chunk containing a quote — right for
 * `gm="a: b"`, wrong here — so the chunk fell to the string branch, whose
 * trailing-quote strip cannot match a chunk ending in a colon. The name
 * became `Dark Wood":` and no colon token was emitted.
 *
 * An attached colon is legal everywhere else in the language: on headers, and
 * on a subject ending in an id word. This was one accidental exception, and it
 * fell hardest on `[labels]`, where the subject IS a bare quoted name.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const errorsOf = (src: string): string[] =>
  parse(src).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

const battlemap = (...lines: string[]): string =>
  ["map: battlemap", "grid: square 20x20", "scale: 5ft", ...lines].join("\n");

describe("a quoted name may hug the colon", () => {
  const SPACED = battlemap("[terrain]", 'forest w "Dark Wood" : A1..D4');
  const HUGGED = battlemap("[terrain]", 'forest w "Dark Wood": A1..D4');

  it("parses, where it used to be rejected as having no predicate", () => {
    expect(errorsOf(HUGGED)).toEqual([]);
  });

  it("means exactly what the spaced spelling means", () => {
    // Not merely "parses" — the same document, so the name is the name and
    // the colon is punctuation rather than a character inside it.
    expect(JSON.stringify(parse(HUGGED).document)).toBe(JSON.stringify(parse(SPACED).document));
  });

  it("works in every position a quoted subject appears", () => {
    // `[labels]` needs an entity to refer to, and the others must not collide
    // with it — the first version of this test declared `s1` twice and failed
    // on a duplicate id, which is a fixture fault wearing the bug's clothes.
    const anchor = ['[features]', 'statue s1 "The Watcher" : C4'] as const;
    for (const [section, line] of [
      ["[terrain]", 'forest "Dark Wood": A1..D4'],
      ["[features]", 'statue s2 "The Second Watcher": D4'],
      ["[labels]", '"The Watcher": at R2'],
      ["[labels]", 'note "Here be dragons": C6'],
    ] as const) {
      const src = battlemap(anchor[0], anchor[1], section, line);
      expect(errorsOf(src), `${section} ${line}`).toEqual([]);
    }
  });

  it("keeps a colon INSIDE the name", () => {
    // The closing quote is what makes the split unambiguous, so a name that
    // legitimately contains a colon is untouched by it.
    const doc = parse(battlemap("[features]", 'statue s1 "Warning: dragons": C4')).document;
    const names = JSON.stringify(doc);
    expect(names).toContain("Warning: dragons");
    expect(errorsOf(battlemap("[features]", 'statue s1 "Warning: dragons": C4'))).toEqual([]);
  });

  it("leaves a quoted pair value alone", () => {
    // `gm="a: b"` is why the header-style rule refuses quoted chunks at all.
    const src = battlemap("[features]", 'statue s1 "The Watcher" : C4 gm="beware: it wakes"');
    expect(errorsOf(src)).toEqual([]);
    expect(JSON.stringify(parse(src).document)).toContain("beware: it wakes");
  });

  it("still rejects a line with no predicate at all", () => {
    expect(errorsOf(battlemap("[terrain]", 'forest "Dark Wood"')).length).toBeGreaterThan(0);
  });
});
