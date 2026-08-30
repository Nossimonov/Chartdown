/**
 * @chartdown/render-svg — deterministic SVG rendering for Chartdown documents.
 *
 * Determinism contract (spec 02 §8.2): output is a pure function of
 * (document, seed, renderer version, mode). Same inputs → byte-identical SVG.
 * Runtime dependencies: @chartdown/core only (ADR 0007).
 */

import { parse, type AddressRange, type Diagnostic, type DocumentNode, type EntityNode, type Pair, type ParseOptions, type Placement } from "@chartdown/core";
import { battlemapFrame, renderBattlemap } from "./battlemap";
import { titleBand } from "./grid";
import { hexFrame, renderHexcrawl } from "./hexcrawl";
import { buildLegend } from "./legend";
import { buildModel, pairOf, type Model, type RenderMode } from "./model";
import { regionFrame, renderRegion, resolveRegionGeometry } from "./region";
import { sceneFromBattlemap, sceneFromHexcrawl, sceneFromRegion, type SceneResult } from "./scene";
import { INK, PAPER, Theme } from "./theme";
import { colLetters, colToNumber, el, fmt, text } from "./util";

export interface RenderOptions {
  /** Fail-closed default per spec 01 §6. */
  mode?: RenderMode;
  /** Theme document source(s), layered over the default in order (spec 08 §5). */
  theme?: string | string[];
  /** Render a single level of a multi-level battlemap (spec 06 §8). */
  level?: string;
}

export interface RenderResult {
  svg: string;
  /** Render-time diagnostics (e.g. the implied-crossing warning, spec 06 §6). */
  diagnostics: Diagnostic[];
}

/**
 * A RENDERER INVARIANT IS REPORTED, NOT THROWN AT THE CALLER (#341).
 *
 * ADR 0043 made an unhandled edge direction a loud failure rather than a
 * silent east edge, which is right — `edgeSegment` throws on `nw`. Nothing
 * caught it. `check` renders unconditionally (#120), so a document the PARSER
 * had already refused with the exact right message — *"'C3.nw' names a corner,
 * and nothing in the language is placed on a corner"* — died before the print
 * loop and the author got a Node stack trace and no diagnostic at all.
 *
 * The guard lives HERE rather than in the CLI because `render` has three
 * callers outside this package — the CLI, `obsidian/src/block.ts` and
 * `mcp/src/raster.ts`. In a plugin an uncaught throw is worse than a stack
 * trace: a dead pane with no line number. Fixing it at one caller would have
 * left it live in two shipped products.
 *
 * The throw stays exactly as loud. What changes is that it arrives as a
 * result the caller can print instead of ending the process, and it is
 * reported as a RENDERER failure rather than folded in among the document's
 * own diagnostics — an invariant that fired means the renderer met something
 * it believes impossible, and flattening that would make the next one read as
 * the author's mistake.
 */
export function render(doc: DocumentNode, options: RenderOptions = {}): RenderResult {
  // Shared, so diagnostics earned BEFORE the throw survive it — a theme error
  // is still worth printing even when the drawing later gives out.
  const diagnostics: Diagnostic[] = [];
  try {
    return renderGuarded(doc, options, diagnostics);
  } catch (e) {
    diagnostics.push({
      severity: "error",
      line: 0,
      message:
        `the renderer could not draw this document: ${e instanceof Error ? e.message : String(e)}` +
        ` — this is a renderer fault, not a fault in the document, though an error reported above may be its cause`,
    });
    // A blank sheet rather than nothing: `render` writes its file and exits 1,
    // and a caller that embeds the output needs something valid to place.
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 620" width="860" height="620" font-family="sans-serif"></svg>`,
      diagnostics,
    };
  }
}

