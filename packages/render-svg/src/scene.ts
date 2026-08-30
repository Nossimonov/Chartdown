/**
 * THE RESOLVED SCENE (#355, ADR 0051): the renderer's answer as data, before
 * it is ink.
 *
 * `render` resolves a whole sheet on every call — positions, outlines,
 * half-planes, organic finishing — and discards it when the function returns.
 * A host that draws Chartdown with its own primitives therefore had to derive
 * that geometry a second time from the AST, and the only place the answer
 * existed was inside a closure.
 *
 * WHAT IS IN HERE IS DECIDED BY ADR 0037's SPLIT, and that rule is the whole
 * membership test: anything that decides *where the land is* belongs to the
 * scene; anything that is *ink laid on top* does not. So there are no stroke
 * widths, no font sizes, no ADR 0035 legibility floor, no zone insets and no
 * glyph scatter in this file. Those are a host theme engine's business, and
 * the theme *document* is already the interchange format for them.
 *
 * GEOMETRY IS IN MAP UNITS — the `extent:`'s own units on a region, cells on a
 * battlemap, hex radii on a hexcrawl. Not canvas units. A canvas number moves
 * with `detail: overview | reference` (ADR 0020: 820 → 1640), and ADR 0037
 * forbids a rendering choice from moving geometry.
 *
 * GEOMETRY IS WHAT IS DRAWN, after organic finishing — the outline the coast
 * *has*, not the outline the document declared. A host's coast therefore
 * agrees with this renderer's coast on the same document, which is the point.
 */

import { slugify, type Diagnostic, type EntityNode } from "@chartdown/core";
import type { Frame } from "./battlemap";
import { CELL, MARGIN, halfPlaneContext, perimeterEdges, structureCells, surfaceCells, type Cell, type EdgeFacing } from "./grid";
import type { HexFrame } from "./hexcrawl";
import { collectWalls } from "./walls";
import { entityAnchor, labelTextFor, type Model, type RenderMode } from "./model";
import type { Item, RegionFrame, Resolved } from "./region";
import type { Segment, XY } from "./util";

/** The schema's own version, moving with the package and NOT with `SPEC_VERSION`. */
export const SCENE_SCHEMA_VERSION = "1";

/** A coordinate in map units. */
export interface ScenePoint {
  x: number;
  y: number;
}

/**
 * Why a polygon has the shape it has, when the shape was derived rather than
 * declared. Stated for the same reason `resolvedNotes` exists on the model: a
 * host that draws the water should still be able to say why it stops there.
 */
export interface SceneDerivation {
  /** The compass side of `of` that the field was cut on. */
  halfPlane: string;
  /** Anchor of the course it was cut against, when that course is identified. */
  of?: string;
}

export type SceneGeometry =
  | { kind: "point"; at: ScenePoint }
  | { kind: "circle"; at: ScenePoint; radius: number }
  | { kind: "polyline"; points: ScenePoint[]; width?: number }
  | { kind: "ridge"; points: ScenePoint[]; width?: number }
  | { kind: "polygon"; points: ScenePoint[]; from?: SceneDerivation }
  /**
   * A cell union, in cell (or hex) coordinates: `{x: col, y: row}`, 1-based as
   * the author writes them. What a grid map's geometry actually IS — a
   * structure occupies cells, not an outline, and spec 06 §3 derives the
   * outline FROM the cells.
   */
  | { kind: "cells"; cells: ScenePoint[] };

/** A wall or portal run, in cell coordinates. */
export interface SceneSegment {
  a: ScenePoint;
  b: ScenePoint;
}

/**
 * A label's ANCHOR, not its placement. Arbitration — which label yields to
 * which, and how far it slides along its course — is interleaved with SVG
 * emission across roughly 1,400 lines and the placer is stateful, so hoisting
 * it decides a second thing and is a separate change. v1 says where a label
 * wants to be; a consuming host places it.
 */
export interface SceneLabel {
  anchor: ScenePoint;
  text: string | null;
  /** Key number under `labels: keyed` (spec 07 §3). */
  key?: number;
}

