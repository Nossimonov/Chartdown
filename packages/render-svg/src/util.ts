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
 * The connecting curve through declared controls — CENTRIPETAL (#189).
 *
 * Re-exported from core rather than defined here (#192): the shape a `via`
 * list means is not a rendering choice, and a measuring tool that has to know
 * whether its own output can be drawn must spline it exactly as the renderer
 * will. Two copies of this is how the measurement comes to check a line the
 * renderer never draws.
 */
import { catmullRom } from "@chartdown/core";
export { catmullRom };

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

/**
 * Is this point inside this polygon? The standard crossing count.
 *
 * Here rather than beside its first caller because duplicating a predicate is
 * how two callers come to disagree about what "inside" means — the region
 * renderer's water checks and the channel floor (#185) must answer it the same
 * way, or a symbol is drawn through land one of them thinks is sea.
 */
export function pip(pt: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
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

/**
 * A darker sibling of a colour, for the edge of the thing that colour fills —
 * a coastline against its sea, a bridge's rail against its deck.
 *
 * Shared rather than copied: it was private to the region renderer until the
 * battlemap needed it for a themed crossing (#208), and two implementations of
 * "one shade darker" is exactly the drift this package keeps warning about.
 * A non-hex value (a CSS name, a gradient url) passes through untouched.
 */
export function shade(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const dim = (v: number): number => Math.max(0, Math.round(v * 0.8));
  return `#${(((dim((n >> 16) & 255)) << 16) | ((dim((n >> 8) & 255)) << 8) | dim(n & 255)).toString(16).padStart(6, "0")}`;
}