function renderGuarded(doc: DocumentNode, options: RenderOptions, diagnostics: Diagnostic[]): RenderResult {
  const mode = options.mode ?? "player";
  const theme = Theme.resolve(options.theme, diagnostics);
  /**
   * DOCUMENT FURNITURE IS INK TOO (#286). #150 wired the `ink` surface into
   * entity drawing and stopped at the entities; the title, the level caption,
   * the compass and the scale bar kept the bare constant, so `ink : fill=` was
   * a declaration the renderer's own dead-declaration lint (#116) reported as
   * reaching nothing — correctly, and the gap was underneath it. Spec 08 §2
   * lists `ink` in the closed surface set and exempts no part of the sheet.
   */
  const furnitureInk = theme.surface("ink", "fill", INK);
  const model = buildModel(doc, mode, theme, diagnostics);
  const body: string[] = [];

  let w = 860;
  let h = 620;

  // AN AMBIENT BASELINE IS A BATTLEMAP CONCERN (#287, spec 04 §5).
  //
  // `light: dark` on a region or hexcrawl rendered exactly as its own absence
  // and said nothing — the failure #206 rules on. The answer is not to wash
  // those map kinds: at region and hexcrawl zoom the reader is above the
  // weather, and a sheet that presumed otherwise would be unreadable for the
  // scale it is drawn at. Visibility is a tactical question, which is why it
  // lives where the tactical layer is, and it is the same reasoning #206
  // records for `difficult` on a region map — "difficulty is tactical; a
  // region map has no tactical layer".
  //
  // So the reason is written down, and #206 is satisfied by writing it. But
  // unlike `difficult`, which says nothing at all, this WARNS: an author who
  // declares an ambient is picturing a dark map, and silence would let them
  // keep picturing it. The line still parses and the map still renders —
  // nothing about the document is wrong, only unanswerable at this scale.
  //
  // What DOES work here is the regional override (`light "The Sunwell" :
  // blob … daylight`), which says a part of the map is lit differently rather
  // than the whole sheet — so the message names it.
  if (doc.mapType !== "battlemap") {
    for (const h of doc.header) {
      if (model.archetypeOf(h.key) !== "field") continue;
      diagnostics.push({
        severity: "warning",
        line: 1,
        message:
          `'${h.key}: ${h.value}' sets an ambient baseline, which a ${doc.mapType} map does not draw — `
          + `at this scale a reader is above the weather, and visibility is a tactical question (spec 04 §5). `
          + `To say that part of the map is lit differently, place it: `
          + `'${h.key} "The Sunwell" : blob at (x,y) size=… ${h.value}'`,
      });
    }
  }

  if (doc.mapType === "battlemap") {
    const frame = battlemapFrame(model);
    const levels = doc.levels.length > 0 ? doc.levels : [doc.defaultLevel];
    const selected = options.level !== undefined ? levels.filter((l) => l === options.level) : levels;
    const panelLevels = selected.length > 0 ? selected : levels;
    if (levels.length > 1) warnFlooredOpenStructures(model, levels, diagnostics);
    // A REDACTION IS NOT THE DOCUMENT (spec 06 §10, ADR 0045, #320).
    //
    // The coherence lints reason about what a document MEANS, and `hidden` and
    // `[gm]` say what a reader is SHOWN — so a player render was linting its
    // own redaction and reporting every secret entrance as `unreachable-room`,
    // since stripping the only way in leaves a room with no way in. Built ONCE
    // here rather than per panel, and only when the mode actually strips
    // something: in GM mode the model already IS the declared one.
    //
    // Diagnostics go to a SCRATCH array. This pass re-derives what `buildModel`
    // already reported for the drawn model — theme resolution, vocabulary,
    // placement resolution — and letting it report again would double every
    // one of them.
    const declaredEntities = mode === "gm" ? model.entities : buildModel(doc, "gm", theme, []).entities;
    const GAP = 18;
    // With `numbers: on` the column letters occupy the top margin band; the
    // document title gets its own band above them instead of overprinting A-D.
    const band = titleBand(doc, model.header);
    w = frame.w;
    h = panelLevels.length * frame.h + (panelLevels.length - 1) * GAP + band;
    body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: theme.surface("paper", "fill", PAPER) }));
    panelLevels.forEach((level, index) => {
      const panelModel = { ...model, entities: model.entities.filter((e) => e.level === level) };
      const panelBody: string[] = [];
      // BOTH sets go down, and the reciprocal-landing rule reads BOTH — one on
      // each side of itself (ADR 0046, #319). `allEntities` stays STRIPPED, so
      // a hidden connector projects a landing nowhere; `declaredEntities` is
      // what the guard consults to ask whether a connector was DECLARED at the
      // cell a projection would fill. Collapsing them is how #319 and #320 both
      // arose, so they are passed separately and named for what they are.
      renderBattlemap(panelModel, panelBody, frame, diagnostics, { level, allEntities: model.entities, declaredEntities, levels });
      if (panelLevels.length > 1) {
        // Bottom-right of the panel — the top margin belongs to the column letters.
        panelBody.push(
          text(`— ${level} —`, { x: frame.w - 14, y: frame.h - 8, "font-size": 11, "font-style": "italic", fill: furnitureInk, "text-anchor": "end", "font-family": "sans-serif" }),
        );
      }
      body.push(`<g transform="translate(0 ${fmt(band + index * (frame.h + GAP))})">${panelBody.join("")}</g>`);
    });
  } else if (doc.mapType === "hexcrawl") {
    const frame = hexFrame(model);
    w = frame.w;
    h = frame.h;
    body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: theme.surface("paper", "fill", PAPER) }));
    renderHexcrawl(model, body, diagnostics);
  } else {
    const frame = regionFrame(model);
    // Render resolution is an editorial choice, not a constant (#139, ADR
    // 0020). An SVG is resolution-independent and a reader of a large regional
    // map expects to zoom for detail, but every label decision was being made
    // as though the map would only ever be seen fit-to-width — so names were
    // shrunk, displaced and connected to win a competition that exists at one
    // zoom level only. On the Middle-earth map, doubling the canvas takes
    // labels forced below 10px from 42 to 13 and puts six more line labels on
    // their own courses, with nothing else changed.
    //
    // `overview` stays the default so no existing document re-renders: the
    // trade is real in both directions, since absolute font sizes mean a
    // larger canvas is proportionally smaller text at a glance.
    const scale = frame.scale;
    w = frame.w;
    h = frame.h;
    body.push(el("rect", { x: 0, y: 0, width: w, height: h, fill: theme.surface("paper", "fill", PAPER) }));
    renderRegion(model, body, { w, h, scale }, diagnostics);
  }

  // Furniture (spec 07 §4)
  if (model.header.get("legend") === "on" || model.labelsMode === "keyed") {
    const legend = buildLegend(model, w);
    if (legend.height > 0) {
      const band = el("rect", { x: 0, y: 0, width: w, height: legend.height, fill: theme.surface("paper", "fill", PAPER) });
      body.push(`<g transform="translate(0 ${fmt(h)})">${band}${legend.svg}</g>`);
      h += legend.height;
    }
  }
  if (doc.title) {
    body.push(text(doc.title, { x: 14, y: 22, "font-size": 16, "font-weight": "bold", fill: furnitureInk, "font-family": "sans-serif" }));
  }
  if (model.header.get("compass") === "on") {
    const cx = w - 34;
    const cy = 40;
    body.push(
      el("g", {},
        el("circle", { cx, cy, r: 14, fill: "none", stroke: furnitureInk, "stroke-width": 1 }),
        el("polygon", { points: `${fmt(cx)},${fmt(cy - 11)} ${fmt(cx - 4)},${fmt(cy + 6)} ${fmt(cx + 4)},${fmt(cy + 6)}`, fill: furnitureInk }),
        text("N", { x: cx, y: cy - 17, "font-size": 9, fill: furnitureInk, "text-anchor": "middle", "font-family": "sans-serif" }),
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
          el("line", { x1: 14, y1: y, x2: 14 + barPx, y2: y, stroke: furnitureInk, "stroke-width": 2 }),
          el("line", { x1: 14, y1: y - 4, x2: 14, y2: y + 4, stroke: furnitureInk, "stroke-width": 2 }),
          el("line", { x1: 14 + barPx, y1: y - 4, x2: 14 + barPx, y2: y + 4, stroke: furnitureInk, "stroke-width": 2 }),
          text(`${barUnits}${unit}`, { x: 14 + barPx / 2, y: y - 6, "font-size": 9, fill: furnitureInk, "text-anchor": "middle", "font-family": "sans-serif" }),
        ),
      );
    }
  }

  // Dead declarations in the selected theme (#116, ADR 0022). Last, because
  // liveness is measured by what the render just asked for: a theme entry is
  // live if it was consulted, and nothing can say so until the drawing is done.
  for (const dead of theme.deadDeclarations(themeSubjects(model))) {
    diagnostics.push({ severity: "warning", source: "theme", ...dead });
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" width="${fmt(w)}" height="${fmt(h)}" font-family="sans-serif">` +
    body.join("") +
    `</svg>`;
  return { svg, diagnostics };
}

