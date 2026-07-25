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

/**
 * How far a label may shrink (spec 07 §5 step 2). TWO floors, deliberately
 * separate — `Math.max(8, fontSize - 3)` conflated them (#132).
 *
 * - **Legibility** is about the reader and scales with the map, because an SVG
 *   is resolution-independent: how large "8 units" appears is the viewer's
 *   choice, not the document's. A fixed pixel count optimizes for fit-to-width
 *   and pays for it by discarding information a zoomable medium could keep.
 * - **Hierarchy** is about the map and is inherently relative: a capital that
 *   shrank to a hamlet's size would erase the tier system that makes the map
 *   readable at any zoom. This one must NOT scale with the canvas.
 *
 * Conflated, the `- 3` silently governed the important labels: a capital's
 * floor was 10 and no amount of lowering the `8` could move it, while a
 * `hamlet` at base 8 had **zero** shrink headroom and went straight to
 * omission under any crowding.
 *
 * **On "scale-aware", honestly:** the legibility floor is written as a
 * fraction of the canvas, but a region canvas is a hard-coded 820 units wide
 * (`index.ts`), and these floors are reached only from region rendering — so
 * today the fraction evaluates to one constant and the scale-awareness is
 * latent, not active. It is kept in this form because it is the correct shape
 * the day the canvas stops being fixed, and because writing it as a bare
 * constant would hide that the value is a fraction of something. The claim
 * that a fixed floor is a fixed-raster assumption stands; the lever for acting
 * on it is the canvas, and the canvas does not move yet.
 */
const LEGIBILITY_FRACTION = 1 / 130;
const LEGIBILITY_MIN = 4;
const HIERARCHY_RATIO = 0.7;
/** Canvas width assumed when the placer was built without bounds. */
const NOMINAL_WIDTH = 820;

/**
 * Smallest size a label of this base size may shrink to on this canvas.
 * Exported for testing: the constants above only mean something in relation
 * to each other, and this is where that relationship is decided.
 */
export const shrinkFloor = (fontSize: number, canvasWidth = NOMINAL_WIDTH): number => {
  const legibility = Math.max(LEGIBILITY_MIN, canvasWidth * LEGIBILITY_FRACTION);
  // Rounded: the fallback claims AT the floor, so a fractional one would put
  // `font-size="9.1"` in the output for no reader-visible gain.
  return Math.min(fontSize, Math.round(Math.max(legibility, fontSize * HIERARCHY_RATIO)));
};

export type Anchor = "start" | "middle" | "end";

/**
 * How far a label may travel from its marker when a leader line carries the
 * association (spec 07 §5, #133).
 *
 * The bound needs its own statement because rule 1's "migrate least" was doing
 * two jobs at once: keeping a name legible AS that marker's name, and keeping
 * it from wandering. A leader takes over the first job entirely — the line
 * says which marker it belongs to — so without an explicit limit the second
 * job goes unenforced and a crowded map becomes a scatter of names on strings.
 *
 * A flat bound, deliberately. Scaling it by the marker's radius reads better —
 * the more important the place, the further the eye will follow a line — but
 * every settlement tier has a radius between 2.5 and 6, so any sane multiple
 * lands inside the same tens of pixels and the proportionality never decides
 * anything. Measured: 45 and 60 produce identical maps. Rather than dress a
 * constant up as a rule that does no work, it is a constant.
 *
 * 45 is where the recovery plateaus: below it leaders cannot reach open space
 * (at 30 only one label is rescued), above it nothing further is gained, which
 * is the signal that the bound is limiting wandering rather than placement.
 */
const LEADER_REACH = 45;
/** Below this a leader is pointless — the label is close enough to read as adjacent. */
const LEADER_MIN = 14;

