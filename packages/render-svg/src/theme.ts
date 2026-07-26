/**
 * The theme engine (spec 08). The built-in palette is expressed as a theme
 * document (DEFAULT_THEME_SOURCE) and parsed by the same machinery user
 * themes use — no privileged styling path. User themes shadow it via
 * `use: default` or are layered on top when passed to the renderer.
 */

import { parseThemeDocument, SURFACE_WORDS, type Diagnostic, type ThemeDocumentNode } from "@chartdown/core";

export const PAPER = "#f9f5ea";
export const GRID_LINE = "#c9c2b0";
export const FOG = "#ded8ca";
export const INK = "#3d3629";

const TERRAIN_FILLS: Record<string, string> = {
  sea: "#b9d3e6", lake: "#b9d3e6", water: "#b9d3e6",
  plains: "#e9e3c6", grassland: "#dde5b8", farmland: "#e7d9a6",
  forest: "#a9c79c", jungle: "#8fbc8b",
  hills: "#d9cba6", mountains: "#c3b8a5", peak: "#c3b8a5", volcano: "#b0a094",
  marsh: "#c2d2c0", desert: "#eeddb0", dunes: "#eeddb0",
  snowfield: "#eff2f4", snow: "#eff2f4", tundra: "#dfe4dd", ice: "#dcebf2",
  wasteland: "#d4c8b8", mud: "#c8b294", sand: "#ecdfb8", grass: "#dde5b8",
  island: "#e9e2cc",
  rubble: "#cfc8bc", slope: "#d9d0bd",
  ford: "#cfd4b8",
  earth: "#6b6157",
  roof: "#bf9c85",
  air: "#e9edee",
  terrace: "#e3ddcc",
};

const PATH_STROKES: Record<string, { stroke: string; dash?: string }> = {
  river: { stroke: "#7fa8cf" }, stream: { stroke: "#7fa8cf" }, canal: { stroke: "#7fa8cf" },
  road: { stroke: "#c3a878" }, trail: { stroke: "#c3a878", dash: "6 4" },
  pass: { stroke: "#a89880", dash: "4 4" },
  coastline: { stroke: "#8fa8b8" },
  border: { stroke: "#a05a5a", dash: "8 4" },
};

const TIERS: Record<string, { r: number; font: number; weight: string }> = {
  // Fonts sit well below the 18px map title — a capital is the biggest
  // SETTLEMENT, not a rival heading (owner round eleven).
  capital: { r: 6, font: 13, weight: "bold" },
  city: { r: 5, font: 11, weight: "bold" },
  town: { r: 4, font: 10, weight: "normal" },
  village: { r: 3, font: 9, weight: "normal" },
  hamlet: { r: 2.5, font: 8, weight: "normal" },
  settlement: { r: 3.5, font: 9, weight: "normal" },
};

const SIDE_COLORS: Record<string, string> = {
  party: "#4a7ab5",
  ally: "#4a9a6a",
  foe: "#b5504a",
};

/** Battlemap words the default theme draws distinctly (glyph speaks; no word label needed). */
const BATTLEMAP_GLYPHS = new Set(["campfire", "torch", "lantern", "brazier", "wagon"]);

/** The default theme, generated from the palette tables — dogfooded through the parser. */
export const DEFAULT_THEME_SOURCE: string = [
  "# Chartdown Default Theme",
  "",
  "[theme]",
  `paper : fill=${PAPER}`,
  `grid : stroke=${GRID_LINE}`,
  `fog : fill=${FOG}`,
  `ink : fill=${INK}`,
  "light : fill=#ffd98a",
  // Ambient conditions for the shipped field (#106): a value with no entry
  // draws no wash at all, so a renderer never invents a tone it was not told.
  "light.dark : fill=#10131a opacity=0.86",
  "light.dim : fill=#1b2029 opacity=0.55",
  "light.moonlight : fill=#1d2740 opacity=0.45",
  "ledge : stroke=#6b5d4a",
  "building : fill=#efe9da",
  "building.open : fill=#e3ddc2 ; unroofed interiors read as outdoor ground (spec 06 par.3)",
  // Openings and barriers are ordinary theme subjects (#105) — they were
  // hardcoded at the draw site, so four of the nine archetypes ignored the
  // theme entirely. Derived words reach these through the chain (#103).
  "door : stroke=#a8763e width=5",
  "window : stroke=#6fa8c9 width=2.5",
  "wall : stroke=#3d3629 width=3",
  "fence : stroke=#8a7a5c width=2 dash=3,3",
  "pillar : fill=#5a5244",
  ...Object.entries(TERRAIN_FILLS).map(([word, fill]) => `${word} : fill=${fill}`),
  ...Object.entries(PATH_STROKES).map(
    ([word, s]) => `${word} : stroke=${s.stroke}${s.dash ? ` dash=${s.dash.replace(" ", ",")}` : ""}`,
  ),
  ...Object.entries(SIDE_COLORS).map(([word, fill]) => `side.${word} : fill=${fill}`),
  "",
].join("\n");