/**
 * How many entities each theme SUBJECT resolves to (#148).
 *
 * "Does this subject resolve?" is a fact about the document, and the theme
 * cannot answer it — it only knows what the render asked it for. Told to guess
 * from its own hits, it reported `chain : stroke=…` as matching nothing while
 * four chains sat on the map, which sends an author looking for a typo that is
 * not there.
 *
 * Keyed exactly as `[theme]` subjects are written (spec 08 §2), so each form
 * answers for itself: a bare word counts everything deriving from it, a
 * `word.state` counts only entities actually in that state, a zone counts by
 * its base, and `side.<x>` counts by allegiance.
 */
function themeSubjects(model: Model): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string): void => void counts.set(key, (counts.get(key) ?? 0) + 1);
  const walk = (typeWord: string | null, flags: string[], pairs: Pair[]): void => {
    for (const word of model.chainOf(typeWord)) {
      bump(word);
      for (const zone of ["core", "edge"]) bump(`${word}.${zone}`);
      for (const flag of flags) bump(`${word}.${flag}`);
    }
    const side = pairOf(pairs, "side");
    if (side !== undefined) bump(`side.${side}`);
  };
  for (const e of model.entities) {
    walk(e.typeWord, e.flags, e.pairs);
    for (const d of e.details) walk(d.typeWord, d.flags, d.pairs);
  }
  return counts;
}