export interface SceneFeature {
  /** Explicit id, else display-name slug, else `@anon-<line>` — `entityAnchor`. */
  anchor: string;
  line: number;
  section: string;
  /** Resolved level (spec 06 §8); the default level on a single-level map. */
  level: string;
  /** The type word as written, before resolution. */
  word: string | null;
  archetype: string;
  /** Derivation chain (spec 04 §4), so a host can apply its own theme through the same fallback. */
  chain: string[];
  flags: string[];
  /** The entity's own pairs. Facets resolved along `chain` are the host's to apply, as they are here. */
  pairs: Record<string, string>;
  geometry?: SceneGeometry;
  label?: SceneLabel;
  /**
   * Vertex ranges of `geometry.points` spliced from a followed feature (#81) —
   * how a zone's boundary came to share a coast's outline.
   */
  along?: { ref: string; refKey?: string; start: number; end: number }[];
  /**
   * The derived boundary of a `cells` union (spec 06 §3) — one entry per
   * exposed cell side. Carried because it is what a host draws a wall along,
   * and re-deriving it is how two implementations start disagreeing about
   * whether a shared wall belongs to one room or both.
   */
  perimeter?: { cell: ScenePoint; dir: EdgeFacing }[];
}

export interface SceneResult {
  /** Versioned with the package. A renderer output is not language. */
  schemaVersion: string;
  mapType: string;
  /** The scene is produced PER MODE (ADR 0045) — a host does not filter a full scene itself. */
  mode: RenderMode;
  /** `extent:`'s unit ("mi", "km", …), "cell" on a battlemap, "" if bare. */
  unit: string;
  /** The field, in `unit`. */
  extent: { w: number; h: number };
  /** Physical order, topmost first (spec 06 §8). Absent on a map with one level. */
  levels?: string[];
  features: SceneFeature[];
  /**
   * Battlemap sight and movement geometry, in cell coordinates, from the same
   * `walls.ts` the light engine and `exportUvtt` read (ADR 0010). Absent on
   * map kinds that have no walls.
   */
  walls?: {
    blockers: SceneSegment[];
    losWalls: SceneSegment[];
    portals: { seg: SceneSegment; closed: boolean }[];
  };
  diagnostics: Diagnostic[];
}

/** Map units from canvas units. Exact: `toXY` multiplied by the same number. */
const unscale = (p: XY, scale: number): ScenePoint => ({ x: p.x / scale, y: p.y / scale });

const unscaleAll = (pts: XY[], scale: number): ScenePoint[] => pts.map((p) => unscale(p, scale));

const pairsOf = (e: EntityNode): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of e.pairs) out[p.key] = p.value;
  return out;
};

/**
 * The representative point a label hangs off. Not the placed position — see
 * `SceneLabel`.
 */
const labelAnchor = (g: SceneGeometry): ScenePoint => {
  switch (g.kind) {
    case "point":
    case "circle":
      return g.at;
    case "polyline":
    case "ridge":
      // Mid-COURSE by vertex, which is where spec 07 §5 anchors a path's name
      // before arbitration slides it.
      return g.points[Math.floor(g.points.length / 2)] ?? { x: 0, y: 0 };
    case "polygon":
      return mean(g.points);
    case "cells":
      return mean(g.cells);
  }
};

/**
 * The centre of a set of points. For a cell union — an L-shaped hall — this
 * lands inside the shape, where the middle of its bounding box would not.
 */