export interface ResolveContext {
  state?: string | undefined;
  zone?: "core" | "edge" | undefined;
}

/** One line of the SELECTED theme, kept so it can be asked whether it did anything (#116). */
interface OwnEntry {
  key: string;
  props: string[];
  line: number;
  /** Glyph names this line names, variant pools split — checked against what exists (#149). */
  names: string[];
}

export class Theme {
  private map = new Map<string, Record<string, string>>();
  readonly glyphs: Record<string, string> = {};

  /**
   * Dead-declaration bookkeeping (#116, ADR 0022). Only the SELECTED theme is
   * recorded: an inherited or built-in theme deliberately styles words no one
   * map uses, so silence there is its normal condition rather than a defect.
   */
  private own: OwnEntry[] = [];
  private ownGlyphs: Record<string, number> = {};
  /** Every glyph name any layer's `glyph=`/`asset=` can reach, variant pools split. */
  private glyphRefs = new Set<string>();
  /** `key\0prop` for every lookup that actually RETURNED a value. */
  private hits = new Set<string>();
  /** Subjects any lookup resolved to at all, whatever property was wanted. */
  private subjectHits = new Set<string>();

  private merge(doc: ThemeDocumentNode, selected: boolean): void {
    for (const entry of doc.entries) {
      const key = entry.sub ? `${entry.base}.${entry.sub}` : entry.base;
      this.map.set(key, { ...this.map.get(key), ...entry.pairs });
      const names: string[] = [];
      for (const prop of ["glyph", "asset"]) {
        const value = entry.pairs[prop];
        if (value) for (const name of value.split(",")) names.push(name.trim());
      }
      for (const name of names) this.glyphRefs.add(name);
      if (selected) this.own.push({ key, props: Object.keys(entry.pairs), line: entry.line, names });
    }
    Object.assign(this.glyphs, doc.glyphs);
    if (selected) Object.assign(this.ownGlyphs, doc.glyphLines);
  }

  private hit(key: string, prop: string): void {
    this.hits.add(`${key}\u0000${prop}`);
    this.subjectHits.add(key);
  }

  /**
   * Build a theme: the default document, then an optional user theme source.
   * A `use: default` inside the user theme is honored (and implicit layering
   * on top of the default applies regardless, per spec 08 §5 selection).
   *
   * The LAST source is the selected theme. That is not a calling convention —
   * spec 08 §5's shadowing requires the theme chosen for this render to be
   * merged last, or its own entries would lose to the ones it inherits.
   */
  static resolve(userSource: string | string[] | undefined, diagnostics: Diagnostic[]): Theme {
    const theme = new Theme();
    theme.merge(parseThemeDocument(DEFAULT_THEME_SOURCE, diagnostics), false);
    const sources = userSource === undefined ? [] : Array.isArray(userSource) ? userSource : [userSource];
    for (const [i, source] of sources.entries()) {
      // `use:` values other than 'default' are the consumer's to pre-resolve
      // into this list (the CLI reads them from disk); 'default' is implicit.
      // Their diagnostics carry line numbers in the THEME file, so they are
      // tagged rather than left to be read against the map's path.
      const themeDiagnostics: Diagnostic[] = [];
      theme.merge(parseThemeDocument(source, themeDiagnostics), i === sources.length - 1);
      for (const d of themeDiagnostics) diagnostics.push({ ...d, source: "theme" });
    }
    return theme;
  }

