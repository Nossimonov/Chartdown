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
    .diagnostics.filter((d) => d.severity === "warning" && /styles nothing|never read for it|never referenced/.test(d.message))
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
    expect(deadIn(`kind: theme\n\n[theme]\nwater : glyph=lonely\n\n[glyphs]\nlonely : "M0,0 L1,1"\n`).join()).toMatch(/'water' is styled elsewhere, but 'glyph' on this line is never read/);
  });

  it("distinguishes a misspelled subject from a real subject given the wrong property", () => {
    // Both lines are inert and the author's mistake is different in each; a
    // single message would send half of them looking in the wrong place.
    expect(deadIn(`kind: theme\n\n[theme]\nmountian : fill=#ff0000\n`).join()).toMatch(/no entity resolves to it/);
    expect(deadIn(`kind: theme\n\n[theme]\nwater : glyph=lonely\n\n[glyphs]\nlonely : "M0,0 L1,1"\n`).join()).toMatch(/does not apply to this kind of subject/);
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
