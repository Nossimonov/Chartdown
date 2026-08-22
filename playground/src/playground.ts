/**
 * The Chartdown playground: fully client-side (ADR 0007's thesis, cashed in).
 * Live render, fail-loud diagnostics, mode/theme toggles, corpus examples,
 * SVG download, and serverless sharing — the document deflate-compressed into
 * the URL fragment, which never leaves the browser.
 */

import { clamp, exportUvttSource, panBy, formatViewBox, isFitted, locationOf, MAX_ZOOM, parseViewBox, renderSource, sameMap, zoomAbout, zoomFactor, type Rect, type RenderMode } from "@chartdown/render-svg";
import brenmark from "../../examples/brenmark/brenmark.cd";
import tankard from "../../examples/gilded-tankard/gilded-tankard.cd";
import manor from "../../examples/fairwater-manor/fairwater-manor.cd";
import candyworld from "../../examples/gumdrop-vale/candyworld.theme.cd";
import inkAndVellum from "../../examples/ink-and-vellum.theme.cd";

/** A theme document that declares nothing — see the note in renderNow. */
const EMPTY_OVERLAY = ["kind: theme", "", "[theme]", ""].join("\n");
import gumdrop from "../../examples/gumdrop-vale/gumdrop-vale.cd";
import redford from "../../examples/redford-crossing/redford-crossing.cd";
import reach from "../../examples/sundered-reach/sundered-reach.cd";
import greyhallow from "../../examples/greyhallow/greyhallow.cd";
import undercellar from "../../examples/undercellar/undercellar.cd";
import vessany from "../../examples/vessany/vessany.cd";

