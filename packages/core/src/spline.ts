/**
 * The connecting curve through declared controls.
 *
 * Here in core rather than in the renderer because it is not a rendering
 * choice: it is what a `via` list MEANS. Anything that reasons about the shape
 * an author declared — the renderer that draws it, a tool that measures one and
 * has to know whether its own output can be drawn — must use the same curve, or
 * the second one is checking a line the first will never draw (#192).
 */

export interface SplinePoint {
  x: number;
  y: number;
}

/**
 * Catmull-Rom spline through the declared points — the TRUE curve: a pure
 * function of the input, no noise (spec 02 §9: finishing is not inventing;
 * authors control wiggle with via points). `closed` splines a ring.
 *
 * CENTRIPETAL, not uniform (#189). The uniform spline gives every span an
 * equal share of the parameter however long it is, so a short span next to a
 * long one is traversed at a wildly different speed — and the curve bulges
 * past the short one to make up the difference. Where controls are crowded at
 * a bend and sparse down the straight after it, that bulge loops the line back
 * through itself, and a shape that is perfectly drawable is refused as a fold
 * the author never wrote: Hood Canal, measured off imagery, was refused at
 * every size down to a fifth of the one asked for, while the same shape stated
 * in two evenly spread controls drew at full size.
 *
 * Spacing the knots by the square root of chord length is the standard cure,
 * and it is a guarantee rather than a tuning: a centripetal Catmull-Rom cannot
 * cusp or self-intersect within a span (Yuksel et al. 2011). It also costs
 * nothing where controls are already even — equal chords make the knots equal,
 * which is the uniform spline exactly — so this changes only the curves that
 * were being drawn wrong.
 *
 * The output is ordered: `samples` points per span, then the final control. A
 * caller may therefore locate any sample on the span it came from without
 * re-measuring arc length.
 */
export function catmullRom<T extends SplinePoint>(pts: T[], samples = 8, closed = false): SplinePoint[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const P = (i: number): T =>
    closed ? pts[((i % pts.length) + pts.length) % pts.length]! : pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  const knot = (a: SplinePoint, b: SplinePoint): number => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
  const out: SplinePoint[] = [];
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    // A zero-length knot span divides by zero. It arises two ways, and both
    // want the same answer: at an open end, where the phantom control is the
    // endpoint repeated, and at a repeated interior control. Borrowing the
    // drawn span's own length leaves the blend well defined, and where the two
    // points coincide every weighting of them is that point regardless.
    const d1 = knot(p1, p2) || 1;
    const d0 = knot(p0, p1) || d1;
    const d2 = knot(p2, p3) || d1;
    const t0 = 0;
    const t1 = d0;
    const t2 = t1 + d1;
    const t3 = t2 + d2;
    for (let s = 0; s < samples; s++) {
      const t = t1 + (d1 * s) / samples;
      // Barry-Goldman: three rounds of linear blends over the knot spans. The
      // uniform spline is this with every span set to 1.
      const a1x = ((t1 - t) * p0.x + (t - t0) * p1.x) / (t1 - t0);
      const a1y = ((t1 - t) * p0.y + (t - t0) * p1.y) / (t1 - t0);
      const a2x = ((t2 - t) * p1.x + (t - t1) * p2.x) / (t2 - t1);
      const a2y = ((t2 - t) * p1.y + (t - t1) * p2.y) / (t2 - t1);
      const a3x = ((t3 - t) * p2.x + (t - t2) * p3.x) / (t3 - t2);
      const a3y = ((t3 - t) * p2.y + (t - t2) * p3.y) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
      out.push({
        x: ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1),
        y: ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1),
      });
    }
  }
  if (!closed) {
    const last = pts[pts.length - 1]!;
    out.push({ x: last.x, y: last.y });
  }
  return out;
}

/**
 * Radius of curvature at each vertex of a polyline, by circumscribed circle.
 *
 * `Infinity` where three points are collinear, which correctly asks nothing of
 * a straight run. This is the quantity spec 05 §4 measures a bend against: an
 * offset curve folds where the centerline's radius drops below the half-width
 * it carries, which is local, and no bound on total turn is a proxy for it.
 */
export function radii(curve: SplinePoint[]): number[] {
  const out: number[] = new Array(curve.length).fill(Infinity);
  for (let i = 1; i + 1 < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    const c = curve[i + 1]!;
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    if (area < 1e-12) continue;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    out[i] = (ab * bc * ca) / (4 * area);
  }
  return out;
}
