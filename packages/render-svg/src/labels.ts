/**
 * Deterministic label placement (spec 07 §5): renderers SHOULD avoid label
 * collisions and MUST do so deterministically. Greedy: try the preferred spot,
 * then nudge below/above in fixed order; first free box wins. No randomness.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Overlap-cost multiplier: 1 = thin geometry (a brush is tolerable), 3 = text (almost never). */
  weight?: number;
}

/** Cost weight of text boxes: brushing a road is fine, covering a name is not. */
const TEXT_WEIGHT = 3;

export type Anchor = "start" | "middle" | "end";

export class LabelPlacer {
  protected boxes: Box[] = [];
  private readonly bounds: { w: number; h: number } | null;

  /** With bounds, candidates that would leave the viewport are rejected. */
  constructor(bounds?: { w: number; h: number }) {
    this.bounds = bounds ?? null;
  }

  protected inBounds(box: Box): boolean {
    if (!this.bounds) return true;
    return box.x >= 2 && box.y >= 2 && box.x + box.w <= this.bounds.w - 2 && box.y + box.h <= this.bounds.h - 2;
  }

  /** Reserve a non-label obstacle so labels avoid it. Weight 1 = thin geometry; pass 3 for text-like content. */
  block(x: number, y: number, w: number, h: number, weight = 1): void {
    this.boxes.push({ x, y, w, h, weight });
  }

  protected boxFor(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): Box {
    const w = widthPx ?? textStr.length * fontSize * 0.58;
    const h = fontSize * 1.1;
    const bx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    return { x: bx, y: y - h, w, h, weight: TEXT_WEIGHT };
  }

  protected tryClaim(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): boolean {
    const box = this.boxFor(x, y, textStr, fontSize, anchor, widthPx);
    if (!this.inBounds(box)) return false;
    if (this.boxes.some((b) => intersects(b, box))) return false;
    this.boxes.push(box);
    return true;
  }

  protected claim(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): void {
    this.boxes.push(this.boxFor(x, y, textStr, fontSize, anchor, widthPx));
  }

  /**
   * Claim a candidate box if free; returns whether it was claimed. For label
   * forms the placer can't position itself (e.g. textPath along a curve) —
   * the caller proposes, the placer arbitrates and remembers.
   */
  claimIfFree(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): boolean {
    return this.tryClaim(x, y, textStr, fontSize, anchor, widthPx);
  }

  /** Claim an explicit centered box if free (curve labels size their own). */
  claimBoxIfFree(cx: number, top: number, wpx: number, h: number): boolean {
    const box = { x: cx - wpx / 2, y: top, w: wpx, h };
    if (!this.inBounds(box)) return false;
    if (this.boxes.some((b) => intersects(b, box))) return false;
    this.boxes.push(box);
    return true;
  }

  /**
   * Overlap cost of a centered box WITHOUT claiming it — candidate sweeps
   * probe every option first and claim only the winner, so a rejected
   * attempt never leaves phantom boxes behind to push later labels around.
   */
  boxCost(cx: number, top: number, wpx: number, h: number): number {
    return this.overlapArea({ x: cx - wpx / 2, y: top, w: wpx, h });
  }

  /** Unconditionally claim a centered box (the winner of a probed sweep). Curve-label text. */
  claimBox(cx: number, top: number, wpx: number, h: number): void {
    this.boxes.push({ x: cx - wpx / 2, y: top, w: wpx, h, weight: TEXT_WEIGHT });
  }

