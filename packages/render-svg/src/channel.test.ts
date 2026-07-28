/**
 * The legibility floor (#185 part 2, ADR 0035).
 *
 * Tested on synthetic rings rather than through a rendered document, because
 * what has to be right here is a distance: the geometry is asserted at the
 * width it is given, and the drawn symbol is checked separately where the
 * renderer puts it.
 */
import { describe, expect, it } from "vitest";
import { CHANNEL_FLOOR, narrowChannels } from "./channel";
import type { XY } from "./util";

const FRAME = { width: 200, height: 200 };

/** A rectangle as a closed ring, corners clockwise. */
const box = (x0: number, y0: number, x1: number, y1: number): XY[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** Open sea across the whole frame, so anything inside it is in water. */
const SEA = box(0, 0, 200, 200);

/** An island a given gap west of a mainland whose shore runs down x=120. */
const scene = (gap: number): { islands: XY[][]; waters: XY[][] } => ({
  islands: [box(60, 80, 120 - gap, 120)],
  // The mainland has no polygon: it is what the sea is cut out of, so its
  // shore is the sea's own ring, read from the other side.
  waters: [box(0, 0, 120, 200)],
});

const run = (gap: number): ReturnType<typeof narrowChannels> => {
  const { islands, waters } = scene(gap);
  return narrowChannels(islands, waters, FRAME);
};

describe("a channel narrower than the floor is found", () => {
  it("finds the passage, and its spine lies down the middle of it", () => {
    const found = run(0.4);
    expect(found).toHaveLength(1);
    const [channel] = found;
    expect(channel!.narrowest).toBeCloseTo(0.4, 6);
    // Halfway between the island's east side and the shore at x=120 — checked
    // clear of the ends, where the run turns the island's corners and the
    // medial line legitimately falls back toward the island.
    for (const p of channel!.spine) {
      if (p.y > 85 && p.y < 115) expect(p.x).toBeCloseTo(119.8, 6);
      // Nothing may sit further from the shore than half the floor: a midpoint
      // is by construction half of a gap the gate already bounded.
      else expect(p.x).toBeGreaterThan(120 - CHANNEL_FLOOR / 2);
    }
    // And it runs the length of the island's east face, not a fraction of it.
    const ys = channel!.spine.map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(85);
    expect(Math.max(...ys)).toBeGreaterThan(115);
  });

  it("leaves a channel already wider than the floor alone", () => {
    // The floor engages only BELOW itself: a passage that can be seen is drawn
    // to scale and never symbolised. One number is both the gate and the drawn
    // width, so this boundary is the same one the symbol is drawn at.
    expect(run(CHANNEL_FLOOR - 0.1)).toHaveLength(1);
    expect(run(CHANNEL_FLOOR + 0.1)).toHaveLength(0);
  });

  it("says nothing about a WELDED island — that is #180's to report", () => {
    // Where the two outlines overlap there is no channel to draw, and drawing
    // one would be the renderer opening water nobody declared. The midpoint
    // between the two shores lands inside the island, so nothing is found.
    const overlap = narrowChannels([box(60, 80, 130, 120)], [box(0, 0, 120, 200)], FRAME);
    expect(overlap).toEqual([]);
  });

  it("says nothing about an island in open water", () => {
    expect(narrowChannels([box(40, 80, 60, 120)], [SEA], FRAME)).toEqual([]);
  });
});

describe("what the floor must not mistake for a channel", () => {
  it("does not take the picture's edge for a shore (#198's lesson again)", () => {
    // Where a sea runs off the map its polygon follows the frame. An island
    // hard against that edge is not half a mile from a facing coast — the
    // photograph stopped. Symbolising it would paint three quarters of a unit
    // of water over the island's own shore for nothing.
    const hugging = narrowChannels([box(0.4, 80, 40, 120)], [SEA], FRAME);
    expect(hugging).toEqual([]);
  });

  it("finds a channel between two islands as readily as one against a shore", () => {
    const between = narrowChannels(
      [box(40, 80, 60, 120), box(60.5, 80, 80, 120)],
      [SEA],
      FRAME,
    );
    expect(between).toHaveLength(1);
    expect(between[0]!.narrowest).toBeCloseTo(0.5, 6);
    for (const p of between[0]!.spine) {
      if (p.y > 85 && p.y < 115) expect(p.x).toBeCloseTo(60.25, 6);
      else expect(Math.abs(p.x - 60.25)).toBeLessThan(CHANNEL_FLOOR / 2);
    }
  });

  it("does not draw a line through the land at the ends of a passage", () => {
    // Round the island's corners the nearest shore stops being the facing one,
    // and a midpoint chained straight on from the last would cut across land
    // nobody measured. The run breaks instead.
    const [channel] = run(0.4);
    const ys = channel!.spine.map((p) => p.y);
    // The island spans y 80..120; the spine may round its corners but must not
    // run off up or down the open sea beyond them.
    expect(Math.min(...ys)).toBeGreaterThan(75);
    expect(Math.max(...ys)).toBeLessThan(125);
  });

  it("is one channel, not two, when the passage straddles the ring's first vertex", () => {
    // A run broken at the ring's start leaves a gap in the middle of a
    // passage, which reads as a land bridge — the exact thing this prevents.
    // This island's ring starts at its north-WEST corner, so the east-facing
    // channel is interior to the walk; rotating the same ring to start on the
    // channel itself must not split it.
    const rotated = [{ x: 119.6, y: 80 }, { x: 119.6, y: 120 }, { x: 60, y: 120 }, { x: 60, y: 80 }];
    const found = narrowChannels([rotated], [box(0, 0, 120, 200)], FRAME);
    expect(found).toHaveLength(1);
  });
});