const mean = (pts: ScenePoint[]): ScenePoint => {
  if (pts.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
};

/**
 * A resolved entity's geometry, in map units.
 *
 * The order of these tests is the precedence the renderer already draws by: a
 * half-plane is a polygon that knows why it is one, a declared outline beats a
 * course, and a ridge is a BELT rather than a centreline (so it is not a plain
 * polyline).
 */
const geometryOf = (r: Resolved, scale: number): SceneGeometry | undefined => {
  if (r.halfPlane?.polygon?.length) {
    return {
      kind: "polygon",
      points: unscaleAll(r.halfPlane.polygon, scale),
      from: { halfPlane: r.halfPlane.compass, ...(r.halfPlane.refKey ? { of: r.halfPlane.refKey } : {}) },
    };
  }
  if (r.polygon?.length) return { kind: "polygon", points: unscaleAll(r.polygon, scale) };
  if (r.polyline?.length) {
    const points = unscaleAll(r.polyline, scale);
    const width = r.beltW === undefined ? undefined : r.beltW / scale;
    return r.ridge ? { kind: "ridge", points, ...(width === undefined ? {} : { width }) }
      : { kind: "polyline", points, ...(width === undefined ? {} : { width }) };
  }
  if (r.point && r.radius !== undefined) {
    return { kind: "circle", at: unscale(r.point, scale), radius: r.radius / scale };
  }
  if (r.point) return { kind: "point", at: unscale(r.point, scale) };
  return undefined;
};

/**
 * A region's resolved geometry as a scene.
 *
 * Takes what `resolveRegionGeometry` already produced rather than resolving
 * again: one resolution pass, two views (ADR 0010, generalised from walls to
 * the whole sheet). A second pass that re-derived would be the drift that ADR
 * rejected outright.
 */
export function sceneFromRegion(
  model: Model,
  frame: RegionFrame,
  items: Item[],
  diagnostics: Diagnostic[],
): SceneResult {
  const features: SceneFeature[] = [];
  for (const { e, r, chain } of items) {
    const geometry = geometryOf(r, frame.scale);
    const text = labelTextFor(model, e);
    const key = model.keys.get(e);
    features.push({
      anchor: entityAnchor(e) ?? `@anon-${e.line}`,
      line: e.line,
      section: e.section,
      level: e.level,
      word: e.typeWord,
      archetype: e.archetype,
      chain,
      flags: e.flags,
      pairs: pairsOf(e),
      ...(geometry ? { geometry } : {}),
      // A feature with no geometry still carries identity: it is what the
      // dead-declaration lint (#116) and a host's own report both read.
      ...(geometry ? { label: { anchor: labelAnchor(geometry), text, ...(key === undefined ? {} : { key }) } } : {}),
      ...(r.alongSpans?.length ? { along: r.alongSpans } : {}),
    });
  }
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    mapType: "region",
    mode: model.mode,
    unit: frame.unit,
    extent: { w: frame.unitsW, h: frame.unitsH },
    features,
    diagnostics,
  };
}

// ---------- grid maps ----------

/**
 * Cell coordinates from canvas px. `cellOrigin` added the margin and
 * multiplied by `CELL`; this divides both back out, exactly.
 */
const toCellXY = (p: XY): ScenePoint => ({ x: (p.x - MARGIN) / CELL + 1, y: (p.y - MARGIN) / CELL + 1 });

const toSceneSeg = (s: Segment): SceneSegment => ({ a: toCellXY(s.a), b: toCellXY(s.b) });

/** Deterministic order: reading order, so a snapshot is stable. */
const cellPoints = (cells: Map<string, Cell>): ScenePoint[] =>
  [...cells.values()]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((c) => ({ x: c.col, y: c.row }));

/** Identity is the same question on every map kind, so it is asked once. */
const identityOf = (model: Model, e: EntityNode, chain: string[]): Omit<SceneFeature, "geometry" | "label" | "along" | "perimeter"> => ({
  anchor: entityAnchor(e) ?? `@anon-${e.line}`,
  line: e.line,
  section: e.section,
  level: e.level,
  word: e.typeWord,
  archetype: e.archetype,
  chain,
  flags: e.flags,
  pairs: pairsOf(e),
});

const gridFeature = (model: Model, e: EntityNode, cells: Map<string, Cell>): SceneFeature => {
  const pts = cellPoints(cells);
  const base = identityOf(model, e, model.chainOf(e.typeWord));
  if (pts.length === 0) return base;
  const text = labelTextFor(model, e);
  const key = model.keys.get(e);
  const geometry: SceneGeometry = { kind: "cells", cells: pts };
  return {
    ...base,
    geometry,
    label: { anchor: labelAnchor(geometry), text, ...(key === undefined ? {} : { key }) },
    perimeter: perimeterEdges(cells).map((pe) => ({ cell: { x: pe.cell.col, y: pe.cell.row }, dir: pe.dir })),
  };
};

