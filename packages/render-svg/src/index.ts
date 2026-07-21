/**
 * @chartdown/render-svg — deterministic SVG rendering for Chartdown documents.
 *
 * Determinism contract (spec 02 §8.2): output is a pure function of
 * (document, seed, renderer version, mode). Same inputs → byte-identical SVG.
 * Runtime dependencies: @chartdown/core only (ADR 0007).
 */

import { parse, type Diagnostic, type DocumentNode, type ParseOptions } from "@chartdown/core";
import { battlemapFrame, renderBattlemap } from "./battlemap";
import { hexFrame, renderHexcrawl } from "./hexcrawl";
import { buildModel, type RenderMode } from "./model";
import { renderRegion } from "./region";
import { INK, PAPER, Theme } from "./theme";
import { el, fmt, text } from "./util";

export interface RenderOptions {
  /** Fail-closed default per spec 01 §6. */
  mode?: RenderMode;
  /** Theme document source(s), layered over the default in order (spec 08 §5). */
  theme?: string | string[];
}

export interface RenderResult {
  svg: string;
  /** Render-time diagnostics (e.g. the implied-crossing warning, spec 06 §6). */
  diagnostics: Diagnostic[];
}

export function render(doc: DocumentNode, options: RenderOptions = {}): RenderResult {
  const mode = options.mode ?? "player";
  const diagnostics: Diagnostic[] = [];
  const theme = Theme.resolve(options.theme, diagnostics);
  const model = buildModel(doc, mode, theme);
  const body: string[] = [];

  let w = 860;
  let h = 620;

  if (doc.mapType === "battlemap") {
    const frame = battlemapFrame(model);
    w = frame.w;
    h = frame.h;
    body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: theme.surface("paper", "fill", PAPER) }));
    renderBattlemap(model, body, frame, diagnostics);
  } else if (doc.mapType === "hexcrawl") {
    const frame = hexFrame(model);
    w = frame.w;
    h = frame.h;
    body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: theme.surface("paper", "fill", PAPER) }));
    renderHexcrawl(model, body);
  } else {
    const extent = /^(\d+)x(\d+)([a-z]*)$/.exec(model.header.get("extent") ?? "800x600");
    const unitsW = Number(extent?.[1] ?? 800);
    const unitsH = Number(extent?.[2] ?? 600);
    const scale = 820 / unitsW;
    w = 820;
    h = unitsH * scale;
    body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: theme.surface("paper", "fill", PAPER) }));
    renderRegion(model, body, { w, h, scale });
  }

  // Furniture (spec 07 §4)
  if (doc.title) {
    body.push(text(doc.title, { x: 14, y: 22, "font-size": 16, "font-weight": "bold", fill: INK, "font-family": "sans-serif" }));
  }
  if (model.header.get("compass") === "on") {
    const cx = w - 34;
    const cy = 40;
    body.push(
      el("g", {},
        el("circle", { cx, cy, r: 14, fill: "none", stroke: INK, "stroke-width": 1 }),
        el("polygon", { points: `${fmt(cx)},${fmt(cy - 11)} ${fmt(cx - 4)},${fmt(cy + 6)} ${fmt(cx + 4)},${fmt(cy + 6)}`, fill: INK }),
        text("N", { x: cx, y: cy - 17, "font-size": 9, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }),
      ),
    );
  }
  if (model.header.get("scale-bar") === "on") {
    const extent = /^(\d+)x(\d+)([a-z]*)$/.exec(model.header.get("extent") ?? "");
    if (extent) {
      const unitsW = Number(extent[1]);
      const unit = extent[3] || "";
      const barUnits = Math.max(10, Math.round(unitsW / 8 / 10) * 10);
      const barPx = (barUnits / unitsW) * w;
      const y = h - 16;
      body.push(
        el("g", {},
          el("line", { x1: 14, y1: y, x2: 14 + barPx, y2: y, stroke: INK, "stroke-width": 2 }),
          el("line", { x1: 14, y1: y - 4, x2: 14, y2: y + 4, stroke: INK, "stroke-width": 2 }),
          el("line", { x1: 14 + barPx, y1: y - 4, x2: 14 + barPx, y2: y + 4, stroke: INK, "stroke-width": 2 }),
          text(`${barUnits}${unit}`, { x: 14 + barPx / 2, y: y - 6, "font-size": 9, fill: INK, "text-anchor": "middle", "font-family": "sans-serif" }),
        ),
      );
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" width="${fmt(w)}" height="${fmt(h)}" font-family="sans-serif">` +
    body.join("") +
    `</svg>`;
  return { svg, diagnostics };
}

export interface RenderSourceResult {
  svg: string;
  document: DocumentNode;
  /** Parse diagnostics followed by render diagnostics. */
  diagnostics: Diagnostic[];
}

/** Convenience: parse + render in one call (best-effort on parse errors). */
export function renderSource(source: string, options: RenderOptions & ParseOptions = {}): RenderSourceResult {
  const parsed = parse(source, options.libraries ? { libraries: options.libraries } : {});
  const renderOptions: RenderOptions = {};
  if (options.mode) renderOptions.mode = options.mode;
  if (options.theme) renderOptions.theme = options.theme;
  const rendered = render(parsed.document, renderOptions);
  return { svg: rendered.svg, document: parsed.document, diagnostics: [...parsed.diagnostics, ...rendered.diagnostics] };
}

export type { RenderMode } from "./model";