export interface LeaderPlacement {
  x: number;
  y: number;
  anchor: Anchor;
  size: number;
  /** Where the leader meets the label; the caller draws to the marker. */
  from: { x: number; y: number };
}

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

  /** A removable obstacle: reserve now, release later (name homes — a spot held for a label that hasn't placed yet). */
  tempBlock(x: number, y: number, w: number, h: number, weight = 1): object {
    const box: Box = { x, y, w, h, weight };
    this.boxes.push(box);
    return box;
  }

  release(handle: object): void {
    const i = this.boxes.indexOf(handle as Box);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  /**
   * The smallest size this label may shrink to: the larger of what the reader
   * can still make out and what its rank requires (see the constants above).
   * Never above the base size, so a small label is not floored out of shrinking
   * altogether on a large canvas.
   */
  protected floorFor(fontSize: number): number {
    return shrinkFloor(fontSize, this.bounds?.w ?? NOMINAL_WIDTH);
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
  placeOrDrop(x: number, y: number, textStr: string, fontSize: number, anchor: Anchor, dxs: number[] = [0], widthPx?: number, allow?: (x: number, y: number) => boolean): { y: number; x: number; size: number } | null {
    const floor = this.floorFor(fontSize);
    const offsetsAt = (size: number): { dx: number; dy: number }[] => {
      const step = size * 1.1 + 2;
      const out: { dx: number; dy: number }[] = [];
      // Vertical nudges first at the natural x, then the horizontal
      // candidates (an area is WIDE — sidestepping a vertical obstacle
      // beats dropping the name). `allow` vetoes candidate centers — a
      // realm's name must stay on that realm's own land.
      for (const dy of [0, step, -step, 2 * step, -2 * step]) for (const dx of dxs) out.push({ dx, dy });
      return out.filter((o) => !allow || allow(x + o.dx, y + o.dy));
    };
    for (let size = fontSize; size >= floor; size--) {
      for (const o of offsetsAt(size)) {
        if (this.tryClaim(x + o.dx, y + o.dy, textStr, size, anchor, widthPx)) return { x: x + o.dx, y: y + o.dy, size };
      }
    }
    // No free spot at any size. A BIG label brushing an obstacle beats a
    // shrunken migrated one: accept the largest size whose least-bad slot
    // only brushes (≤12% of its own box); then a floor-size slot up to
    // half-covered; beyond that, omit before overwriting.
    // `i * size` ranks candidates (nearer offsets preferred) but is not ink on
    // the label, so the omit tests below weigh OVERLAP only — see the sibling
    // note in placeBesideOrDrop (#132).
    const leastBad = (size: number): { o: { dx: number; dy: number }; overlap: number; area: number } => {
      let best = { dx: 0, dy: 0 };
      let bestScore = Infinity;
      offsetsAt(size).forEach((o, i) => {
        const score = this.overlapArea(this.boxFor(x + o.dx, y + o.dy, textStr, size, anchor, widthPx)) + i * size;
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      });
      const box = this.boxFor(x + best.dx, y + best.dy, textStr, size, anchor, widthPx);
      return { o: best, overlap: this.overlapArea(box), area: box.w * box.h };
    };
    for (let size = fontSize; size >= floor; size--) {
      const b = leastBad(size);
      if (b.overlap <= b.area * 0.12) {
        this.claim(x + b.o.dx, y + b.o.dy, textStr, size, anchor, widthPx);
        return { x: x + b.o.dx, y: y + b.o.dy, size };
      }
    }
    const b = leastBad(floor);
    if (b.overlap > b.area * 0.5) return null;
    this.claim(x + b.o.dx, y + b.o.dy, textStr, floor, anchor, widthPx);
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
   * Last rung before omission (spec 07 §5, #133): put the name in open space
   * near the marker and let a leader line carry the association.
   *
   * Only reached when every adjacent slot has failed at every size, so this
   * competes with dropping the name, not with placing it well. Candidates ring
   * the marker at growing radius, ordered so the nearest and the most
   * conventional directions win — placement stays a pure function of geometry
   * and declaration order (spec 02 §8.2).
   */
  placeWithLeader(cx: number, cy: number, textStr: string, fontSize: number): LeaderPlacement | null {
    const reach = LEADER_REACH;
    // Cardinals and diagonals, NE first: a name set above-right of its marker
    // is the cartographic default, and ties resolve the same way every render.
    const dirs: { dx: number; dy: number; anchor: Anchor }[] = [
      { dx: 1, dy: -1, anchor: "start" }, { dx: -1, dy: -1, anchor: "end" },
      { dx: 1, dy: 1, anchor: "start" }, { dx: -1, dy: 1, anchor: "end" },
      { dx: 1, dy: 0, anchor: "start" }, { dx: -1, dy: 0, anchor: "end" },
      { dx: 0, dy: -1, anchor: "middle" }, { dx: 0, dy: 1, anchor: "middle" },
    ];
    for (let r = LEADER_MIN; r <= reach; r += 6) {
      for (const size of [fontSize, this.floorFor(fontSize)]) {
        for (const d of dirs) {
          const norm = Math.hypot(d.dx, d.dy) || 1;
          const x = cx + (d.dx / norm) * r;
          const y = cy + (d.dy / norm) * r;
          if (!this.tryClaim(x, y, textStr, size, d.anchor)) continue;
          // The leader meets the label at the edge facing the marker, so the
          // line touches the text rather than striking through it.
          const box = this.boxFor(x, y, textStr, size, d.anchor);
          const fromX = d.dx > 0 ? box.x : d.dx < 0 ? box.x + box.w : box.x + box.w / 2;
          return { x, y, anchor: d.anchor, size, from: { x: fromX, y: box.y + box.h / 2 } };
        }
      }
    }
    return null;
  }

  /**
   * Dense-map conduct for point labels (spec 07 §5): shrink before moving,
   * omit before overwriting. Sweeps the beside-candidates at the base size,
   * then smaller (floor 8px); when even the least-bad shrunk candidate would
   * mostly cover other text, returns null and the marker goes unnamed —
   * an unlabeled point reads better than two names on top of each other.
   */
  placeBesideOrDrop(rightX: number, leftX: number, y: number, textStr: string, fontSize: number): (SidePlacement & { size: number }) | null {
    const floor = this.floorFor(fontSize);
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
    // `i * size * 2` is a PREFERENCE — it keeps a name on its marker's
    // favoured side when two candidates overlap equally. It is not ink on the
    // label, so it ranks candidates but must not be weighed against the omit
    // thresholds below: at candidate index 7 it alone ate ~40% of the budget,
    // and a label was dropped for sitting in an unfavoured slot rather than
    // for covering anything (#132).
    const leastBad = (size: number): { c: SidePlacement; overlap: number; area: number } => {
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
      return { c: best, overlap: this.overlapArea(box), area: box.w * box.h };
    };
    for (let size = fontSize; size >= floor; size--) {
      const b = leastBad(size);
      if (b.overlap <= b.area * 0.12) {
        this.claim(b.c.x, b.c.y, textStr, size, b.c.anchor);
        return { ...b.c, size };
      }
    }
    const b = leastBad(floor);
    if (b.overlap > b.area * 0.5) return null;
    this.claim(b.c.x, b.c.y, textStr, floor, b.c.anchor);
    return { ...b.c, size: floor };
  }
}

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
