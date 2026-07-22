/**
 * Generated legend (spec 07 §4, issue #63): built from the vocabulary words
 * actually used on the map — terrain swatches, path styles, feature glyphs —
 * never hand-maintained. Renders as a band below the map when `legend: on`.
 */

import type { EntityNode } from "@chartdown/core";
import type { Model } from "./model";
import { INK, tierFor, hasTierGlyph } from "./theme";
import { el, fmt, text } from "./util";

type SampleKind = "fill" | "stroke" | "barrier" | "glyph" | "tier";

interface Row {
  word: string;
  kind: SampleKind;
}

function kindFor(model: Model, e: EntityNode): SampleKind | null {
  if (!e.typeWord || e.gmOnly) return null;
  const chain = model.chainOf(e.typeWord);
  if (chain.includes("note") || chain.includes("start")) return null;
  switch (e.archetype) {
    case "terrain":
      return "fill";
    case "path":
      return "stroke";
    case "barrier":
      return "barrier";
    case "feature":
      return hasTierGlyph(chain) ? "tier" : "glyph";
    default:
      return null; // structures, tokens, zones label themselves on the map
  }
}

export function buildLegend(model: Model, width: number): { svg: string; height: number } {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const add = (word: string | null, kind: SampleKind | null): void => {
    if (!word || !kind || seen.has(word)) return;
    seen.add(word);
    rows.push({ word, kind });
  };

  for (const e of model.entities) add(e.typeWord, kindFor(model, e));
  for (const hex of model.hexLines) {
    add(hex.terrain, "fill");
    for (const word of hex.contents) add(word, hasTierGlyph(model.chainOf(word)) ? "tier" : "glyph");
  }
  if (rows.length === 0) return { svg: "", height: 0 };

  const ROW_H = 18;
  const PAD = 10;
  const colWidth = 150;
  const cols = Math.max(1, Math.min(4, Math.floor((width - PAD * 2) / colWidth)));
  const perCol = Math.ceil(rows.length / cols);
  const parts: string[] = [
    el("line", { x1: PAD, y1: 0.5, x2: width - PAD, y2: 0.5, stroke: "#c9c2b0", "stroke-width": 1 }),
  ];

  rows.forEach((row, i) => {
    const col = Math.floor(i / perCol);
    const x = PAD + col * colWidth;
    const y = PAD + (i % perCol) * ROW_H + ROW_H / 2;
    const chain = model.chainOf(row.word);
    switch (row.kind) {
      case "fill":
        parts.push(el("rect", { x, y: y - 5, width: 14, height: 10, fill: model.theme.terrainFill(chain), stroke: "#b5ad99", "stroke-width": 0.5 }));
        break;
      case "stroke": {
        const s = model.theme.pathStroke(chain);
        parts.push(el("line", { x1: x, y1: y, x2: x + 14, y2: y, stroke: s.stroke, "stroke-width": 3, "stroke-dasharray": s.dash }));
        break;
      }
      case "barrier": {
        const fence = chain.includes("fence");
        parts.push(
          el("line", {
            x1: x, y1: y, x2: x + 14, y2: y,
            stroke: fence ? "#8a7a5c" : INK, "stroke-width": fence ? 2 : 3,
            "stroke-dasharray": fence ? "3 3" : undefined, "stroke-linecap": "square",
          }),
        );
        break;
      }
      case "tier": {
        const tier = tierFor(chain);
        parts.push(el("circle", { cx: x + 7, cy: y, r: Math.min(5, tier.r), fill: "#3d3629" }));
        break;
      }
      case "glyph": {
        const themed = model.theme.glyphFor(chain, x, y);
        if (themed) {
          parts.push(
            `<path d="${themed}" transform="translate(${fmt(x + 7)} ${fmt(y)}) scale(0.5)" fill="none" stroke="${INK}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`,
          );
        } else if (["campfire", "torch", "brazier", "lantern"].some((w) => chain.includes(w))) {
          // Miniature of the battlemap fallback (kept visually in sync by the legend tests)
          parts.push(el("circle", { cx: x + 7, cy: y, r: 4, fill: "#d9822b", stroke: "#a8541e", "stroke-width": 1 }));
        } else if (chain.includes("stairs") || chain.includes("ramp")) {
          for (const [i, w] of [5, 3.5, 2].entries()) {
            const ty = y + (i - 1) * 3;
            parts.push(el("line", { x1: x + 7 - w, y1: ty, x2: x + 7 + w, y2: ty, stroke: INK, "stroke-width": 1.4 }));
          }
        } else {
          parts.push(el("rect", { x: x + 2, y: y - 5, width: 10, height: 10, fill: "#8f8474", stroke: INK, "stroke-width": 1 }));
        }
        break;
      }
    }
    parts.push(text(row.word, { x: x + 20, y: y + 3.5, "font-size": 9, fill: INK, "font-family": "sans-serif" }));
  });

  return { svg: parts.join(""), height: PAD * 2 + perCol * ROW_H };
}
