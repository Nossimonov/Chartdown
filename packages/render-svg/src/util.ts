/** SVG building, deterministic PRNG, and geometry helpers. */

export interface XY {
  x: number;
  y: number;
}

/**
 * The finest distance the renderer can express, in rendered units.
 *
 * `fmt` prints two decimals, so two vertices closer together than this are the
 * same vertex as far as the output is concerned. Exported because geometry that
 * samples a curve needs the same number: emitting vertices below the quantum
 * costs points, and their positions are then dominated by arithmetic noise
 * rather than by shape — which measures as a corner that nothing can draw.
 */
export const QUANTUM = 0.01;

/** Fixed-precision formatting keeps output byte-identical across runs. */
export const fmt = (n: number): string => {
  const rounded = Math.round(n / QUANTUM) * QUANTUM;
  return Object.is(rounded, -0) ? "0" : String(Number(rounded.toFixed(2)));
};

export const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Attrs = Record<string, string | number | undefined>;

export function el(name: string, attrs: Attrs, ...children: string[]): string {
  const attrText = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? fmt(v) : esc(String(v))}"`)
    .join("");
  const body = children.join("");
  return body ? `<${name}${attrText}>${body}</${name}>` : `<${name}${attrText}/>`;
}

/**
 * <title> content is user text (display names, gm= notes) — escape it here so
 * el()'s children-are-markup contract can stay intact (#79).
 */
export const svgTitle = (content: string): string => `<title>${esc(content)}</title>`;

