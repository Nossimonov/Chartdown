/** SVG building, deterministic PRNG, and geometry helpers. */

export interface XY {
  x: number;
  y: number;
}

/** Fixed-precision formatting keeps output byte-identical across runs. */
export const fmt = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
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

export const text = (content: string, attrs: Attrs): string =>
  `<text${Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? fmt(v) : esc(String(v))}"`)
    .join("")}>${esc(content)}</text>`;

export const pointsAttr = (pts: XY[]): string => pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");

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
 */
export function catmullRom(pts: XY[], samples = 8, closed = false): XY[] {
  if (pts.length < 3) return pts.slice();
  const P = (i: number): XY =>
    closed ? pts[((i % pts.length) + pts.length) % pts.length]! : pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  const out: XY[] = [];
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
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

/** Organic blob: radial jitter around a center. */
export function blob(center: XY, radius: number, random: () => number, segments = 14): XY[] {
  const pts: XY[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radius * (0.78 + random() * 0.4);
    pts.push({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r });
  }
  return pts;
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