/** Cells an entity's placements cover, as "col:row" keys (addresses, ranges, and area shapes). */
function cellKeys(e: EntityNode): Set<string> {
  const keys = new Set<string>();
  const walk = (ps: Placement[]): void => {
    for (const p of ps) {
      if (p.kind === "address") {
        keys.add(`${colToNumber(p.col)}:${p.row}`);
      } else if (p.kind === "range") {
        addRange(p);
      } else if (p.kind === "shape" && p.shape === "area") {
        walk(p.args);
      }
    }
  };
  const addRange = (r: AddressRange): void => {
    const c1 = Math.min(colToNumber(r.from.col), colToNumber(r.to.col));
    const c2 = Math.max(colToNumber(r.from.col), colToNumber(r.to.col));
    const r1 = Math.min(r.from.row, r.to.row);
    const r2 = Math.max(r.from.row, r.to.row);
    for (let c = c1; c <= c2; c++) for (let row = r1; row <= r2; row++) keys.add(`${c}:${row}`);
  };
  walk(e.placements);
  return keys;
}

/**
 * Spec 06 §3 (issue #33): an `open` structure's sky cells — its footprint minus
 * sibling structures on its own level — must see `air` on the level above.
 * A floor above open ground is a contradiction worth flagging, not fixing.
 */
