/**
 * The theme engine (spec 08). The built-in palette is expressed as a theme
 * document (DEFAULT_THEME_SOURCE) and parsed by the same machinery user
 * themes use — no privileged styling path. User themes shadow it via
 * `use: default` or are layered on top when passed to the renderer.
 */

import { parseThemeDocument, type Diagnostic, type ThemeDocumentNode } from "@chartdown/core";

export const PAPER = "#f9f5ea";
export const GRID_LINE = "#c9c2b0";
export const FOG = "#ded8ca";
export const INK = "#3d3629";

const TERRAIN_FILLS: Record<string, string> = {
  sea: "#b9d3e6", lake: "#b9d3e6", water: "#b9d3e6",
  plains: "#e9e3c6", grassland: "#dde5b8", farmland: "#e7d9a6",
  forest: "#a9c79c", jungle: "#8fbc8b",
  hills: "#d9cba6", mountains: "#c3b8a5",
  marsh: "#c2d2c0", desert: "#eeddb0", dunes: "#eeddb0",
  snowfield: "#eff2f4", snow: "#eff2f4", tundra: "#dfe4dd", ice: "#dcebf2",
  wasteland: "#d4c8b8", mud: "#c8b294", sand: "#ecdfb8", grass: "#dde5b8",
  rubble: "#cfc8bc", slope: "#d9d0bd",
  ford: "#cfd4b8",
};

const PATH_STROKES: Record<string, { stroke: string; dash?: string }> = {
  river: { stroke: "#7fa8cf" }, stream: { stroke: "#7fa8cf" }, canal: { stroke: "#7fa8cf" },
  road: { stroke: "#c3a878" }, trail: { stroke: "#c3a878", dash: "6 4" },
  pass: { stroke: "#a89880", dash: "4 4" },
  coastline: { stroke: "#8fa8b8" },
  border: { stroke: "#a05a5a", dash: "8 4" },
};

const TIERS: Record<string, { r: number; font: number; weight: string }> = {
  capital: { r: 6, font: 15, weight: "bold" },
  city: { r: 5, font: 13, weight: "bold" },
  town: { r: 4, font: 11, weight: "normal" },
  village: { r: 3, font: 10, weight: "normal" },
  hamlet: { r: 2.5, font: 9, weight: "normal" },
  settlement: { r: 3.5, font: 10, weight: "normal" },
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
  "ledge : stroke=#6b5d4a",
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

export class Theme {
  private map = new Map<string, Record<string, string>>();
  readonly glyphs: Record<string, string> = {};

  private merge(doc: ThemeDocumentNode): void {
    for (const entry of doc.entries) {
      const key = entry.sub ? `${entry.base}.${entry.sub}` : entry.base;
      this.map.set(key, { ...this.map.get(key), ...entry.pairs });
    }
    Object.assign(this.glyphs, doc.glyphs);
  }

  /**
   * Build a theme: the default document, then an optional user theme source.
   * A `use: default` inside the user theme is honored (and implicit layering
   * on top of the default applies regardless, per spec 08 §5 selection).
   */
  static resolve(userSource: string | string[] | undefined, diagnostics: Diagnostic[]): Theme {
    const theme = new Theme();
    theme.merge(parseThemeDocument(DEFAULT_THEME_SOURCE, diagnostics));
    const sources = userSource === undefined ? [] : Array.isArray(userSource) ? userSource : [userSource];
    for (const source of sources) {
      // `use:` values other than 'default' are the consumer's to pre-resolve
      // into this list (the CLI reads them from disk); 'default' is implicit.
      theme.merge(parseThemeDocument(source, diagnostics));
    }
    return theme;
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
        if (value !== undefined) return value;
      }
    }
    return undefined;
  }

  surface(name: string, key: "fill" | "stroke", fallback: string): string {
    return this.map.get(name)?.[key] ?? fallback;
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
    return (word && this.map.get(`side.${word}`)?.["fill"]) || "#8a6ab5";
  }

  /** Edge-zone thickness in px, if the theme styles an edge for this chain. */
  edgeWidth(chain: string[]): number | null {
    const styled = chain.some((word) => this.map.has(`${word}.edge`));
    if (!styled) return null;
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

export const tierOf = (word: string | null): { r: number; font: number; weight: string } =>
  (word && TIERS[word]) || { r: 3, font: 10, weight: "normal" };

export const tierFor = (chain: string[]): { r: number; font: number; weight: string } => {
  for (const word of chain) if (TIERS[word]) return TIERS[word]!;
  return { r: 3, font: 10, weight: "normal" };
};

export const hasTierGlyph = (chain: string[]): boolean => chain.some((word) => Boolean(TIERS[word]));

export const hasBattlemapGlyph = (chain: string[]): boolean => chain.some((word) => BATTLEMAP_GLYPHS.has(word));
