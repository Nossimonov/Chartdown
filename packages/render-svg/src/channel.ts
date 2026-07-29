/**
 * A channel too narrow to see is drawn as a SYMBOL (#185 part 2, ADR 0035).
 *
 * Part 1 stopped a coastline stroke from painting a passage shut; it does
 * nothing for a passage that is simply smaller than a pixel. Below about a
 * pixel at the map's own size, correct geometry is invisible however it is
 * clipped — the water is genuinely there, correctly shaped, and cannot be seen.
 *
 * Chartdown has already decided this question once, for rivers: a river's
 * drawn width is `2` user units and user units scale with `extent:`, so the
 * same declaration draws the same thickness on a 100mi map and a 3000mi one. A
 * linear water feature's drawn width is a SYMBOL rather than a measurement. A
 * channel cannot borrow that directly, because a channel is negative space
 * between two filled shapes rather than a stroked centreline — so this finds
 * the negative space and strokes it.
 *
 * The symbol's width is in VIEWPORT units (`vector-effect="non-scaling-stroke"`),
 * which is what makes it converge: narrowing the `viewBox` magnifies the
 * geometry and leaves the symbol where it is, so the true channel grows past
 * the symbol and swallows it. What a reader sees is a passage at map zoom and
 * the surveyed water at depth, with no moment where the land moved.
 *
 * The land does not move. Nothing here edits a polygon; the symbol is ink laid
 * over the drawing, and at the zoom where it stops being needed it stops being
 * visible, because it is the colour of the water it lies in.
 */

import { pip, QUANTUM, type XY } from "./util";

/**
 * The narrowest a channel may be drawn, in viewport units — and the width at
 * which one narrower than this is drawn.
 *
 * ONE NUMBER DOES BOTH JOBS, which is what keeps the two halves honest. At the
 * map's intrinsic size a user unit IS a viewport unit (the SVG carries
 * `viewBox="0 0 w h"` with `width="w"`), so "narrower than the floor in user
 * units" and "narrower than the floor on the reader's screen" are the same
 * sentence, and a channel already wider than the floor is never symbolised —
 * the symbol would be drawn strictly inside water it already matches.
 *
 * 2 by measurement rather than by argument. 1.5 was the first guess — the
 * smallest width at which a line ought to read as a gap — and rasterised
 * against paper at a pane's own scale it is a hint rather than a passage; at 2
 * the island reads as separate. It is still narrower than the 1.2 + 1.2 of the
 * two coastline strokes it lies between, so the symbol never dominates the
 * shores it separates.
 */
export const CHANNEL_FLOOR = 2;

export interface Channel {
  /** The medial line of the gap, in rendered units. */
  spine: XY[];
  /** The narrowest the gap gets along this run, in rendered units. */
  narrowest: number;
  /** Index of the water body it runs through — the symbol takes that fill. */
  water: number;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

const boxOf = (ring: XY[]): Box => ({
  x0: Math.min(...ring.map((p) => p.x)), y0: Math.min(...ring.map((p) => p.y)),
  x1: Math.max(...ring.map((p) => p.x)), y1: Math.max(...ring.map((p) => p.y)),
});

const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });

const overlaps = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Points every `step` along a closed ring, in order. */
function sampleRing(ring: XY[], step: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const parts = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < parts; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / parts, y: a.y + ((b.y - a.y) * s) / parts });
    }
  }
  return out;
}

