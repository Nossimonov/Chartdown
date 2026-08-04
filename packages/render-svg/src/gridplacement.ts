/**
 * Battlemap resolution for spec 02 §7's relational forms (#239, #238).
 *
 * §7 is normative for every map kind, and the battlemap renderer answered
 * three of its nine forms. The other six were **silent**: the entity parsed,
 * `check` passed, and the SVG came out byte-identical to the same document
 * with the line deleted. That is the failure #207 already ruled on in as many
 * words — "silence is the one answer that is certainly wrong" — found twice
 * since, one form at a time (#233, #238).
 *
 * Two forms resolve here and the rest are refused, and both halves come from
 * §7 rather than from taste:
 *
 * - **`at <cell>` is the bare cell.** §7 says so outright — "`at <point>`
 *   (`at` optional on grids)" — so the keyword spelling has to mean what the
 *   bare spelling means.
 * - **`from … to …` draws a course**, per [ADR 0038](../../../docs/decisions/0038-a-placement-form-means-the-same-thing-on-every-map-kind.md):
 *   a placement form means the same thing on every map kind. Region maps have
 *   drawn courses this way since §7 was written (#238).
 * - **Everything else is refused, not silently dropped.** §7 already says an
 *   under-determined placement is "ambiguous — a fail-loud error — and an
 *   `at <cell|point>` *chooses* among the candidates". `near the fountain`
 *   names no cell, and no rule anywhere says which one it meant.
 *
 * Resolution happens once, in the model, so the renderer, the coherence lints,
 * the wall collector and the UVTT exporter all see the same ground. A form
 * only the renderer understood would be the two-definitions-of-solid failure
 * that `grid.ts` exists to prevent.
 */

import type { Address, Diagnostic, EntityNode, Placement, Ref, Shape } from "@chartdown/core";
import { colToNumber } from "./util";

/**
 * Forms this module leaves alone because something downstream resolves them —
 * which depends on the grid. `side-of` is a battlemap's relational extent
 * (#231); on a hexcrawl nothing answers it, and leaving it in the exempt set
 * is how `realm : north of bren` went on being silent after the rest were
 * caught. `every-along` is expanded for every map kind before this runs.
 */
const handledElsewhere = (kind: "battlemap" | "hexcrawl"): Set<string> =>
  kind === "battlemap" ? new Set(["side-of", "every-along"]) : new Set(["every-along"]);

const colLetters = (n: number): string => {
  let s = "";
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
};

const addr = (col: number, row: number): Address => ({ kind: "address", col: colLetters(col), row });

/** Every cell an entity's own placements name, in document order. */
function cellsOf(e: EntityNode): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const push = (p: Placement): void => {
    if (p.kind === "address") out.push({ col: colToNumber(p.col), row: p.row });
    else if (p.kind === "range") {
      const c1 = colToNumber(p.from.col);
      const c2 = colToNumber(p.to.col);
      out.push({ col: Math.round((c1 + c2) / 2), row: Math.round((p.from.row + p.to.row) / 2) });
    } else if (p.kind === "shape") for (const a of p.args) push(a);
  };
  for (const p of e.placements) push(p);
  return out;
}

/**
 * Where a course endpoint lands, in cells.
 *
 * A reference to a LINE resolves to its midpoint, which is spec 03's aspect
 * adaptation and not a special case invented here: `to <river>` flows to the
 * middle of that river, exactly as it does on a region map.
 */
function anchorCell(ref: Ref, byId: Map<string, EntityNode>, byName: Map<string, EntityNode>): { col: number; row: number } | null {
  const host = ref.form === "id" ? byId.get(ref.value) : byName.get(ref.value);
  if (!host) return null;
  const cells = cellsOf(host);
  if (cells.length === 0) return null;
  if (cells.length === 1) return cells[0]!;
  return cells[Math.floor(cells.length / 2)]!;
}

