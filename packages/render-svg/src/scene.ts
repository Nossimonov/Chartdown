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

import type { Diagnostic, EntityNode } from "@chartdown/core";
import { entityAnchor, labelTextFor, type Model, type RenderMode } from "./model";
import type { Item, RegionFrame, Resolved } from "./region";
import type { XY } from "./util";

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
  | { kind: "polygon"; points: ScenePoint[]; from?: SceneDerivation };

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
    case "polygon": {
      if (g.points.length === 0) return { x: 0, y: 0 };
      let x = 0;
      let y = 0;
      for (const p of g.points) {
        x += p.x;
        y += p.y;
      }
      return { x: x / g.points.length, y: y / g.points.length };
    }
  }
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
