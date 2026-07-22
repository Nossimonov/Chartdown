/**
 * The Chartdown playground: fully client-side (ADR 0007's thesis, cashed in).
 * Live render, fail-loud diagnostics, mode/theme toggles, corpus examples,
 * SVG download, and serverless sharing — the document deflate-compressed into
 * the URL fragment, which never leaves the browser.
 */

import { renderSource, type RenderMode } from "@chartdown/render-svg";
import brenmark from "../../examples/brenmark/brenmark.cd";
import tankard from "../../examples/gilded-tankard/gilded-tankard.cd";
import manor from "../../examples/fairwater-manor/fairwater-manor.cd";
import candyworld from "../../examples/gumdrop-vale/candyworld.theme.cd";
import gumdrop from "../../examples/gumdrop-vale/gumdrop-vale.cd";
import redford from "../../examples/redford-crossing/redford-crossing.cd";
import vessany from "../../examples/vessany/vessany.cd";

const EXAMPLES: Record<string, string> = {
  "Fairwater Manor (battlemap)": manor,
  "Ambush at Redford Crossing (battlemap)": redford,
  "The Gilded Tankard (keyed labels + legend)": tankard,
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

function download(): void {
  const svg = preview.querySelector("svg");
  if (!svg) return;
  const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "chartdown-map.svg";
  a.click();
  URL.revokeObjectURL(a.href);
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
