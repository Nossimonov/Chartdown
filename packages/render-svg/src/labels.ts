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
}

export type Anchor = "start" | "middle" | "end";

export class LabelPlacer {
  protected boxes: Box[] = [];

  /** Reserve a non-label obstacle (e.g. a glyph) so labels avoid it. */
  block(x: number, y: number, w: number, h: number): void {
    this.boxes.push({ x, y, w, h });
  }

  protected boxFor(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): Box {
    const w = widthPx ?? textStr.length * fontSize * 0.58;
    const h = fontSize * 1.1;
    const bx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    return { x: bx, y: y - h, w, h };
  }

  protected tryClaim(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): boolean {
    const box = this.boxFor(x, y, textStr, fontSize, anchor, widthPx);
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
    if (this.boxes.some((b) => intersects(b, box))) return false;
    this.boxes.push(box);
    return true;
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

  /** Returns the chosen y (x is never moved — horizontal shifts read as errors on maps). */
  place(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): number {
    const h = fontSize * 1.1;
    const step = h + 2;
    const offsets = [0, step, -step, 2 * step, -2 * step, 3 * step];
    for (const dy of offsets) {
      if (this.tryClaim(x, y + dy, textStr, fontSize, anchor, widthPx)) return y + dy;
    }
    // Everything overlaps: take the last candidate anyway, registered, so
    // later labels at least avoid *this* one.
    const last = offsets[offsets.length - 1]!;
    this.claim(x, y + last, textStr, fontSize, anchor, widthPx);
    return y + last;
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
    const candidates: SidePlacement[] = [
      { x: rightX, y, anchor: "start" },
      { x: leftX, y, anchor: "end" },
      { x: rightX, y: y + step, anchor: "start" },
      { x: leftX, y: y + step, anchor: "end" },
      { x: rightX, y: y - step, anchor: "start" },
      { x: leftX, y: y - step, anchor: "end" },
      { x: rightX, y: y + 2 * step, anchor: "start" },
    ];
    for (const c of candidates) {
      if (this.tryClaim(c.x, c.y, textStr, fontSize, c.anchor)) return c;
    }
    const last = candidates[candidates.length - 1]!;
    this.claim(last.x, last.y, textStr, fontSize, last.anchor);
    return last;
  }
}

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
