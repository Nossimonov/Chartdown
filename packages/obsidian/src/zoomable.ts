/**
 * A map you can get closer to, in a note (#186).
 *
 * The plugin stripped the SVG's `width`/`height` and let it fill the column,
 * so a map was drawn once at whatever width the note happened to be and there
 * was no way to look closer. Every feature whose correctness is a matter of
 * scale — a fjord's head, a channel between an island and its shore — was
 * unreadable at the one scale on offer. Inline SVG does not get Obsidian's
 * image zoom, so nothing else was going to provide this.
 *
 * Zooming moves the **`viewBox`**; it does not scale the element. Measured for
 * #186: `non-scaling-stroke` holds its width in CSS pixels, so scaling the
 * element magnifies geometry and stroke together and their ratio never moves.
 * Narrowing the viewBox grows the geometry and leaves the strokes, so detail
 * genuinely emerges. The arithmetic is shared with the playground
 * (`@chartdown/render-svg`'s `viewbox`), because two implementations of it
 * would be two answers to the same question.
 */

import { clamp, formatViewBox, isFitted, panBy, parseViewBox, sameMap, zoomAbout, zoomFactor, type Rect } from "@chartdown/render-svg";

export interface Viewer {
  /** Re-read the map after a re-render, keeping the reader's position. */
  adopt(): void;
  /** Zoom about the middle — what a button or a keystroke asks for. */
  zoom(factor: number): void;
  /** Back to the whole map. */
  fit(): void;
  /** How much closer than fitted, for a caller that wants to show it. */
  factor(): number;
}

/**
 * Make the SVG inside `host` zoomable and pannable.
 *
 * `onChange` reports the zoom factor so a toolbar can label a button or
 * disable one; it fires on every view change, including the ones the reader
 * causes by dragging.
 */
export function makeZoomable(host: HTMLElement, onChange?: (factor: number) => void): Viewer {
  let home: Rect | null = null;
  let view: Rect | null = null;

  const svg = (): SVGSVGElement | null => host.querySelector("svg");

  const apply = (): void => {
    const el = svg();
    if (!el || !view || !home) return;
    view = clamp(view, home);
    el.setAttribute("viewBox", formatViewBox(view));
    host.toggleClass?.("chartdown-zoomed", !isFitted(view, home));
    if (!host.toggleClass) host.classList.toggle("chartdown-zoomed", !isFitted(view, home));
    onChange?.(zoomFactor(view, home));
  };

  const adopt = (): void => {
    const el = svg();
    if (!el) { home = null; view = null; return; }
    const next = parseViewBox(el.getAttribute("viewBox"));
    if (!next) return;
    // THE POSITION SURVIVES A RE-RENDER. A note re-renders on mode toggles and
    // on every edit to a `.cd` file, and resetting the view each time would
    // throw a reader back to the whole map exactly while they were adjusting
    // the number they had zoomed in to check. A map of a different size is a
    // different map, and refits.
    const carry = sameMap(next, home) && view !== null;
    home = next;
    if (!carry) view = { ...next };
    apply();
  };

  const zoomAtClient = (clientX: number, clientY: number, factor: number): void => {
    const el = svg();
    if (!el || !view || !home) return;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    view = zoomAbout(view, home, (clientX - box.left) / box.width, (clientY - box.top) / box.height, factor);
    apply();
  };

  // A bare wheel scrolls the note; a map that swallowed that would trap the
  // reader's scroll on the way past it. Ctrl/⌘ is the zoom gesture a pinch
  // also produces on a trackpad.
  host.addEventListener("wheel", (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (!svg()) return;
    event.preventDefault();
    zoomAtClient(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });

  let drag: { id: number; x: number; y: number } | null = null;
  host.addEventListener("pointerdown", (event: PointerEvent) => {
    const el = svg();
    if (!el || !view || !home || isFitted(view, home)) return; // fitted: nothing to pan
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    host.setPointerCapture?.(event.pointerId);
  });
  host.addEventListener("pointermove", (event: PointerEvent) => {
    const el = svg();
    if (!drag || drag.id !== event.pointerId || !el || !view || !home) return;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    view = panBy(view, home, (event.clientX - drag.x) / box.width, (event.clientY - drag.y) / box.height);
    drag = { ...drag, x: event.clientX, y: event.clientY };
    apply();
  });
  const endDrag = (event: PointerEvent): void => {
    if (drag && drag.id === event.pointerId) {
      host.releasePointerCapture?.(event.pointerId);
      drag = null;
    }
  };
  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);

  adopt();

  return {
    adopt,
    zoom: (factor) => {
      const el = svg();
      if (!el) return;
      const box = el.getBoundingClientRect();
      zoomAtClient(box.left + box.width / 2, box.top + box.height / 2, factor);
    },
    fit: () => {
      if (!home) return;
      view = { ...home };
      apply();
    },
    factor: () => (view && home ? zoomFactor(view, home) : 1),
  };
}