  /**
   * Declarations in the selected theme that did nothing (#116). Call AFTER the
   * render, since liveness is measured by what the render actually asked for.
   *
   * An entry is live if any property IT declares was returned to a caller. Per
   * property, not per subject: the default theme and the user's can both carry
   * a `mountain` line, and the merged record holds both their pairs — asking
   * only "was `mountain` touched?" would call a dead `glyph=` live because the
   * default's `fill=` was read.
   */
  deadDeclarations(subjects: Map<string, number> = new Map()): { line: number; message: string }[] {
    const out: { line: number; message: string }[] = [];
    for (const entry of this.own) {
      if (this.hits.has(`${entry.key}\u0000*`)) continue;
      if (entry.props.some((prop) => this.hits.has(`${entry.key}\u0000${prop}`))) continue;
      // Three different mistakes wear the same shape, and telling an author
      // which one they made is most of the value — the fix differs completely.
      //
      // Whether the SUBJECT resolves is a fact about the DOCUMENT, not about
      // what the theme was asked for, and reading it off theme hits got that
      // wrong (#148): `chain : stroke=…` with four chains on the map was told
      // "no entity resolves to it", which starts a hunt for a spelling error
      // that does not exist. The count comes from the model.
      const resolved = subjects.get(entry.key) ?? 0;
      // A SURFACE is not an entity and never resolves to one, so "no entity
      // resolves to it" is the wrong category rather than a harsher wording of
      // the right one: `ink`, `paper`, and `fog` are language-defined subjects
      // that always exist (spec 08 §2). Sending their author hunting for a
      // misspelling is the same failure #148 reports for `chain`.
      const isSurface = SURFACE_WORDS.has(entry.key.split(".")[0]!);
      const props = entry.props.map((p) => `'${p}'`).join(", ");
      const isAre = entry.props.length === 1 ? "is" : "are";
      out.push({
        line: entry.line,
        message:
          isSurface
            ? `'${entry.key}' is a surface, but ${props} ${isAre} not read for it in this render — nothing written here will reach the map (spec 08 §2)`
          : resolved > 0
            ? `'${entry.key}' resolves to ${resolved} ${resolved === 1 ? "entity" : "entities"}, but ${props} ${isAre} not read for ${resolved === 1 ? "it" : "them"} in this render — nothing written here will reach the map (spec 08 §6)`
            : this.subjectHits.has(entry.key)
              ? `'${entry.key}' is styled elsewhere, but ${props} on this line ${isAre} never read for it — the property does not apply to this kind of subject (spec 08 §3)`
              : `'${entry.key}' styles nothing in this document — no entity resolves to it, so every property on this line is inert (spec 08 §5)`,
      });
    }
    for (const [name, line] of Object.entries(this.ownGlyphs)) {
      if (this.glyphRefs.has(name)) continue;
      out.push({
        line,
        message: `glyph '${name}' is never referenced by a glyph= or asset= property — it is defined and unreachable (spec 08 §3)`,
      });
    }
    // The other half of the glyph loop (#149): a name that was REFERENCED and
    // never defined. This one hid behind the liveness check rather than being
    // caught by it — `prop(chain, "glyph")` returns the name and registers a
    // hit, and the miss happens afterwards in the glyph table, so the entry
    // counted as live and the fallback chain quietly drew a generic marker.
    //
    // Checked against the DECLARED pool, not against what this render drew: a
    // variant pool is picked by position hash (spec 08 §4), so a member the
    // hash never lands on is still a promise the theme made.
    for (const entry of this.own) {
      for (const name of entry.names) {
        // Defined in ANY layer counts — a child theme may name a glyph its
        // parent supplies, which is what inheritance is for.
        if (this.glyphs[name] !== undefined) continue;
        out.push({
          line: entry.line,
          message: `'${entry.key}' names the glyph '${name}', which no [glyphs] section defines — the render falls back to a generic marker (spec 08 §4)`,
        });
      }
    }
    return out.sort((a, b) => a.line - b.line);
  }

  /** Chain-walking property lookup: word.state > word.zone > word; earlier chain words win. */
  prop(chain: string[], key: string, ctx: ResolveContext = {}): string | undefined {
    for (const word of chain) {
      const candidates = [
        ctx.state ? `${word}.${ctx.state}` : null,
        ctx.zone ? `${word}.${ctx.zone}` : null,
        word,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const value = this.map.get(candidate)?.[key];
        if (value !== undefined) {
          this.hit(candidate, key);
          return value;
        }
      }
    }
    return undefined;
  }

  surface(name: string, key: "fill" | "stroke", fallback: string): string {
    const value = this.map.get(name)?.[key];
    if (value === undefined) return fallback;
    this.hit(name, key);
    return value;
  }

  terrainFill(chain: string[], ctx: ResolveContext = {}): string {
    return this.prop(chain, "fill", ctx) ?? "#d8d3c5";
  }

  pathStroke(chain: string[]): { stroke: string; dash?: string } {
    const stroke = this.prop(chain, "stroke") ?? this.prop(chain, "fill") ?? "#9a917e";
    const dash = this.prop(chain, "dash")?.replace(",", " ");
    return dash ? { stroke, dash } : { stroke };
  }