const EXAMPLES: Record<string, string> = {
  "Fairwater Manor (battlemap)": manor,
  "Ambush at Redford Crossing (battlemap)": redford,
  "The Gilded Tankard (keyed labels + legend)": tankard,
  "The Sundered Reach (multi-continent region)": reach,
  "The Brenmark (hexcrawl)": brenmark,
  "Vessany (region)": vessany,
  "Gumdrop Vale (region + custom vocab)": gumdrop,
  "Greyhallow Chapel (secrets, two levels)": greyhallow,
  "The Undercellar (relational placement)": undercellar,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const editor = $<HTMLTextAreaElement>("editor");
const preview = $<HTMLDivElement>("preview");
const diagnosticsEl = $<HTMLPreElement>("diagnostics");
const statusEl = $<HTMLSpanElement>("status");
const exampleSelect = $<HTMLSelectElement>("example");
const themeSelect = $<HTMLSelectElement>("theme");
const levelsEl = $<HTMLSpanElement>("levels");
const zoomInBtn = $<HTMLButtonElement>("zoom-in");
const zoomOutBtn = $<HTMLButtonElement>("zoom-out");
const zoomFitBtn = $<HTMLButtonElement>("zoom-fit");
const zoomLevelEl = $<HTMLSpanElement>("zoom-level");

let mode: RenderMode = "player";
/** Selected level for multi-level maps; "all" = the stacked floor-plan sheet. */
let selectedLevel: string | "all" = "all";
let knownLevels = "";

function syncLevelButtons(levels: string[], defaultLevel: string): void {
  const signature = levels.join(" ");
  if (signature === knownLevels) return;
  knownLevels = signature;
  levelsEl.innerHTML = "";
  if (levels.length === 0) {
    levelsEl.hidden = true;
    selectedLevel = "all";
    return;
  }
  // Default to the document's default level (the ground floor), not the long scroll.
  selectedLevel = defaultLevel;
  for (const value of [...levels, "all"]) {
    const button = document.createElement("button");
    button.dataset["level"] = value;
    button.textContent = value === "all" ? "All floors" : value;
    button.setAttribute("aria-pressed", String(value === selectedLevel));
    button.addEventListener("click", () => {
      selectedLevel = value;
      for (const b of levelsEl.querySelectorAll("button")) {
        b.setAttribute("aria-pressed", String(b === button));
      }
      renderNow();
    });
    levelsEl.append(button);
  }
  levelsEl.hidden = false;
}

function renderNow(): void {
  // Ink and Vellum is the theme that TRAVELS, and it is written to be `use:`d
  // rather than selected: keyed on standard-library words, it necessarily
  // styles some a given map does not have. Passing it as an inherited layer
  // under an empty selected one is exactly what a per-example overlay does
  // (spec 08 §5), and it is what keeps #116's dead-declaration lint honest —
  // selected directly, it correctly reports every line this map cannot use.
  const theme = themeSelect.value === "candyworld" ? candyworld
    : themeSelect.value === "vellum" ? [inkAndVellum, EMPTY_OVERLAY]
    : undefined;
  const first = renderSource(editor.value, theme ? { mode, theme } : { mode });
  syncLevelButtons(first.document.levels, first.document.defaultLevel);
  const useLevel = first.document.levels.length > 0 && selectedLevel !== "all";
  const { svg, diagnostics } = useLevel
    ? renderSource(editor.value, { mode, level: selectedLevel, ...(theme ? { theme } : {}) })
    : first;
  preview.innerHTML = svg;
  // Kept PRISTINE for export (#186). The viewer moves the `viewBox` to zoom,
  // and `download` used to hand over whatever was in the DOM — so a reader who
  // zoomed in to check a channel and then saved would have got the crop rather
  // than the map.
  lastSvg = svg;
  adoptView();
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  diagnosticsEl.textContent = diagnostics.map((d) => `${locationOf(d)}: ${d.severity}: ${d.message}`).join("\n");
  diagnosticsEl.hidden = diagnostics.length === 0;
  statusEl.textContent = errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}` : warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "ok";
  statusEl.dataset["level"] = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";
}

let timer: number | undefined;
function scheduleRender(): void {
  clearTimeout(timer);
  timer = window.setTimeout(renderNow, 250);
}

// ---------- pan and zoom (#186) ----------
//
// The preview fits the map to the pane, which is the right default and was
// also the only thing available: `overflow:auto` never produced a scrollbar
// because a fitted map never overflows. So a reader could see the whole map
// and nothing else, and every feature whose correctness is a matter of scale —
// a fjord's head, a channel between an island and its shore — was unreadable
// at the one scale on offer.
//
// Done by moving the `viewBox` rather than by scaling the element, and that
// distinction is the whole point. Measured for #186: `non-scaling-stroke` holds
// its width in CSS pixels, so page zoom magnifies the geometry and the stroke
// together and their ratio never moves. Narrowing the viewBox grows the
// geometry while leaving stroke widths alone, so detail genuinely emerges —
// which is the operation #185's legibility floor needs in order to converge on
// the truth instead of merely asserting that it would.

/** The map's own viewBox — what "fit" means for the document now loaded. */
let homeView: Rect | null = null;
/** What is on screen. Never wider than `homeView`, never off its edges. */
let view: Rect | null = null;
/** The markup as rendered, before any of this touched it. */
let lastSvg = "";

const svgEl = (): SVGSVGElement | null => preview.querySelector("svg");

function applyView(): void {
  const el = svgEl();
  if (!el || !view || !homeView) return;
  view = clamp(view, homeView);
  el.setAttribute("viewBox", formatViewBox(view));
  // Ink pins to the width it had when fitted (ADR 0040), so coming closer
  // shows geometry rather than a bigger picture. The renderer marks which
  // strokes are conventions; this is the scale the stylesheet multiplies by.
  const shown = el.getBoundingClientRect().width;
  if (shown > 0) preview.style.setProperty("--cd-fit", String(shown / homeView.w));
  const factor = zoomFactor(view, homeView);
  zoomLevelEl.textContent = `${factor < 9.95 ? factor.toFixed(1) : Math.round(factor)}×`;
  const fitted = isFitted(view, homeView);
  preview.classList.toggle("zoomed", !fitted);
  zoomOutBtn.disabled = fitted;
  zoomFitBtn.disabled = fitted;
  zoomInBtn.disabled = factor >= MAX_ZOOM - 0.001;
}

/**
 * Re-attach the current view to a freshly rendered map.
 *
 * The position SURVIVES AN EDIT, which is the behaviour that makes this usable
 * while authoring: the render is debounced on every keystroke, so resetting the
 * view each time would throw a reader back to the whole map on every character
 * typed — exactly while they are adjusting the number they zoomed in to check.
 * A map of a different size is a different map, and refits.
 */
function adoptView(): void {
  const el = svgEl();
  if (!el) {
    homeView = null;
    view = null;
    return;
  }
  const home = parseViewBox(el.getAttribute("viewBox"));
  if (!home) return;
  const carry = sameMap(home, homeView) && view !== null;
  homeView = home;
  if (!carry) view = { ...home };
  applyView();
}

/** Zoom about a point given in client coordinates, so the cursor stays put. */
function zoomAt(clientX: number, clientY: number, factor: number): void {
  const el = svgEl();
  if (!el || !view || !homeView) return;
  const box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return;
  // The arithmetic is shared with the Obsidian plugin (#186) — two
  // implementations of "what does closer mean" would be two answers.
  view = zoomAbout(view, homeView, (clientX - box.left) / box.width, (clientY - box.top) / box.height, factor);
  applyView();
}

/** Zoom about the middle of the pane — what the buttons and keyboard use. */
function zoomCentre(factor: number): void {
  const el = svgEl();
  if (!el) return;
  const box = el.getBoundingClientRect();
  zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
}

function fitView(): void {
  if (!homeView) return;
  view = { ...homeView };
  applyView();
}

function bindViewer(): void {
  preview.addEventListener("wheel", (event) => {
    if (!svgEl()) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });

  let dragging: { id: number; x: number; y: number } | null = null;
  preview.addEventListener("pointerdown", (event) => {
    const el = svgEl();
    if (!el || !view || !homeView || view.w >= homeView.w) return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add("dragging");
  });
  preview.addEventListener("pointermove", (event) => {
    const el = svgEl();
    if (!dragging || dragging.id !== event.pointerId || !el || !view) return;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    if (!homeView) return;
    view = panBy(view, homeView, (event.clientX - dragging.x) / box.width, (event.clientY - dragging.y) / box.height);
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    applyView();
  });
  const endDrag = (event: PointerEvent): void => {
    if (!dragging || dragging.id !== event.pointerId) return;
    dragging = null;
    preview.classList.remove("dragging");
  };
  preview.addEventListener("pointerup", endDrag);
  preview.addEventListener("pointercancel", endDrag);

  // Reachable without a wheel or a mouse: the pane takes focus and answers the
  // usual keys, so zoom is not gated on a pointing device.
  preview.addEventListener("keydown", (event) => {
    if (!view || !homeView) return;
    const step = (dx: number, dy: number): void => {
      view!.x += dx * view!.w * 0.15;
      view!.y += dy * view!.h * 0.15;
      applyView();
    };
    const keys: Record<string, () => void> = {
      "+": () => zoomCentre(1.25), "=": () => zoomCentre(1.25),
      "-": () => zoomCentre(1 / 1.25), "_": () => zoomCentre(1 / 1.25),
      "0": fitView,
      ArrowLeft: () => step(-1, 0), ArrowRight: () => step(1, 0),
      ArrowUp: () => step(0, -1), ArrowDown: () => step(0, 1),
    };
    const act = keys[event.key];
    if (!act) return;
    event.preventDefault();
    act();
  });

  zoomInBtn.addEventListener("click", () => zoomCentre(1.6));
  zoomOutBtn.addEventListener("click", () => zoomCentre(1 / 1.6));
  zoomFitBtn.addEventListener("click", fitView);
}

// ---------- serverless sharing: deflate → base64url → URL fragment ----------

async function compress(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decompress(encoded: string): Promise<string> {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

async function share(): Promise<void> {
  const encoded = await compress(editor.value);
  const params = new URLSearchParams({ m: mode, t: themeSelect.value });
  const url = `${location.origin}${location.pathname}#s=${encoded}&${params}`;
  history.replaceState(null, "", `#s=${encoded}&${params}`);
  try {
    await navigator.clipboard.writeText(url);
    flash("Link copied — the map travels in the URL itself.");
  } catch {
    flash("Link is in the address bar — copy it from there.");
  }
}