/** The cell on `ref`'s course nearest `from` — `join`'s meeting point (#94). */
function nearestOnCourse(
  ref: Ref,
  from: { col: number; row: number },
  byId: Map<string, EntityNode>,
  byName: Map<string, EntityNode>,
): { col: number; row: number } | null {
  const host = ref.form === "id" ? byId.get(ref.value) : byName.get(ref.value);
  if (!host) return null;
  const cells = cellsOf(host);
  if (cells.length === 0) return null;
  let best = cells[0]!;
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c.col - from.col) ** 2 + (c.row - from.row) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

const formText = (p: Extract<Placement, { kind: "relational" }>): string => {
  switch (p.form) {
    case "near": return `near ${p.target.kind === "ref" ? p.target.value : "(…)"}`;
    case "offset-of": return `${p.measure} ${p.compass} of ${p.ref.value}`;
    case "edge-of": return `${p.compass} edge of ${p.ref.value}`;
    case "along": return `along ${p.ref.value}`;
    case "at": return "at (…)";
    case "side-of": return `${p.compass} of ${p.ref.value}`;
    case "on": return `on ${p.ref.value}`;
    case "from-to": return "from … to …";
    default: return p.form;
  }
};

/**
 * Rewrites what a battlemap can resolve and reports what it cannot.
 *
 * Runs on the model, before anything reads the entities.
 */