  side(word: string | undefined): string {
    const fill = word && this.map.get(`side.${word}`)?.["fill"];
    if (!fill) return "#8a6ab5";
    this.hit(`side.${word}`, "fill");
    return fill;
  }

  /**
   * Appearance zones for a chain (spec 08 §2): on an area, blob, or ridge
   * `edge` is the boundary band and `core` the interior; on a path band `edge`
   * is the two side margins and `core` the centre strip.
   *
   * Returns null when the theme declares neither, so a caller can keep its
   * plain single-fill path untouched — which is what every caller did before
   * (#150), leaving one of the four spec'd combinations implemented.
   */
  zones(chain: string[], base: string): { edge: string; core: string; width: number } | null {
    const edge = this.zoneProp(chain, "edge");
    const core = this.zoneProp(chain, "core");
    if (edge === undefined && core === undefined) return null;
    // Declaring only one zone means the other keeps the word's plain fill: an
    // author naming a shoreline band should not have to restate the interior.
    return { edge: edge ?? base, core: core ?? base, width: this.edgeWidth(chain) ?? 4 };
  }

  /**
   * A zone's colour, and ONLY from a `word.core`/`word.edge` entry.
   *
   * `prop(chain, key, { zone })` deliberately falls back to the bare word, so
   * asking it whether a zone is declared always answers yes for any word with
   * a fill — which made "is this banded?" unanswerable, and would have banded
   * every area on every map the moment a caller started asking (#150).
   */
  private zoneProp(chain: string[], zone: "core" | "edge"): string | undefined {
    for (const word of chain) {
      const record = this.map.get(`${word}.${zone}`);
      const value = record?.["fill"] ?? record?.["stroke"];
      if (value !== undefined) {
        this.hit(`${word}.${zone}`, record?.["fill"] !== undefined ? "fill" : "stroke");
        return value;
      }
    }
    return undefined;
  }

  /** Edge-zone thickness in px, if the theme styles an edge for this chain. */
  edgeWidth(chain: string[]): number | null {
    const styled = chain.find((word) => this.map.has(`${word}.edge`));
    if (styled === undefined) return null;
    // Membership alone is the answer here — a `word.edge` line makes the zone
    // exist whether or not it carries `edge=` — so the whole entry counts as
    // used, not one property of it.
    this.hit(`${styled}.edge`, "*");
    return Number(this.prop(chain, "edge") ?? 4) || 4;
  }

  /** Deterministic variant-pool pick (spec 08 §4): position hash, not sequence. */
  pickVariant(value: string, x: number, y: number): string {
    const pool = value.split(",").map((v) => v.trim()).filter(Boolean);
    if (pool.length <= 1) return pool[0] ?? value;
    let h = 2166136261;
    for (const n of [Math.round(x), Math.round(y)]) {
      h ^= n;
      h = Math.imul(h, 16777619);
    }
    return pool[(h >>> 0) % pool.length]!;
  }

  glyphFor(chain: string[], x: number, y: number, ctx: ResolveContext = {}): string | null {
    const named = this.prop(chain, "glyph", ctx);
    if (!named) return null;
    const chosen = this.pickVariant(named, x, y);
    return this.glyphs[chosen] ?? null;
  }
}

export const terrainFill = (word: string): string => TERRAIN_FILLS[word] ?? "#d8d3c5";

/**
 * Deterministic tint for glyphless words (#71): the vocabulary is open, so no
 * curated glyph set can ever cover it — but every word can have a color. Hue
 * from a word hash spread by the golden angle; saturation/lightness pinned to
 * the parchment palette so distinct never means garish. Same word, same color,
 * every map. Hash the chain's BASE word so derived families share their tint.
 */
export function wordTint(word: string): string {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  const hue = Math.round((h * 137.508) % 360);
  return `hsl(${hue} 32% 55%)`;
}

export const tierOf = (word: string | null): { r: number; font: number; weight: string } =>
  (word && TIERS[word]) || { r: 3, font: 10, weight: "normal" };

export const tierFor = (chain: string[]): { r: number; font: number; weight: string } => {
  for (const word of chain) if (TIERS[word]) return TIERS[word]!;
  return { r: 3, font: 10, weight: "normal" };
};

export const hasTierGlyph = (chain: string[]): boolean => chain.some((word) => Boolean(TIERS[word]));

export const hasBattlemapGlyph = (chain: string[]): boolean => chain.some((word) => BATTLEMAP_GLYPHS.has(word));
