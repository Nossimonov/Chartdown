/**
 * The built-in default theme — the fallback-chain terminal (spec 04 §4):
 * everything renders from primitives; no assets, no fonts beyond sans-serif.
 * The theme *file format* is issue #20; this module is the renderer-side
 * default that format will eventually be able to replace.
 */

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

export const terrainFill = (word: string): string => TERRAIN_FILLS[word] ?? "#d8d3c5";

/** Chain-aware lookups (spec 04 §4): walk the derivation chain until a themed word. */
export const terrainFillFor = (chain: string[]): string => {
  for (const word of chain) if (TERRAIN_FILLS[word]) return TERRAIN_FILLS[word];
  return "#d8d3c5";
};

const PATH_STROKES: Record<string, { stroke: string; dash?: string }> = {
  river: { stroke: "#7fa8cf" }, stream: { stroke: "#7fa8cf" }, canal: { stroke: "#7fa8cf" },
  road: { stroke: "#c3a878" }, trail: { stroke: "#c3a878", dash: "6 4" },
  pass: { stroke: "#a89880", dash: "4 4" },
  coastline: { stroke: "#8fa8b8" },
  border: { stroke: "#a05a5a", dash: "8 4" },
};

export const pathStroke = (word: string): { stroke: string; dash?: string } =>
  PATH_STROKES[word] ?? { stroke: "#9a917e" };

export const pathStrokeFor = (chain: string[]): { stroke: string; dash?: string } => {
  for (const word of chain) if (PATH_STROKES[word]) return PATH_STROKES[word];
  return { stroke: "#9a917e" };
};

/** Settlement tiers control glyph radius and label size (spec 07 §1). */
const TIERS: Record<string, { r: number; font: number; weight: string }> = {
  capital: { r: 6, font: 15, weight: "bold" },
  city: { r: 5, font: 13, weight: "bold" },
  town: { r: 4, font: 11, weight: "normal" },
  village: { r: 3, font: 10, weight: "normal" },
  hamlet: { r: 2.5, font: 9, weight: "normal" },
  settlement: { r: 3.5, font: 10, weight: "normal" },
};

export const tierOf = (word: string | null): { r: number; font: number; weight: string } =>
  (word && TIERS[word]) || { r: 3, font: 10, weight: "normal" };

export const tierFor = (chain: string[]): { r: number; font: number; weight: string } => {
  for (const word of chain) if (TIERS[word]) return TIERS[word]!;
  return { r: 3, font: 10, weight: "normal" };
};

export const SIDE_COLORS: Record<string, string> = {
  party: "#4a7ab5",
  ally: "#4a9a6a",
  foe: "#b5504a",
};

export const sideColor = (side: string | undefined): string =>
  (side && SIDE_COLORS[side]) || "#8a6ab5";
