/**
 * Viewing a rendered map: the viewBox arithmetic, with no DOM in it (#186).
 *
 * **Zooming means moving the `viewBox`, not scaling the element**, and the
 * difference is the whole reason this exists. Measured for #186:
 * `vector-effect="non-scaling-stroke"` holds its width in CSS pixels, so
 * scaling the element — or the reader's page zoom — magnifies geometry and
 * stroke together and their ratio never moves. Narrowing the viewBox grows the
 * geometry and leaves stroke widths alone, so detail genuinely emerges. That is
 * the operation #185's legibility floor needs in order to converge on the truth
 * rather than merely assert that it would.
 *
 * The playground and the Obsidian plugin both need this and reach it
 * differently — a pane with buttons, a note with a scroll wheel — so the
 * arithmetic lives here and the event wiring lives with each surface.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Closest a reader may get, as a multiple of the fitted width. */
export const MAX_ZOOM = 64;

/** A `viewBox` attribute as a rect, or null if it is missing or degenerate. */
export function parseViewBox(attr: string | null): Rect | null {
  const parts = (attr ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

export const formatViewBox = (r: Rect): string => `${r.x} ${r.y} ${r.w} ${r.h}`;

/**
 * Hold a view inside the map it belongs to, so panning cannot wander off into
 * nothing and zooming out cannot show less map than there is.
 */
export function clamp(view: Rect, home: Rect): Rect {
  const w = Math.min(view.w, home.w);
  const h = Math.min(view.h, home.h);
  return {
    w,
    h,
    x: Math.min(Math.max(view.x, home.x), home.x + home.w - w),
    y: Math.min(Math.max(view.y, home.y), home.y + home.h - h),
  };
}

/**
 * Zoom about a point given as fractions of the viewport, so whatever is under
 * the cursor stays under it.
 *
 * `factor` above 1 moves closer. The height follows the width by the same
 * scale, which keeps the aspect ratio the document was drawn at — a view that
 * stretched would make a measured map lie about its own proportions.
 */
export function zoomAbout(view: Rect, home: Rect, fx: number, fy: number, factor: number, maxZoom = MAX_ZOOM): Rect {
  const cx = Math.min(Math.max(fx, 0), 1);
  const cy = Math.min(Math.max(fy, 0), 1);
  const atX = view.x + cx * view.w;
  const atY = view.y + cy * view.h;
  const w = Math.min(Math.max(view.w / factor, home.w / maxZoom), home.w);
  const scale = w / view.w;
  const h = view.h * scale;
  return clamp({ x: atX - cx * w, y: atY - cy * h, w, h }, home);
}

/** Pan by a drag measured as fractions of the viewport. */
export function panBy(view: Rect, home: Rect, dxFraction: number, dyFraction: number): Rect {
  return clamp({ ...view, x: view.x - dxFraction * view.w, y: view.y - dyFraction * view.h }, home);
}

/** How much closer than fitted this view is. 1 = the whole map. */
export const zoomFactor = (view: Rect, home: Rect): number => home.w / view.w;

/** Whether the view is the whole map, within rounding. */
export const isFitted = (view: Rect, home: Rect): boolean => zoomFactor(view, home) <= 1.001;

/** Whether two rects describe the same map — a different one refits. */
export const sameMap = (a: Rect | null, b: Rect | null): boolean =>
  a !== null && b !== null
  && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6
  && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