  /** Occupied area within a rect (bounds-free probe — density checks). */
  occupancy(x: number, y: number, w: number, h: number): number {
    let area = 0;
    for (const b of this.boxes) {
      const ox = Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x));
      const oy = Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
      area += ox * oy;
    }
    return area;
  }

  /**
   * Line-feature labels: candidates are points ALONG the feature (mid-course
   * first, sliding outward); the first free one wins. Sliding along the line
   * keeps the label attached to what it names — a vertical nudge off a road
   * reads as labeling the neighbor. Falls back to vertical nudges at the
   * first candidate only when the whole course is crowded.
   */
  placeAlong(candidates: { x: number; y: number }[], textStr: string, fontSize: number, anchor: Anchor): { x: number; y: number } {
    for (const c of candidates) {
      if (this.tryClaim(c.x, c.y, textStr, fontSize, anchor)) return c;
    }
    const first = candidates[0]!;
    return { x: first.x, y: this.place(first.x, first.y, textStr, fontSize, anchor) };
  }

  protected overlapArea(box: Box): number {
    let area = 0;
    for (const b of this.boxes) {
      const ox = Math.max(0, Math.min(box.x + box.w, b.x + b.w) - Math.max(box.x, b.x));
      const oy = Math.max(0, Math.min(box.y + box.h, b.y + b.h) - Math.max(box.y, b.y));
      area += ox * oy * (b.weight ?? 1);
    }
    if (!this.inBounds(box)) area += 1e6;
    return area;
  }

  /** Returns the chosen y (x is never moved — horizontal shifts read as errors on maps). */
  place(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): number {
    const h = fontSize * 1.1;
    const step = h + 2;
    const offsets = [0, step, -step, 2 * step, -2 * step, 3 * step];
    for (const dy of offsets) {
      if (this.tryClaim(x, y + dy, textStr, fontSize, anchor, widthPx)) return y + dy;
    }
    // Everything overlaps: LEAST-BAD candidate (minimum overlap, in-bounds
    // strongly preferred) — never an arbitrary far slot on top of other text.
    // A farther slot must EARN its distance: moving only helps if it saves
    // real overlap, so each step down the candidate list costs a little.
    let best = 0;
    let bestScore = Infinity;
    offsets.forEach((dy, i) => {
      const score = this.overlapArea(this.boxFor(x, y + dy, textStr, fontSize, anchor, widthPx)) + i * fontSize * 2;
      if (score < bestScore) {
        bestScore = score;
        best = dy;
      }
    });
    this.claim(x, y + best, textStr, fontSize, anchor, widthPx);
    return y + best;
  }

  /**
   * Dense-map conduct (spec 07 §5): shrink before moving far, omit before
   * overwriting. Tries the normal nudge ladder at the base size, then
   * retries the whole ladder at smaller sizes (floor 8px); if even the
   * least-bad shrunk spot would cover most of the label with other text,
   * returns null — the caller drops the label rather than scrawl it.
   */
  placeOrDrop(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, dxs: number[] = [0]): { y: number; x: number; size: number } | null {
    const floor = Math.max(8, fontSize - 3);
    const offsetsAt = (size: number): { dx: number; dy: number }[] => {
      const step = size * 1.1 + 2;
      const out: { dx: number; dy: number }[] = [];
      // Vertical nudges first at the natural x, then the horizontal
      // candidates (an area is WIDE — sidestepping a vertical obstacle
      // beats dropping the name).
      for (const dy of [0, step, -step, 2 * step, -2 * step]) for (const dx of dxs) out.push({ dx, dy });
      return out;
    };
    for (let size = fontSize; size >= floor; size--) {
      for (const o of offsetsAt(size)) {
        if (this.tryClaim(x + o.dx, y + o.dy, textStr, size, anchor)) return { x: x + o.dx, y: y + o.dy, size };
      }
    }
    // No free spot at any size. A BIG label brushing an obstacle beats a
    // shrunken migrated one: accept the largest size whose least-bad slot
    // only brushes (≤12% of its own box); then a floor-size slot up to
    // half-covered; beyond that, omit before overwriting.
    const leastBad = (size: number): { o: { dx: number; dy: number }; score: number; area: number } => {
      let best = { dx: 0, dy: 0 };
      let bestScore = Infinity;
      offsetsAt(size).forEach((o, i) => {
        const score = this.overlapArea(this.boxFor(x + o.dx, y + o.dy, textStr, size, anchor)) + i * size;
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      });
      const box = this.boxFor(x + best.dx, y + best.dy, textStr, size, anchor);
      return { o: best, score: bestScore, area: box.w * box.h };
    };
    for (let size = fontSize; size >= floor; size--) {
      const b = leastBad(size);
      if (b.score <= b.area * 0.12) {
        this.claim(x + b.o.dx, y + b.o.dy, textStr, size, anchor);
        return { x: x + b.o.dx, y: y + b.o.dy, size };
      }
    }
    const b = leastBad(floor);
    if (b.score > b.area * 0.5) return null;
    this.claim(x + b.o.dx, y + b.o.dy, textStr, floor, anchor);
    return { x: x + b.o.dx, y: y + b.o.dy, size: floor };
  }
}

export interface SidePlacement {
  x: number;
  y: number;
  anchor: Anchor;
}

