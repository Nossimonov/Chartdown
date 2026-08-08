/**
 * The ledger form is checked like the grouped form (#277, #280).
 *
 * `grammar.ebnf` calls them two spellings of one thing — "grouped alternative:
 * ordinary line form" — and every check added since was taught to one of them.
 * Three ledger blind spots were found one at a time (#277, the emitter case
 * next to #272, and an unchecked `key=`), which is what #280 argued should be
 * swept rather than picked off.
 *
 * So this file is the sweep, and it is written as a TABLE on purpose: each row
 * is one check, asserted on both spellings of the same document. A check added
 * to the entity path without the ledger path should fail here, which is the
 * only thing that stops this class returning a fourth time.
 */
import { describe, expect, it } from "vitest";
import { parse } from "./index";

const HEAD = ["map: hexcrawl", "grid: hex 8x6 pointy odd-row", "scale: 6mi", ""];

const ledger = (line: string): string => [...HEAD, "[hexes]", line].join("\n");
const grouped = (line: string): string => [...HEAD, "[routes]", line].join("\n");

const said = (src: string): string =>
  parse(src).diagnostics.map((d) => d.message).join(" | ");

interface Row { check: string; ledger: string; grouped: string; match: RegExp }

/** Every check the entity path runs that a ledger line can also be subject to. */
const SWEEP: Row[] = [
  {
    check: "an archetype name is not a type word (#266)",
    ledger: "C2 terrain", grouped: "terrain : C2",
    match: /is an archetype, not a type word/,
  },
  {
    check: "…including in a CONTENT word, not only the terrain word",
    ledger: "C2 forest structure", grouped: "structure : C2",
    match: /is an archetype, not a type word/,
  },
  {
    check: "an unknown key= warns (#195)",
    ledger: "C2 forest taepr=0.3", grouped: "forest : C2 taepr=0.3",
    match: /is not a parameter 'forest' can use/,
  },
  {
    check: "an out-of-set facet value warns",
    ledger: "C2 forest sight=banana", grouped: "forest : C2 sight=banana",
    match: /is not one of all, none/,
  },
];

describe("every check reaches both spellings", () => {
  for (const row of SWEEP) {
    it(row.check, () => {
      expect(said(ledger(row.ledger)), "ledger form").toMatch(row.match);
      expect(said(grouped(row.grouped)), "grouped form").toMatch(row.match);
    });
  }
});

describe("an address slot takes a hex, and says so when it does not", () => {
  it("a corner names itself rather than reporting a malformed line", () => {
    // It used to fall through to the terrain slot, leaving the line with no
    // address at all — so the report named neither the token nor the fix.
    const msg = said(ledger("C2.nw forest"));
    expect(msg).toMatch(/names a corner/);
    expect(msg).toMatch(/write the hex itself \('C2'\)/);
    expect(msg).not.toMatch(/malformed/);
  });

  it("an edge does too", () => {
    expect(said(ledger("C2.n forest"))).toMatch(/names an edge/);
  });
});

describe("what the sweep deliberately did NOT change", () => {
  it("a bare word after the terrain word is CONTENT, and an unknown one is legal", () => {
    // On a ledger line `erupting` is a content word; on an entity line it is a
    // flag, and only a flag is checked against `states=`. So there is nothing
    // here to check, and spec 04 §3 says an unknown word is legal. That the two
    // spellings disagree about what a bare word MEANS is a different question
    // from whether they are checked alike, and is not settled by this sweep.
    // `smoking`, not `erupting`: the stdlib declares `volcano : peak
    // states=dormant,erupting`, so the latter is legal on both spellings and
    // would prove nothing.
    expect(said(ledger("C2 volcano smoking"))).toBe("");
    expect(said(grouped("volcano : C2 smoking"))).toMatch(/is not a declared state/);
  });

  it("the ordinary ledger forms still parse clean", () => {
    for (const line of ["C2 forest", "C2..C4 forest", 'C2 forest ruins "The Wood"', "C2 forest seen", "C2 forest gm=a-shrine"]) {
      expect(said(ledger(line)), line).toBe("");
    }
  });

  it("brenmark's own ledger lines are untouched", () => {
    // The committed hexcrawl is the corpus check: a sweep that reported its
    // own examples would be closing the slot too far.
    const src = [...HEAD, "[hexes]", "C2..C4 forest", "E1..E2 hills", "D3 forest ruins"].join("\n");
    expect(said(src)).toBe("");
  });
});