/**
 * A battlemap's resolved geometry as a scene.
 *
 * Assembled from `grid.ts` and `walls.ts` rather than by hoisting
 * `renderBattlemap`, because on this map kind the geometry was hoisted
 * already: `halfPlaneContext`'s own comment says it exists so that a
 * relational extent "reads the same to the renderer, the lints, the wall
 * collector and the exporter". A scene is the fourth of those, and it reads
 * the same functions rather than a fourth copy of them.
 *
 * ALL LEVELS, one scene. `render` stacks them as panels and `exportUvtt` takes
 * one because UVTT is one map per file; a scene is what a host draws FROM, so
 * it carries `levels` and tags each feature, and `level` narrows it. The panel
 * translate `render` applies is canvas layout, which ADR 0037 keeps out here.
 */
export function sceneFromBattlemap(
  model: Model,
  frame: Frame,
  diagnostics: Diagnostic[],
  level?: string,
): SceneResult {
  const levels = model.doc.levels.length > 0 ? model.doc.levels : [model.doc.defaultLevel];
  const shown = level === undefined ? model.entities : model.entities.filter((e) => e.level === level);
  const ctx = halfPlaneContext(model.doc, model.entities);
  const features = shown.map((e) => {
    // Both spellings of "which cells": a footprint from ranges and addresses,
    // and a surface from an area, a path band or a relational extent.
    const cells = new Map([...structureCells(e), ...surfaceCells(e, ctx)]);
    return gridFeature(model, e, cells);
  });
  const walls = collectWalls(level === undefined ? model : { ...model, entities: shown });
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    mapType: "battlemap",
    mode: model.mode,
    unit: "cell",
    extent: { w: frame.cols, h: frame.rows },
    ...(levels.length > 1 ? { levels } : {}),
    features,
    walls: {
      blockers: walls.blockers.map(toSceneSeg),
      losWalls: walls.losWalls.map(toSceneSeg),
      portals: walls.portals.map((q) => ({ seg: toSceneSeg(q.seg), closed: q.closed })),
    },
    diagnostics,
  };
}

/**
 * A hexcrawl's resolved geometry as a scene.
 *
 * Hex coordinates, not canvas px: a hexcrawl's authored unit IS the address,
 * and a host that knows the parity can place the centres itself from
 * `extent` — where a px centre would move the moment `R` did.
 *
 * v1 carries the hexes and their identity. The derived region boundaries and
 * the drawn route curves stay internal for now: both are computed inside the
 * emit pass and neither has a pure function to read, so hoisting them is the
 * same separate change that placed labels are.
 */
export function sceneFromHexcrawl(model: Model, frame: HexFrame, diagnostics: Diagnostic[]): SceneResult {
  const features: SceneFeature[] = model.entities.map((e) => gridFeature(model, e, structureCells(e)));
  // A hex line addresses its hexes directly, where an entity uses placements.
  // `structureCells` takes both, so the two spellings resolve identically.
  for (const line of model.hexLines) {
    const cells = structureCells({ placements: line.addresses });
    const pts = cellPoints(cells);
    if (pts.length === 0) continue;
    features.push({
      anchor: line.name ? slugify(line.name) : `@anon-${line.line}`,
      line: line.line,
      section: "hexes",
      level: model.doc.defaultLevel,
      word: line.terrain,
      archetype: "terrain",
      chain: model.chainOf(line.terrain),
      flags: line.flags,
      pairs: Object.fromEntries(line.pairs.map((q) => [q.key, q.value])),
      geometry: { kind: "cells", cells: pts },
      ...(line.name ? { label: { anchor: pts[0]!, text: line.name } } : {}),
    });
  }
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    mapType: "hexcrawl",
    mode: model.mode,
    unit: "hex",
    extent: { w: frame.cols, h: frame.rows },
    features,
    diagnostics,
  };
}
