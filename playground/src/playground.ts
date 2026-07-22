/**
 * The Chartdown playground: fully client-side (ADR 0007's thesis, cashed in).
 * Live render, fail-loud diagnostics, mode/theme toggles, corpus examples,
 * SVG download, and serverless sharing — the document deflate-compressed into
 * the URL fragment, which never leaves the browser.
 */

import { exportUvttSource, renderSource, type RenderMode } from "@chartdown/render-svg";
import brenmark from "../../examples/brenmark/brenmark.cd";
import tankard from "../../examples/gilded-tankard/gilded-tankard.cd";
import manor from "../../examples/fairwater-manor/fairwater-manor.cd";
import candyworld from "../../examples/gumdrop-vale/candyworld.theme.cd";
import gumdrop from "../../examples/gumdrop-vale/gumdrop-vale.cd";
import redford from "../../examples/redford-crossing/redford-crossing.cd";
import reach from "../../examples/sundered-reach/sundered-reach.cd";
import vessany from "../../examples/vessany/vessany.cd";

const EXAMPLES: Record<string, string> = {
  "Fairwater Manor (battlemap)": manor,
  "Ambush at Redford Crossing (battlemap)": redford,
  "The Gilded Tankard (keyed labels + legend)": tankard,
  "The Sundered Reach (multi-continent region)": reach,
  "The Brenmark (hexcrawl)": brenmark,
  "Vessany (region)": vessany,
  "Gumdrop Vale (region + custom vocab)": gumdrop,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const editor = $<HTMLTextAreaElement>("editor");
const preview = $<HTMLDivElement>("preview");
const diagnosticsEl = $<HTMLPreElement>("diagnostics");
const statusEl = $<HTMLSpanElement>("status");
const exampleSelect = $<HTMLSelectElement>("example");
const themeSelect = $<HTMLSelectElement>("theme");
const levelsEl = $<HTMLSpanElement>("levels");

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
  const theme = themeSelect.value === "candyworld" ? candyworld : undefined;
  const first = renderSource(editor.value, theme ? { mode, theme } : { mode });
  syncLevelButtons(first.document.levels, first.document.defaultLevel);
  const useLevel = first.document.levels.length > 0 && selectedLevel !== "all";
  const { svg, diagnostics } = useLevel
    ? renderSource(editor.value, { mode, level: selectedLevel, ...(theme ? { theme } : {}) })
    : first;
  preview.innerHTML = svg;
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  diagnosticsEl.textContent = diagnostics.map((d) => `line ${d.line}: ${d.severity}: ${d.message}`).join("\n");
  diagnosticsEl.hidden = diagnostics.length === 0;
  statusEl.textContent = errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}` : warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "ok";
  statusEl.dataset["level"] = errors > 0 ? "error" : warnings > 0 ? "warning" : "ok";
}

let timer: number | undefined;
function scheduleRender(): void {
  clearTimeout(timer);
  timer = window.setTimeout(renderNow, 250);
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
  const svg = preview.querySelector("svg");
  if (!svg) return;
  saveFile("chartdown-map.svg", svg.outerHTML, "image/svg+xml");
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
      if (t === "candyworld") themeSelect.value = t;
    } catch {
      editor.value = manor;
    }
  } else {
    editor.value = manor;
  }
  renderNow();
}

void init();
