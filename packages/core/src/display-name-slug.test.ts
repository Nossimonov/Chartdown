/**
 * A display-name slug is a reference key (#369, ADR 0004).
 *
 * ADR 0004's title is "Explicit ids and display names are BOTH reference keys",
 * its body lists display names among the identity keys, and it anticipates this
 * usage outright — "renaming a display name can break quoted references and
 * SLUG ANCHORS", a sentence that only means anything if slugs resolve.
 * `digest.md` agrees: "explicit id, display name; neither = anonymous
 * (renderable, unreferenceable)". So the documentation said this worked and the
 * implementation disagreed.
 *
 * A QUOTED reference always worked — `"Gralk"` matches the name exactly. The
 * bare word did not: it parses as an id, missed the id table, and came back as
 * a suggested misspelling, sending the reporter hunting for a typo that was not
 * there.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const errors = (body: string): string[] =>
  parse(["map: battlemap", "grid: square 10x10", "scale: 5ft", "", body].join("\n"))
    .diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("a bare word resolves against a display name", () => {
  it("the reported case", () => {
    expect(errors(['[tokens]', 'hezrou "Gralk" : C3 size=2', "", "[gm]", 'gralk : "Bellows constantly."'].join("\n")))
      .toEqual([]);
  });

  it("a multi-word name, through its slug", () => {
    expect(errors(['[tokens]', 'ogre "Old Merek" : C3', "", "[gm]", 'old-merek : "Knows the way down."'].join("\n")))
      .toEqual([]);
  });

  it("and a quoted reference still works, as it always did", () => {
    expect(errors(['[tokens]', 'hezrou "Gralk" : C3', "", "[gm]", '"Gralk" : "note"'].join("\n")))
      .toEqual([]);
  });
});

describe("an explicit id is still the primary key", () => {
  it("an id wins over another entity's display-name slug", () => {
    // The id is looked up first and never shadowed, so nothing that resolved
    // before this change resolves differently now.
    expect(errors([
      "[tokens]",
      'hezrou gralk "Something Else" : C3',
      'troll "Gralk" : E3',
      "", "[gm]", 'gralk : "note"',
    ].join("\n"))).toEqual([]);
  });
});

describe("what must still fail, and say why", () => {
  it("a genuine misspelling is still a misspelling", () => {
    const msg = errors(['[tokens]', 'hezrou "Gralk" : C3', "", "[gm]", 'grak : "note"'].join("\n")).join("\n");
    expect(msg).toContain("misspelled attachment target");
  });

  it("two names slugging alike are AMBIGUOUS, and the message says so", () => {
    // The reporter's complaint was that the diagnostic named the wrong problem.
    // Resolving slugs opens a second route to that same failure — a word that
    // matches two entities — so the message has to name it rather than fall
    // back to suggesting a typo that is not there.
    const msg = errors([
      "[tokens]", 'hezrou "Gralk" : C3', 'troll "gralk" : E3',
      "", "[gm]", 'gralk : "note"',
    ].join("\n")).join("\n");
    expect(msg).toContain("ambiguous");
    expect(msg).toContain("display-name slug");
    expect(msg).not.toContain("misspelled");
  });

  it("an anonymous entity is still unreferenceable", () => {
    // ADR 0004: "neither = anonymous (renderable, unreferenceable)".
    const msg = errors(['[tokens]', "hezrou : C3", "", "[gm]", 'hezrou : "note"'].join("\n")).join("\n");
    expect(msg).not.toBe("");
  });

  it("a forward reference is still refused (order-bounded, ADR 0003)", () => {
    // The slug lookup is bounded the same way the id lookup is: a later
    // declaration must not satisfy an earlier reference.
    const msg = errors([
      "[gm]", 'gralk : "note"', "", "[tokens]", 'hezrou "Gralk" : C3',
    ].join("\n")).join("\n");
    expect(msg).not.toBe("");
  });
});

describe("the OTHER resolver — placements and label overrides", () => {
  // `[gm]` classification goes through `tryResolve`; everything else goes
  // through `resolve`. The first version of these tests covered only `[gm]`,
  // so mutating `resolve`'s slug lookup killed nothing and the path was
  // untested while appearing covered.
  const hall = ["[structures]", 'building "The Great Hall" : B2..F6'];

  it("a placement referent, by slug", () => {
    expect(errors([...hall, "", "[features]", "table : on the-great-hall at C2"].join("\n"))).toEqual([]);
  });

  it("a [labels] override, by slug", () => {
    expect(errors([...hall, "", "[labels]", "the-great-hall : at C4"].join("\n"))).toEqual([]);
  });

  it("an unknown word through that path still fails", () => {
    const msg = errors([...hall, "", "[features]", "table : on the-small-hall at C2"].join("\n")).join("\n");
    expect(msg).toContain("unresolved reference");
    expect(msg).toContain("id or display name");
  });

  it("and an ambiguous one is refused rather than guessed", () => {
    const msg = errors([
      "[structures]", 'building "The Great Hall" : B2..C3', 'building "the great hall" : E2..F3',
      "", "[features]", "table : on the-great-hall at C2",
    ].join("\n")).join("\n");
    expect(msg).toContain("ambiguous");
  });

  it("a FORWARD slug reference is refused, order-bounded like an id (ADR 0003)", () => {
    // A later declaration must not satisfy an earlier reference. In practice
    // entries are registered in declaration order, so the entity is simply not
    // in the table yet — which is also why the id path reports "unresolved"
    // rather than its own "forward reference" message. The explicit bound in
    // `bySlug` mirrors the one `resolve` keeps for ids; neither is reachable
    // through the current single-pass parser, and both are there so a second
    // pass could not quietly make names less strict than ids.
    const msg = errors([
      "[features]", "table : on the-great-hall at C2",
      "", "[structures]", 'building "The Great Hall" : B2..F6',
    ].join("\n")).join("\n");
    expect(msg).toContain("unresolved reference 'the-great-hall'");
  });
});