export class SideLabelPlacer extends LabelPlacer {
  /**
   * Point-marker labels: try right of the marker, then left, then vertical
   * nudges on both sides — clusters spread sideways instead of stacking far
   * from their markers. Fixed candidate order keeps it deterministic.
   */
  placeBeside(rightX: number, leftX: number, y: number, textStr: string, fontSize: number): SidePlacement {
    const step = fontSize * 1.1 + 2;
    const midX = (rightX + leftX) / 2;
    const candidates: SidePlacement[] = [
      { x: rightX, y, anchor: "start" },
      { x: leftX, y, anchor: "end" },
      { x: midX, y: y - step, anchor: "middle" },
      { x: midX, y: y + step + 4, anchor: "middle" },
      { x: rightX, y: y + step, anchor: "start" },
      { x: leftX, y: y + step, anchor: "end" },
      { x: rightX, y: y - step, anchor: "start" },
      { x: leftX, y: y - step, anchor: "end" },
    ];
    for (const c of candidates) {
      if (this.tryClaim(c.x, c.y, textStr, fontSize, c.anchor)) return c;
    }
    // Least-bad, never far-and-overlapping: minimum-overlap candidate among
    // the NEAR slots only, and a farther slot must EARN its distance — the
    // owner's principle: a point label away from its point degrades the map,
    // so migrating without a real overlap saving is pure loss.
    let best = candidates[0]!;
    let bestScore = Infinity;
    candidates.forEach((c, i) => {
      const score = this.overlapArea(this.boxFor(c.x, c.y, textStr, fontSize, c.anchor)) + i * fontSize * 2;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    });
    this.claim(best.x, best.y, textStr, fontSize, best.anchor);
    return best;
  }

  /**
   * Dense-map conduct for point labels (spec 07 §5): shrink before moving,
   * omit before overwriting. Sweeps the beside-candidates at the base size,
   * then smaller (floor 8px); when even the least-bad shrunk candidate would
   * mostly cover other text, returns null and the marker goes unnamed —
   * an unlabeled point reads better than two names on top of each other.
   */
  placeBesideOrDrop(rightX: number, leftX: number, y: number, textStr: string, fontSize: number): (SidePlacement & { size: number }) | null {
    const floor = Math.max(8, fontSize - 3);
    const candidatesAt = (size: number): SidePlacement[] => {
      const step = size * 1.1 + 2;
      const midX = (rightX + leftX) / 2;
      return [
        { x: rightX, y, anchor: "start" },
        { x: leftX, y, anchor: "end" },
        { x: midX, y: y - step, anchor: "middle" },
        { x: midX, y: y + step + 4, anchor: "middle" },
        { x: rightX, y: y + step, anchor: "start" },
        { x: leftX, y: y + step, anchor: "end" },
        { x: rightX, y: y - step, anchor: "start" },
        { x: leftX, y: y - step, anchor: "end" },
      ];
    };
    for (let size = fontSize; size >= floor; size--) {
      for (const c of candidatesAt(size)) {
        if (this.tryClaim(c.x, c.y, textStr, size, c.anchor)) return { ...c, size };
      }
    }
    // No free spot at any size. A BIG label brushing an obstacle (a road's
    // last few px at the settlement it serves) beats a shrunken migrated
    // one: largest size whose least-bad candidate only brushes (≤12% of its
    // own box), then floor-size up to half-covered, then omit.
    const leastBad = (size: number): { c: SidePlacement; score: number; area: number } => {
      const finalists = candidatesAt(size);
      let best = finalists[0]!;
      let bestScore = Infinity;
      finalists.forEach((c, i) => {
        const score = this.overlapArea(this.boxFor(c.x, c.y, textStr, size, c.anchor)) + i * size * 2;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      });
      const box = this.boxFor(best.x, best.y, textStr, size, best.anchor);
      return { c: best, score: bestScore, area: box.w * box.h };
    };
    for (let size = fontSize; size >= floor; size--) {
      const b = leastBad(size);
      if (b.score <= b.area * 0.12) {
        this.claim(b.c.x, b.c.y, textStr, size, b.c.anchor);
        return { ...b.c, size };
      }
    }
    const b = leastBad(floor);
    if (b.score > b.area * 0.5) return null;
    this.claim(b.c.x, b.c.y, textStr, floor, b.c.anchor);
    return { ...b.c, size: floor };
  }
}

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