export function resolveGridPlacements(
  entities: EntityNode[],
  chainOf: (word: string | null) => string[],
  diagnostics: Diagnostic[],
  /**
   * Which grid this is. Both answer `at <address>` identically — §7 makes
   * `at` optional ON GRIDS and a hexcrawl is one — and both refuse what
   * states a relation without stating a square. They differ in what they
   * RESOLVE beyond that: a battlemap draws a course between anchors (#238),
   * where what `from … to …` means across hexes is an open question nobody
   * has answered (#248). Refusing is the honest answer until someone does.
   */
  kind: "battlemap" | "hexcrawl" = "battlemap",
): void {
  const byId = new Map<string, EntityNode>();
  const byName = new Map<string, EntityNode>();
  for (const e of entities) {
    for (const id of e.ids) if (!byId.has(id)) byId.set(id, e);
    if (e.name && !byName.has(e.name)) byName.set(e.name, e);
  }

  // A battlemap has cells; a hexcrawl has hexes. Saying "cell" to someone
  // looking at a hex map is a small thing that reads as a tool talking about
  // a different document than the one in front of them.
  const exempt = handledElsewhere(kind);
  const cellWord = kind === "hexcrawl" ? "hex" : "cell";
  // What to write instead, in the spellings THIS map kind actually has: a
  // hexcrawl has no structures to place against, so offering `on <structure>
  // at <cell>` there sends an author looking for a form the grammar will not
  // give them on this document.
  const instead = kind === "hexcrawl"
    ? "give the hex you mean (`C3`, or a range `C2..C4`)"
    : "give the cell you mean (`F6`, `D4..F6`, or `on <structure> at <cell>`)";
  entities.forEach((e, index) => {
    // Free text carries its own closed placement set (spec 07 §2) and its own
    // renderer, including `along <ref>`, which rides the referenced course.
    // Judging it by the general rules below would refuse a caption the spec
    // spells out.
    if (chainOf(e.typeWord).includes("note")) return;
    const chain = chainOf(e.typeWord);
    // A crossing derives its position from the INTERSECTION of two bands
    // (spec 06 §6), so its bare `on` references are the whole idiom and are
    // resolved by the renderer, not here.
    const isCrossing = chain.includes("ford") || chain.includes("bridge");
    // `from … to … along <ref>` is one placement plus a shape HINT, which is
    // spec 02 §7's own example (`road "Coast Road" : from … to … along coast`).
    // Judged alone the hint names no cell, so without this the spec's own
    // spelling would be reported as an error.
    const hasCourse = e.placements.some((p) => p.kind === "relational" && p.form === "from-to");
    let changed = false;
    const placements: Placement[] = [];

    for (const p of e.placements) {
      if (p.kind !== "relational" || exempt.has(p.form)) {
        placements.push(p);
        continue;
      }

      // `at <cell>` IS the bare cell (spec 02 §7). A world POINT is the
      // gridless spelling and names no square, so it is refused rather than
      // rounded to one the author did not write.
      if (p.form === "at") {
        if (p.target.kind === "point") {
          diagnostics.push({
            severity: "error",
            line: e.line,
            message: `'${e.typeWord ?? "this"}' is placed at a gridless point on a ${kind} — ${instead} (spec 02 §7)`,
          });
          continue;
        }
        placements.push(p.target);
        changed = true;
        continue;
      }

      // A course between anchors (#238, ADR 0038) — battlemaps only.
      if (p.form === "from-to" && kind === "battlemap") {
        const ends: { col: number; row: number }[] = [];
        let failed = false;
        const resolveEnd = (at: Ref | { kind: "point" }, join: boolean, previous: { col: number; row: number } | null): void => {
          if (at.kind !== "ref") {
            diagnostics.push({
              severity: "error",
              line: e.line,
              message: `'${e.typeWord ?? "this"}' runs from or to a gridless point on a battlemap — name an entity, or draw it with \`path\` (spec 02 §7)`,
            });
            failed = true;
            return;
          }
          const cell = join && previous
            ? nearestOnCourse(at, previous, byId, byName)
            : anchorCell(at, byId, byName);
          if (!cell) {
            diagnostics.push({
              severity: "error",
              line: e.line,
              message: `'${e.typeWord ?? "this"}' runs ${join ? "to join" : "to"} '${at.value}', which names no cell on this map — reference something placed, or draw it with \`path\` (spec 02 §7)`,
            });
            failed = true;
            return;
          }
          ends.push(cell);
        };
        resolveEnd(p.from.at, false, null);
        resolveEnd(p.to.at, p.to.join === true, ends[0] ?? null);
        if (failed || ends.length < 2) continue;
        // `via` carries world points, which a grid cannot site; the endpoints
        // are what the author named, so the run between them is the course.
        const shape: Shape = { kind: "shape", shape: "path", args: ends.map((c) => addr(c.col, c.row)) };
        placements.push(shape);
        changed = true;
        continue;
      }

      // `on <ref>` with no `at` payload. Two of them is a crossing, and one
      // against a structure is #34's local frame — both resolved elsewhere.
      // A lone one against anything else states no cell.
      if (p.form === "on") {
        // A crossing derives from two bands intersecting, which is spec 06 §6
        // and therefore a battlemap idiom; a hexcrawl has no such machinery.
        if ((isCrossing && kind === "battlemap") || p.at !== undefined) {
          placements.push(p);
          continue;
        }
        diagnostics.push({
          severity: "error",
          line: e.line,
          message: `'on ${p.ref.value}' names no ${cellWord} on a ${kind} — say where on it: \`on ${p.ref.value} at <${cellWord}>\` (spec 02 §7, #34)`,
        });
        changed = true;
        continue;
      }

      // A shape hint riding a course, rather than a placement of its own.
      if (p.form === "along" && hasCourse) {
        diagnostics.push({
          severity: "warning",
          line: e.line,
          message: `'along ${p.ref.value}' is not applied on a ${kind} — the course runs straight between its anchors; place the cells with \`path\` to make it follow (spec 02 §7)`,
        });
        changed = true;
        continue;
      }

      // Everything else: §7's own ambiguity rule. Nothing on this map says
      // which cell `near the fountain` means, and inventing one would be the
      // silent pick #207 and ADR 0031 both refuse.
      diagnostics.push({
        severity: "error",
        line: e.line,
        message: `'${formText(p)}' names no ${cellWord} on a ${kind} — this placement is satisfiable in more than one place, so ${instead} (spec 02 §7)`,
      });
      changed = true;
    }

    if (changed) {
      const clone: EntityNode = { ...e, placements };
      entities[index] = clone;
      // The lookup maps must follow the rewrite, or a course anchored on
      // ANOTHER course reads its trunk's unresolved placements and finds no
      // cells — which is exactly `join`, the form §7 singles out as resolving
      // to a derived position. Caught by the example written to exercise it.
      if (e.name && byName.get(e.name) === e) byName.set(e.name, clone);
      for (const id of e.ids) if (byId.get(id) === e) byId.set(id, clone);
    }
  });
}
