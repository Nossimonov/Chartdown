/**
 * Dead theme declarations (#116, ADR 0022). A theme entry is live if the render
 * actually consulted it, so every test here renders and then asks — the
 * measurement is of what was drawn, not of what could have been.
 *
 * The Moria exercise shipped a theme with 19 of 80 entries inert and found out
 * by reading the render; #103 records that the failure is "worse than nothing:
 * an unstyled generic marker would at least be visible."
 */
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";

const MAP = `# Themed
map: battlemap
grid: square 12x10
scale: 5ft

[terrain]
water : area A1..B4

[structures]
building hall : C3..F6
  door : D6.s

[features]
well : E4
`;

const deadIn = (theme: string | string[], src = MAP): string[] =>
  renderSource(src, { theme })
    .diagnostics.filter((d) => d.severity === "warning" && /styles nothing|read for (it|them)|never referenced/.test(d.message))
    .map((d) => d.message);

describe("a [theme] entry that styles nothing", () => {
  it("warns, naming the subject", () => {
    expect(deadIn(`kind: theme\n\n[theme]\nmountian : fill=#ff0000\n`).join()).toMatch(/'mountian' styles nothing/);
  });

  it("is silent for a subject the document actually uses", () => {
    expect(deadIn(`kind: theme\n\n[theme]\nwater : fill=#ff0000\n`)).toEqual([]);
  });

  it("warns for a state no entity is in, while the bare word beside it stays live", () => {
    const out = deadIn(`kind: theme\n\n[theme]\nwater : fill=#ff0000\nwater.frozen : fill=#ffffff\n`);
    expect(out.join()).toMatch(/'water\.frozen' styles nothing/);
    expect(out.join()).not.toMatch(/'water' styles nothing/);
  });

  it("is not fooled into calling an entry live because the DEFAULT theme's entry for that word was read", () => {
    // Both themes carry `water`. The default supplies `fill`, which the render
    // reads; the user's line supplies only `glyph`, which a battlemap's area
    // terrain is never asked for — it is filled, not marked. Tracking liveness
    // per SUBJECT rather than per PROPERTY would call this live off the
    // default's `fill` hit and report nothing.
    expect(deadIn(`kind: theme\n\n[theme]\nwater : glyph=lonely\n\n[glyphs]\nlonely : "M0,0 L1,1"\n`).join()).toMatch(/'water' resolves to 1 entity, but 'glyph' is not read for it/);
  });

  it("never tells a subject that DOES resolve that nothing resolves to it (#148)", () => {
    // The author's fix differs completely between the two messages — one means
    // "you misspelled something", the other "nothing you write here will
    // help" — so giving a resolving subject the misspelling message starts a
    // hunt for a typo that does not exist.
    const out = deadIn(`kind: theme\n\n[theme]\nmountian : fill=#ff0000\nwell : stroke=#00ff00\n`);
    expect(out.join()).toMatch(/'mountian' styles nothing in this document — no entity resolves to it/);
    expect(out.join()).toMatch(/'well' resolves to 1 entity, but 'stroke' is not read for it/);
    expect(out.join()).not.toMatch(/'well'.*no entity resolves to it/);
  });

  it("counts every entity the subject reaches, derivations included", () => {
    // `capstan : well` derives, so a `well` theme line reaches it too (spec 08
    // §2's chain rule). The count is what makes the message actionable — "one"
    // and "thirteen" send an author to very different places.
    const src = `# Counting\nmap: battlemap\ngrid: square 12x8\nscale: 5ft\n\n[vocab]\ncapstan : well\n\n[features]\nwell : E4\nwell : F4\ncapstan : G4\n`;
    expect(deadIn(`kind: theme\n\n[theme]\nwell : dash=4,2\n`, src).join()).toMatch(/'well' resolves to 3 entities/);
  });

  it("tells a SURFACE it is a surface rather than hunting for an entity", () => {
    // `ink` and `paper` are language-defined subjects (spec 08 §2). No entity
    // ever resolves to one, so "no entity resolves to it" is the wrong
    // category rather than a blunter wording of the right one.
    expect(deadIn(`kind: theme\n\n[theme]\nink : stroke=#111111\n`).join()).toMatch(/'ink' is a surface, but 'stroke' is not read for it/);
  });

  it("reports its line in the theme, not the map", () => {
    const d = renderSource(MAP, { theme: `kind: theme\n\n[theme]\nmountian : fill=#ff0000\n` })
      .diagnostics.find((x) => x.message.includes("mountian"));
    expect(d?.line).toBe(4);
    expect(d?.source).toBe("theme");
  });
});

describe("a [glyphs] entry nothing references", () => {
  it("warns", () => {
    expect(deadIn(`kind: theme\n\n[glyphs]\nlonely : "M0,0 L1,1"\n`).join()).toMatch(/glyph 'lonely' is never referenced/);
  });

  it("is silent when a theme entry names it", () => {
    expect(deadIn(`kind: theme\n\n[theme]\nwell : glyph=lonely\n\n[glyphs]\nlonely : "M0,0 L1,1"\n`)).toEqual([]);
  });

  it("is silent when it is one member of a variant pool", () => {
    // Pools are comma-separated (spec 08 §4) and the pick is a position hash,
    // so a member the hash never lands on this render is still referenced.
    const theme = `kind: theme\n\n[theme]\nwell : glyph=a,b,c\n\n[glyphs]\na : "M0,0 L1,1"\nb : "M0,0 L2,2"\nc : "M0,0 L3,3"\n`;
    expect(deadIn(theme)).toEqual([]);
  });

  it("counts a reference from ANY layer, including one the user's theme inherits", () => {
    const parent = `kind: theme\n\n[theme]\nwell : glyph=shared\n`;
    const child = `kind: theme\n\n[glyphs]\nshared : "M0,0 L1,1"\n`;
    expect(deadIn([parent, child])).toEqual([]);
  });
});

describe("scope (ADR 0022): only the selected theme is checked", () => {
  // Spec 08 §5's shadowing puts the selected theme LAST, so the split needs no
  // calling convention — it falls out of the layering order.
  const inherited = `kind: theme\n\n[theme]\nmountian : fill=#ff0000\n`;
  const selected = `kind: theme\n\n[theme]\nwater : fill=#00ff00\n`;

  it("says nothing about a dead entry in an inherited theme", () => {
    expect(deadIn([inherited, selected])).toEqual([]);
  });

  it("says the same entry IS dead when that theme is the one selected", () => {
    // Same text, different position in the layering — the only thing that
    // changes is whether this render is the one the theme was written for.
    expect(deadIn([selected, inherited]).join()).toMatch(/'mountian' styles nothing/);
  });

  it("never reports the built-in default, which styles words most maps never use", () => {
    expect(deadIn(`kind: theme\n\n[theme]\nwater : fill=#00ff00\n`)).toEqual([]);
  });
});