export const text = (content: string, attrs: Attrs): string =>
  `<text${Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? fmt(v) : esc(String(v))}"`)
    .join("")}>${esc(content)}</text>`;

/**
 * A point list for a `polyline`/`polygon`, with CONSECUTIVE DUPLICATES DROPPED
 * AT THE PRINTED PRECISION (#176).
 *
 * Two vertices closer together than `fmt` can express print as the same pair of
 * numbers, and the segment between them is then zero-length. That is invisible
 * — it draws nothing — but it is not harmless: a zero-length segment has no
 * direction, so anything measuring the drawn curve reads an arbitrary angle
 * there. It is why a coastline whose geometry turns 29° was measured turning
 * 155.9°, and why a shape that had already passed the renderer's own 135° fold
 * check appeared to violate it. The check was right and the output was lying.
 *
 * Deduped HERE, once, rather than in each shape that might produce a near-pair:
 * the criterion is a property of the output format rather than of any geometry,
 * so `fmt`'s own answer is the exact test and no tolerance has to be guessed.
 * Every earlier attempt guessed one in world units and was finer than the two
 * decimal places actually printed.
 */
export const pointsAttr = (pts: XY[]): string => {
  const out: string[] = [];
  for (const p of pts) {
    const at = `${fmt(p.x)},${fmt(p.y)}`;
    if (at !== out[out.length - 1]) out.push(at);
  }
  return out.join(" ");
};

/** mulberry32 — small, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a set of numbers into an rng seed — organic shapes key on their OWN
 * geometry (center, size, points) plus the document seed, never on document
 * position: appending an entity can never reshape another (spec 02 §8).
 */
/** Deterministic string hash, for identity-keyed shapes. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function hashSeed(...nums: number[]): number {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    const v = Math.round(n * 8) | 0;
    h = Math.imul(h ^ (v & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 8) & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 16) & 0xff), 16777619);
  }
  return h >>> 0;
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
 */
export function catmullRom(pts: XY[], samples = 8, closed = false): XY[] {
  if (pts.length < 3) return pts.slice();
  const P = (i: number): XY =>
    closed ? pts[((i % pts.length) + pts.length) % pts.length]! : pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  const knot = (a: XY, b: XY): number => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
  const out: XY[] = [];
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
  if (!closed) out.push(pts[pts.length - 1]!);
  return out;
}

/** Organic finishing: midpoint-displacement jitter of a polyline (two rounds). */
export function meander(points: XY[], amount: number, random: () => number): XY[] {
  let current = points;
  for (let round = 0; round < 2; round++) {
    const next: XY[] = [];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]!;
      const b = current[i + 1]!;
      next.push(a);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = (random() - 0.5) * amount * (round === 0 ? 1 : 0.5);
      next.push({ x: mx + (-dy / len) * off, y: my + (dx / len) * off });
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
}

/**
 * How far the finishing may pull the boundary in from the declared extent.
 * Texture, not silhouette (#96): enough to read as drawn rather than plotted,
 * never enough to make the shape a different shape.
 */
const INSET = 0.38;

/**
 * A mass of DECLARED EXTENT: an outline whose long axis measures exactly
 * `size`, centred on `center`, turned by `angle`, with its short axis
 * `size × shortRatio`.
 *
 * A BLOB DECLARES AN EXTENT, NOT AN OUTLINE (#173, ADR 0025). The shape this
 * replaces was fourteen points of radial jitter keyed on the document seed, the
 * entity's identity and its ordinal among same-size siblings, which meant
 * naming a blob reshaped it, swapping two lines in the file swapped two
 * islands' outlines, and three `size=40mi` blobs measured 42.5, 42.0 and
 * 41.6mi across. Spec 05 §4 already forbids that last one in terms — "it makes
 * `size=` a lie … the number in the document would stop determining what is on
 * the map" — so the language was carrying two opposite contracts on one pair.
 *
 * Here the extent is exact by construction: the boundary is perturbed INWARD
 * only, and the result is normalised so its long axis is precisely `size`. The
 * perturbation is texture the renderer owns and nothing may reference — the
 * same standing `area` outlines already have under spec 02 §9 — and it is a
 * pure function of the arguments, so it carries no seed, no ordinal and no
 * identity.
 */
export function organicMass(
  center: XY, size: number, shortRatio: number, angle: number,
  random: () => number, segments = 14,
): XY[] {
  // Generated ROUND and then fitted to the declared extent, rather than
  // generated elongated. The texture is then the same character whatever
  // `reach=` says, so stretching an island does not also re-texture it.
  const raw: XY[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = 1 - INSET * random();
    raw.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  // Smoothed BEFORE fitting, because a spline may overshoot its controls —
  // measuring the extent of the drawn curve is the only way `size=` is exact
  // in the thing a reader actually sees.
  const smooth = catmullRom(raw, 5, true);
  const xs = smooth.map((p) => p.x);
  const ys = smooth.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  // BOTH axes are fitted, not just the long one. Fitting only the long axis
  // left `reach=1` — which the spec calls a circle — measurably oval, because
  // an inward-only perturbation shrinks the two axes by different amounts.
  const kx = x1 > x0 ? size / (x1 - x0) : 1;
  const ky = y1 > y0 ? (size * shortRatio) / (y1 - y0) : 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return smooth.map((p) => {
    const x = (p.x - cx) * kx;
    const y = (p.y - cy) * ky;
    return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
  });
}

export function nearestOnPolyline(pts: XY[], target: XY): XY {
  let best: XY = pts[0]!;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lenSq));
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/**
 * Sub-polyline between the exact projections of two points — for `A to B
 * along X`: the returned guide starts and ends where a and b meet the line,
 * so callers can connect real endpoint markers to it.
 */
export function subPolylineBetween(pts: XY[], a: XY, b: XY): XY[] {
  const param = (target: XY): { d: number; i: number; t: number; p: XY } => {
    let best = { d: Infinity, i: 0, t: 0, p: pts[0]! };
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((target.x - p1.x) * dx + (target.y - p1.y) * dy) / lenSq));
      const p = { x: p1.x + t * dx, y: p1.y + t * dy };
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < best.d) best = { d, i, t, p };
    }
    return best;
  };
  let pa = param(a);
  let pb = param(b);
  let reversed = false;
  if (pa.i > pb.i || (pa.i === pb.i && pa.t > pb.t)) {
    [pa, pb] = [pb, pa];
    reversed = true;
  }
  const out: XY[] = [pa.p];
  for (let i = pa.i + 1; i <= pb.i; i++) out.push(pts[i]!);
  out.push(pb.p);
  if (reversed) out.reverse();
  return out;
}

export const COMPASS_VECTORS: Record<string, XY> = {
  n: { x: 0, y: -1 }, north: { x: 0, y: -1 },
  s: { x: 0, y: 1 }, south: { x: 0, y: 1 },
  e: { x: 1, y: 0 }, east: { x: 1, y: 0 },
  w: { x: -1, y: 0 }, west: { x: -1, y: 0 },
  ne: { x: 0.707, y: -0.707 }, northeast: { x: 0.707, y: -0.707 },
  nw: { x: -0.707, y: -0.707 }, northwest: { x: -0.707, y: -0.707 },
  se: { x: 0.707, y: 0.707 }, southeast: { x: 0.707, y: 0.707 },
  sw: { x: -0.707, y: 0.707 }, southwest: { x: -0.707, y: 0.707 },
};

/** Column letters → 1-indexed number: A=1, Z=26, AA=27. */
export function colToNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1-indexed number → column letters: 1=A, 26=Z, 27=AA. */
export function colLetters(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function measureToNumber(measure: string): number {
  const m = /^(\d+(?:\.\d+)?)/.exec(measure);
  return m ? Number(m[1]) : 0;
}

export interface Segment {
  a: XY;
  b: XY;
}

/** Distance along a ray (origin o, unit dir d) to a segment, or null if missed. */
function raySegment(o: XY, d: XY, seg: Segment): number | null {
  const sx = seg.b.x - seg.a.x;
  const sy = seg.b.y - seg.a.y;
  const denom = d.x * sy - d.y * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const ox = seg.a.x - o.x;
  const oy = seg.a.y - o.y;
  const t = (ox * sy - oy * sx) / denom;
  const s = (ox * d.y - oy * d.x) / denom;
  if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9) return t;
  return null;
}

/**
 * Visibility polygon for light (spec 06: openings/barriers carry sight
 * semantics): fixed 180-ray angular sweep — deterministic, no randomness.
 */
export function visibilityPolygon(center: XY, radius: number, blockers: Segment[], steps = 180): XY[] {
  const pts: XY[] = [];
  for (let k = 0; k < steps; k++) {
    const angle = (2 * Math.PI * k) / steps;
    const d = { x: Math.cos(angle), y: Math.sin(angle) };
    let reach = radius;
    for (const seg of blockers) {
      const t = raySegment(center, d, seg);
      if (t !== null && t < reach) reach = t;
    }
    pts.push({ x: center.x + d.x * reach, y: center.y + d.y * reach });
  }
  return pts;
}