function flash(message: string): void {
  const el = $<HTMLSpanElement>("flash");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function saveFile(name: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function download(): void {
  // From the RENDER, not from the DOM: the viewer moves the `viewBox` to zoom,
  // so scraping the element would save a reader's crop instead of their map.
  if (!lastSvg) return;
  saveFile("chartdown-map.svg", lastSvg, "image/svg+xml");
}

// ---------- UVTT export (spec 06 §9): one .dd2vtt per level, raster included ----------

const PIXELS_PER_GRID = 70;

/** Rasterize a region of an SVG to base64 PNG via an offscreen canvas. */
async function rasterize(
  svg: string,
  region: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize the map SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas available");
    ctx.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, outW, outH);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportUvttFiles(): Promise<void> {
  const probe = exportUvttSource(editor.value, { mode, pixelsPerGrid: PIXELS_PER_GRID });
  if (!probe.uvtt) {
    const error = probe.diagnostics.find((d) => d.severity === "error");
    flash(error?.message ?? "UVTT export failed");
    return;
  }
  const levels = probe.document.levels.length > 0 ? probe.document.levels : [""];
  const names: string[] = [];
  for (const level of levels) {
    const result = exportUvttSource(editor.value, {
      mode,
      ...(level ? { level } : {}),
      pixelsPerGrid: PIXELS_PER_GRID,
    });
    if (!result.uvtt) continue;
    if (result.svg && result.imageRegion) {
      const size = (result.uvtt["resolution"] as { map_size: { x: number; y: number } }).map_size;
      result.uvtt["image"] = await rasterize(result.svg, result.imageRegion, size.x * PIXELS_PER_GRID, size.y * PIXELS_PER_GRID);
    }
    const name = `${probe.document.docId}${level ? `-${level}` : ""}.dd2vtt`;
    saveFile(name, JSON.stringify(result.uvtt), "application/json");
    names.push(name);
  }
  flash(`Exported ${names.join(", ")} — Universal VTT, one file per level.`);
}

// ---------- wiring ----------

for (const name of Object.keys(EXAMPLES)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  exampleSelect.append(option);
}

exampleSelect.addEventListener("change", () => {
  editor.value = EXAMPLES[exampleSelect.value] ?? "";
  renderNow();
});
themeSelect.addEventListener("change", renderNow);
editor.addEventListener("input", scheduleRender);
$("share").addEventListener("click", () => void share());
$("download").addEventListener("click", download);
$("uvtt").addEventListener("click", () => void exportUvttFiles());
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  button.addEventListener("click", () => {
    mode = button.dataset["mode"] === "gm" ? "gm" : "player";
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      b.setAttribute("aria-pressed", String(b === button));
    }
    renderNow();
  });
}

async function init(): Promise<void> {
  const hash = new URLSearchParams(location.hash.slice(1));
  const encoded = hash.get("s");
  if (encoded) {
    try {
      editor.value = await decompress(encoded);
      if (hash.get("m") === "gm") {
        mode = "gm";
        document.querySelector<HTMLButtonElement>('[data-mode="gm"]')?.setAttribute("aria-pressed", "true");
        document.querySelector<HTMLButtonElement>('[data-mode="player"]')?.setAttribute("aria-pressed", "false");
      }
      const t = hash.get("t");
      if (t === "candyworld" || t === "vellum") themeSelect.value = t;
    } catch {
      editor.value = manor;
    }
  } else {
    editor.value = manor;
  }
  bindViewer();
  renderNow();
}

void init();
