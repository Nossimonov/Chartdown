/**
 * Universal VTT export (spec 06 §9, issue #40): the archetype facets map 1:1
 * onto UVTT — wall geometry → line_of_sight, openings → portals, light= →
 * lights, grid+scale → resolution. Export is a transform, not an
 * interpretation: geometry comes from the same walls.ts the light engine
 * uses, in grid units.
 *
 * The exporter emits geometry plus the matching SVG and its grid-aligned
 * image region; the RASTER is the caller's job (the renderer stays
 * runtime-dependency-free, and node has no canvas). Callers rasterize the
 * region at `pixels_per_grid` and drop the base64 into `image`.
 */

import { parse, type Diagnostic, type DocumentNode } from "@chartdown/core";
import { CELL, cellCenter, MARGIN, measureToCells, rangeRect, titleBand } from "./grid";
import { render } from "./index";
import { buildModel, pairOf, type RenderMode } from "./model";
import { Theme } from "./theme";
import type { XY } from "./util";
import { collectWalls } from "./walls";

export interface UvttOptions {
  /** Fail-closed default per spec 01 §6. */
  mode?: RenderMode;
  /** Which floor to export (UVTT is one map per file); default `level:`. */
  level?: string;
  /** Raster density the caller will use; recorded in `resolution`. Default 70. */
  pixelsPerGrid?: number;
  /** Base64 PNG (no data-URI prefix) if the caller already has one. */
  image?: string;
}

export interface UvttResult {
  /** The UVTT document (image empty unless provided) — null on error. */
  uvtt: Record<string, unknown> | null;
  /** The SVG this export's geometry corresponds to (same mode and level). */
  svg: string | null;
  /** Pixel rect of the playable grid within that SVG — rasterize exactly this. */
  imageRegion: { x: number; y: number; w: number; h: number } | null;
  diagnostics: Diagnostic[];
}

export interface UvttSourceResult extends UvttResult {
  document: DocumentNode;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function exportUvtt(doc: DocumentNode, options: UvttOptions = {}): UvttResult {
  const mode = options.mode ?? "player";
  const diagnostics: Diagnostic[] = [];

  if (doc.mapType !== "battlemap") {
    diagnostics.push({
      severity: "error",
      line: 1,
      message: `UVTT export is battlemap-only — a ${doc.mapType} map has no UVTT geometry (spec 06 §9)`,
    });
    return { uvtt: null, svg: null, imageRegion: null, diagnostics };
  }

  const theme = Theme.resolve(undefined, diagnostics);
  const model = buildModel(doc, mode, theme, diagnostics);
  const levels = doc.levels.length > 0 ? doc.levels : [doc.defaultLevel];
  const level = options.level ?? doc.defaultLevel;
  if (!levels.includes(level)) {
    diagnostics.push({
      severity: "error",
      line: 1,
      message: `level '${level}' is not declared — levels are: ${levels.join(" ")} (spec 06 §8)`,
    });
    return { uvtt: null, svg: null, imageRegion: null, diagnostics };
  }

  const panelModel = { ...model, entities: model.entities.filter((e) => e.level === level) };
  const { losWalls, portals } = collectWalls(panelModel);
  const cols = doc.grid?.cols ?? 20;
  const rows = doc.grid?.rows ?? 15;
  const toGrid = (p: XY): { x: number; y: number } => ({
    x: round3((p.x - MARGIN) / CELL),
    y: round3((p.y - MARGIN) / CELL),
  });

  const lights: Record<string, unknown>[] = [];
  for (const e of panelModel.entities) {
    const light = pairOf(e.pairs, "light");
    if (light === undefined) continue;
    const address = e.placements.find((p) => p.kind === "address");
    const range = e.placements.find((p) => p.kind === "range");
    let center: XY | null = null;
    if (address) center = cellCenter(address);
    else if (range) {
      const r = rangeRect(range);
      center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
    if (!center) continue;
    lights.push({
      position: toGrid(center),
      range: round3(measureToCells(light, model)),
      intensity: 1,
      color: "ffd98aff",
      shadows: true,
    });
  }

  const rendered = render(doc, { mode, level });
  diagnostics.push(...rendered.diagnostics);
  const band = titleBand(doc, model.header);

  const uvtt: Record<string, unknown> = {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: cols, y: rows },
      pixels_per_grid: options.pixelsPerGrid ?? 70,
    },
    line_of_sight: losWalls.map((s) => [toGrid(s.a), toGrid(s.b)]),
    objects_line_of_sight: [],
    portals: portals.map((p) => ({
      position: toGrid({ x: (p.seg.a.x + p.seg.b.x) / 2, y: (p.seg.a.y + p.seg.b.y) / 2 }),
      bounds: [toGrid(p.seg.a), toGrid(p.seg.b)],
      rotation: 0,
      closed: p.closed,
      freestanding: false,
    })),
    environment: { baked_lighting: false, ambient_light: "ffffffff" },
    lights,
    image: options.image ?? "",
  };

  return {
    uvtt,
    svg: rendered.svg,
    imageRegion: { x: MARGIN, y: MARGIN + band, w: cols * CELL, h: rows * CELL },
    diagnostics,
  };
}

/** Convenience: parse + export in one call (mirrors renderSource). */
export function exportUvttSource(source: string, options: UvttOptions = {}): UvttSourceResult {
  const parsed = parse(source);
  const result = exportUvtt(parsed.document, options);
  return { ...result, document: parsed.document, diagnostics: [...parsed.diagnostics, ...result.diagnostics] };
}
