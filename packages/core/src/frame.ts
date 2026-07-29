/**
 * Framing a traced shape (#174, ADR 0026).
 *
 * A detached feature's outline is declared as OFFSETS from its anchor, so that
 * moving the feature is one coordinate rather than a transform of every vertex,
 * and so the feature stays attached to its host. Tracing a real coastline,
 * though, gives absolute coordinates — and converting eleven of them by hand is
 * exactly the kind of arithmetic whose mistakes are invisible: a shape shifted
 * by a constant is still a plausible island in the wrong place, and one
 * fat-fingered vertex is a plausible island with a cape that is not there.
 *
 * This lives in core, with no dependencies, so the CLI and the MCP server share
 * one implementation rather than two that can drift (ADR 0011).
 */

export interface FramePoint {
  x: number;
  y: number;
}

export interface Framed {
  /** The anchor the offsets are measured from — given, or derived. */
  anchor: FramePoint;
  /** The outline, as offsets from `anchor`. */
  offsets: FramePoint[];
  /** True when the anchor was derived rather than supplied. */
  derived: boolean;
  /** Bounding extent of the shape, so a trace can be sanity-checked at a glance. */
  extent: { width: number; height: number };
}

/**
 * Read a whitespace-separated list of points.
 *
 * Accepts what an author would actually paste: `(12,40) (15,52)`, bare
 * `12,40 15,52`, and a leading shape keyword, so a clause copied straight out
 * of a document round-trips without editing.
 */
export function parsePoints(text: string): FramePoint[] | { error: string } {
  const cleaned = text.trim().replace(/^(area|path|blob|ridge|outline)\s+/i, "");
  if (cleaned === "") return { error: "no points given" };
  const tokens = cleaned.match(/\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)|-?[\d.]+\s*,\s*-?[\d.]+/g);
  if (!tokens) return { error: `could not read any points from '${text.trim()}'` };
  // Anything left over once the points are removed is a typo the author wants
  // to hear about — silently dropping it is how a vertex goes missing.
  const leftover = tokens.reduce((s, t) => s.replace(t, ""), cleaned).trim();
  if (leftover !== "") return { error: `unexpected '${leftover}' — points look like (x,y), separated by spaces` };
  const points: FramePoint[] = [];
  for (const token of tokens) {
    const [x, y] = token.replace(/[()]/g, "").split(",").map((n) => Number(n.trim())) as [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: `'${token}' is not a point` };
    points.push({ x, y });
  }
  return points;
}

/** Decimal places used by the most precise coordinate given, capped for sanity. */
function precisionOf(points: FramePoint[]): number {
  let best = 0;
  for (const p of points) {
    for (const n of [p.x, p.y]) {
      const dot = String(n).indexOf(".");
      if (dot >= 0) best = Math.max(best, String(n).length - dot - 1);
    }
  }
  return Math.min(best, 6);
}

const round = (n: number, places: number): number => {
  const k = 10 ** places;
  // `+0` so a negative zero prints as 0 rather than -0, which reads as a typo.
  return Math.round(n * k) / k + 0;
};

/**
 * Convert an absolute trace into an anchor plus framed offsets.
 *
 * With no anchor supplied one is derived from the shape's own centre, because a
 * fresh trace has no anchor yet — and it is rounded to the precision the author
 * traced at, so the offsets come out as tidy as the input rather than trailing
 * the centroid's decimals through every vertex.
 */
export function frameShape(points: FramePoint[], anchor?: FramePoint): Framed {
  const places = precisionOf(points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const at = anchor ?? {
    x: round((Math.min(...xs) + Math.max(...xs)) / 2, places),
    y: round((Math.min(...ys) + Math.max(...ys)) / 2, places),
  };
  return {
    anchor: at,
    offsets: points.map((p) => ({ x: round(p.x - at.x, places), y: round(p.y - at.y, places) })),
    derived: anchor === undefined,
    extent: { width: round(Math.max(...xs) - Math.min(...xs), places), height: round(Math.max(...ys) - Math.min(...ys), places) },
  };
}

/** The inverse: offsets back to absolute points, so a framed shape can be re-traced. */
export function unframeShape(offsets: FramePoint[], anchor: FramePoint): FramePoint[] {
  const places = Math.max(precisionOf(offsets), precisionOf([anchor]));
  return offsets.map((p) => ({ x: round(anchor.x + p.x, places), y: round(anchor.y + p.y, places) }));
}

/** Render points as the `(x,y) (x,y)` list a document uses. */
export function formatPoints(points: FramePoint[]): string {
  return points.map((p) => `(${p.x},${p.y})`).join(" ");
}