function warnFlooredOpenStructures(
  model: { entities: EntityNode[]; chainOf(word: string | null): string[] },
  levels: string[],
  diagnostics: Diagnostic[],
): void {
  for (const e of model.entities) {
    if (e.archetype !== "structure" || !e.flags.includes("open")) continue;
    const li = levels.indexOf(e.level ?? "");
    if (li <= 0) continue; // topmost level: nothing but sky above
    const above = levels[li - 1]!;
    const sky = cellKeys(e);
    for (const sib of model.entities) {
      if (sib === e || sib.level !== e.level || sib.archetype !== "structure") continue;
      for (const c of cellKeys(sib)) sky.delete(c);
    }
    for (const other of model.entities) {
      if (other.level !== above) continue;
      const floors =
        other.archetype === "structure" ||
        (other.section === "terrain" && !model.chainOf(other.typeWord).includes("air"));
      if (!floors) continue;
      const cells = cellKeys(other);
      const hit = [...sky].find((c) => cells.has(c));
      if (hit === undefined) continue;
      const [col, row] = hit.split(":").map(Number) as [number, number];
      const openName = e.name ?? e.ids[0] ?? e.typeWord ?? "structure";
      const floorName = other.name ?? other.ids[0] ?? other.typeWord ?? "entity";
      diagnostics.push({
        severity: "warning",
        line: e.line,
        message: `'${openName}' is open to the sky, but '${floorName}' floors it over on level ${above} (first at ${colLetters(col)}${row}) — open ground wants air above (spec 06 §3)`,
      });
    }
  }
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
  if (options.level !== undefined) renderOptions.level = options.level;
  const rendered = render(parsed.document, renderOptions);
  return { svg: rendered.svg, document: parsed.document, diagnostics: [...parsed.diagnostics, ...rendered.diagnostics] };
}

/**
 * THE RENDERER'S ANSWER AS DATA, BEFORE IT IS INK (#355, ADR 0051).
 *
 * `render` resolves a whole scene per call and discards it. This returns it:
 * geometry in MAP UNITS with each feature's identity, so a host can draw a
 * Chartdown map with its own primitives and agree with this renderer about
 * where the land is, rather than deriving resolution a second time from an AST
 * that hands placements over unresolved by design.
 *
 * One resolution pass, two views — `render` consumes the same pass for a
 * region, and reads the same `grid.ts`/`walls.ts` functions for a battlemap
 * that this does. A second pass that re-derived would be the drift ADR 0010
 * rejected outright.
 *
 * WHAT IS NOT HERE, deliberately: no ink (ADR 0037's split is the membership
 * test, and the theme document is already the interchange format for ink), and
 * no PLACED labels — a feature carries where its label wants to go, not where
 * arbitration put it. See `SceneResult`.
 */
export function resolveScene(doc: DocumentNode, options: RenderOptions = {}): SceneResult {
  const diagnostics: Diagnostic[] = [];
  const mode = options.mode ?? "player";
  // Resolved even though a scene carries no ink: `buildModel` reports theme
  // diagnostics, and a caller asking for geometry should still hear that its
  // theme did not load.
  const theme = Theme.resolve(options.theme, diagnostics);
  const model = buildModel(doc, mode, theme, diagnostics);
  if (doc.mapType === "battlemap") {
    return sceneFromBattlemap(model, battlemapFrame(model), diagnostics, options.level);
  }
  if (doc.mapType === "hexcrawl") {
    return sceneFromHexcrawl(model, hexFrame(model), diagnostics);
  }
  const frame = regionFrame(model);
  const { items } = resolveRegionGeometry(model, frame, diagnostics);
  return sceneFromRegion(model, frame, items, diagnostics);
}

export type { RenderMode } from "./model";
// Re-exported so a consumer that only depends on the renderer can still say
// WHERE a diagnostic is — a theme-sourced line is not a line of the map (#116).
export { locationOf } from "@chartdown/core";
export { readProvenance, stampProvenance, type Provenance } from "./provenance";
export {
  SCENE_SCHEMA_VERSION, type SceneDerivation, type SceneFeature, type SceneGeometry,
  type SceneLabel, type ScenePoint, type SceneResult, type SceneSegment,
} from "./scene";
export { exportUvtt, exportUvttSource, type UvttOptions, type UvttResult, type UvttSourceResult } from "./uvtt";

export {
  clamp, formatViewBox, isFitted, MAX_ZOOM, panBy, parseViewBox, sameMap, zoomAbout, zoomFactor,
  type Rect,
} from "./viewbox";
