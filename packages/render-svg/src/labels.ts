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
  private boxes: Box[] = [];

  /** Reserve a non-label obstacle (e.g. a glyph) so labels avoid it. */
  block(x: number, y: number, w: number, h: number): void {
    this.boxes.push({ x, y, w, h });
  }

  /** Returns the chosen y (x is never moved — horizontal shifts read as errors on maps). */
  place(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, widthPx?: number): number {
    const w = widthPx ?? textStr.length * fontSize * 0.58;
    const h = fontSize * 1.1;
    const bx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    const step = h + 2;
    const offsets = [0, step, -step, 2 * step, -2 * step, 3 * step];
    for (const dy of offsets) {
      const box: Box = { x: bx, y: y + dy - h, w, h };
      if (!this.boxes.some((b) => intersects(b, box))) {
        this.boxes.push(box);
        return y + dy;
      }
    }
    // Everything overlaps: take the last candidate anyway, registered, so
    // later labels at least avoid *this* one.
    const fallback: Box = { x: bx, y: y + offsets[offsets.length - 1]! - h, w, h };
    this.boxes.push(fallback);
    return y + offsets[offsets.length - 1]!;
  }
}

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