/** Drop points a straight line already accounts for — a symbol needs no detail. */
function thin(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const out: XY[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i + 1]!;
    const p = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    if (Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len > tol) out.push(p);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Every channel between two distinct land regions narrower than `floor`.
 *
 * A land region here is an island's outline or the shore of a declared water
 * body — the mainland has no polygon of its own, it is what the sea is cut out
 * of, so its shore is a water body's own ring read from the other side. Both
 * of the passages this exists for are that pairing: Rich Passage is Bainbridge
 * against the Kitsap shore, Pickering Passage is Harstine against it.
 *
 * A NECK WITHIN ONE SHORE'S OWN RING IS NOT COVERED — a strait between two
 * peninsulas of the same landmass, or a declared water body thinner than the
 * floor along its whole length. Both are one ring approaching itself, which
 * needs a medial axis rather than a nearest-neighbour, and neither is what
 * #185 was raised about. They are named in ADR 0035 rather than left to be
 * discovered.
 */
export function narrowChannels(
  islands: XY[][],
  waters: XY[][],
  frame: { width: number; height: number },
  floor: number = CHANNEL_FLOOR,
): Channel[] {
  if (!islands.length || (!waters.length && islands.length < 2)) return [];

  /**
   * Which water body this point is in, or -1 for land.
   *
   * The islands are tested FIRST and are disqualifying: an island is land
   * inside the water it sits in, so a midpoint that lands on one is not a
   * channel. This is also the guard that keeps a WELDED island a warning
   * rather than a symbol (#180, ADR 0027) — where two outlines overlap the
   * midpoint between them is inside one of them, and no channel is found,
   * because there is no channel. A gap that exists is drawn; a gap that does
   * not exist is still reported.
   */
  const waterAt = (p: XY): number => {
    for (const isle of islands) if (pip(p, isle)) return -1;
    for (let k = 0; k < waters.length; k++) if (pip(p, waters[k]!)) return k;
    return -1;
  };

  /**
   * A segment lying along the picture's edge is not a shore (#198's lesson,
   * met again). Where a sea runs off the map its polygon follows the frame,
   * and an island near that edge would otherwise be given a channel against
   * the border and lose three quarters of a unit of its own coast to it.
   */
  const EDGE = 0.05;
  const onFrame = (a: XY, b: XY): boolean =>
    (Math.abs(a.x) < EDGE && Math.abs(b.x) < EDGE) ||
    (Math.abs(a.y) < EDGE && Math.abs(b.y) < EDGE) ||
    (Math.abs(a.x - frame.width) < EDGE && Math.abs(b.x - frame.width) < EDGE) ||
    (Math.abs(a.y - frame.height) < EDGE && Math.abs(b.y - frame.height) < EDGE);

  const out: Channel[] = [];
  const pairs: [XY[], XY[]][] = [];
  for (let i = 0; i < islands.length; i++) {
    for (const water of waters) pairs.push([islands[i]!, water]);
    // Islands pair once, not twice: sampling the smaller ring is enough, since
    // the channel is bounded by it on one side however big the other is.
    for (let j = i + 1; j < islands.length; j++) {
      const [a, b] = [islands[i]!, islands[j]!];
      pairs.push(a.length <= b.length ? [a, b] : [b, a]);
    }
  }

  for (const [ring, other] of pairs) {
    const near = grow(boxOf(ring), floor);
    // Only the part of the other shore that could possibly be within the floor
    // — on real imagery that is a few dozen segments out of a few thousand.
    const segs: [XY, XY][] = [];
    for (let i = 0; i < other.length; i++) {
      const a = other[i]!;
      const b = other[(i + 1) % other.length]!;
      if (onFrame(a, b)) continue;
      if (!overlaps(near, boxOf([a, b]))) continue;
      segs.push([a, b]);
    }
    if (!segs.length) continue;

    let perim = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      perim += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const step = Math.max(floor / 2, perim / 6000);
    const samples = sampleRing(ring, step);

    const hits = samples.map((p): { mid: XY; d: number; water: number } | null => {
      let bestD = Infinity;
      let best: XY | null = null;
      for (const [a, b] of segs) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) { bestD = d; best = q; }
      }
      // A gap of nothing is a CONTACT, and contact is #180's to report.
      if (!best || bestD >= floor || bestD <= QUANTUM) return null;
      const mid = { x: (p.x + best.x) / 2, y: (p.y + best.y) / 2 };
      const water = waterAt(mid);
      return water < 0 ? null : { mid, d: bestD, water };
    });

    // A run that straddles the ring's first vertex is ONE channel, and drawing
    // it as two leaves a gap in the middle of a passage — which reads as a
    // land bridge, the exact thing this is here to prevent. Start the walk at
    // a miss so no run can wrap.
    const start = hits.findIndex((h) => h === null);
    if (start < 0) continue; // wholly within the floor of the other: #180's case, not this one
    let run: { mid: XY; d: number; water: number }[] = [];
    const flush = (): void => {
      if (run.length >= 3) {
        out.push({
          spine: thin(run.map((r) => r.mid), floor / 6),
          narrowest: Math.min(...run.map((r) => r.d)),
          water: run[0]!.water,
        });
      }
      run = [];
    };
    for (let k = 1; k <= hits.length; k++) {
      const hit = hits[(start + k) % hits.length];
      // A jump means the nearest shore changed to a different one; the line
      // between the two midpoints would cut across land nobody measured.
      const jumped = hit && run.length
        && Math.hypot(hit.mid.x - run[run.length - 1]!.mid.x, hit.mid.y - run[run.length - 1]!.mid.y) > step * 4;
      if (!hit || jumped) {
        flush();
        if (hit) run.push(hit);
        continue;
      }
      run.push(hit);
    }
    flush();
  }
  return out;
}
