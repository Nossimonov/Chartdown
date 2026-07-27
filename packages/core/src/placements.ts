/**
 * Placement parsing (spec 02): addresses, ranges, points, edges, shapes,
 * and the closed relational grammar (§7 — nine forms, nothing else).
 */

import type {
  Address,
  AddressRange,
  Edge,
  EdgeDir,
  Endpoint,
  Pair,
  Placement,
  Point,
  PointRange,
  Ref,
  ShapeKind,
} from "./ast";
import { error, type Diagnostic } from "./diagnostics";
import type { Token } from "./lex";

const ADDRESS_RE = /^([A-Z]+)(\d+)$/;
const RANGE_RE = /^([A-Z]+\d+)\.\.([A-Z]+\d+)$/;
const EDGE_RE = /^([A-Z]+\d+)\.(ne|nw|se|sw|n|e|s|w)$/;
const POINT_RE = /^\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)$/;
const POINT_RANGE_RE = /^(\(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\))\.\.(\(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\))$/;
const MEASURE_RE = /^\d+(?:\.\d+)?[a-z]*$/;

const COMPASS = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "northeast", "northwest", "southeast", "southwest",
]);
const SHAPES = new Set<string>(["area", "path", "blob", "ridge"]);
const RELATIONAL_KEYWORDS = new Set(["at", "on", "near", "of", "from", "via", "to", "along", "edge"]);

export function parseAddress(text: string): Address | null {
  const m = ADDRESS_RE.exec(text);
  return m ? { kind: "address", col: m[1]!, row: Number(m[2]!) } : null;
}

/** Column letters to 1-based number and back: A=1, Z=26, AA=27 (spec 02 §1). */
const colToNumber = (letters: string): number => {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const numberToCol = (n: number): string => {
  let out = "";
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
};

/**
 * A repeat expands to ordinary cell placements at parse time (#114). Spacing
 * is authorial data, not renderer judgement — the arithmetic is fixed by the
 * document, so nothing downstream needs to know the line was written compactly
 * and the determinism contract (spec 02 §8.2) holds trivially.
 *
 * Offsets are measured from the range's NW corner, so the first cell is always
 * placed: `every 4 in A1..A9` gives A1, A5, A9, which is what a reader counting
 * bays expects.
 */
const REPEAT_LIMIT = 4096;
function expandRepeat(range: AddressRange, stepX: number, stepY: number): Address[] {
  const c0 = Math.min(colToNumber(range.from.col), colToNumber(range.to.col));
  const c1 = Math.max(colToNumber(range.from.col), colToNumber(range.to.col));
  const r0 = Math.min(range.from.row, range.to.row);
  const r1 = Math.max(range.from.row, range.to.row);
  const out: Address[] = [];
  for (let r = r0; r <= r1; r += stepY) {
    for (let c = c0; c <= c1; c += stepX) {
      out.push({ kind: "address", col: numberToCol(c), row: r });
      if (out.length > REPEAT_LIMIT) return out;
    }
  }
  return out;
}

export function parsePositional(text: string): Address | AddressRange | Point | PointRange | Edge | null {
  const range = RANGE_RE.exec(text);
  if (range) {
    return { kind: "range", from: parseAddress(range[1]!)!, to: parseAddress(range[2]!)! };
  }
  const edge = EDGE_RE.exec(text);
  if (edge) {
    return { kind: "edge", at: parseAddress(edge[1]!)!, dir: edge[2]! as EdgeDir };
  }
  const address = parseAddress(text);
  if (address) return address;
  const pointRange = POINT_RANGE_RE.exec(text);
  if (pointRange) {
    return { kind: "point-range", from: parsePoint(pointRange[1]!)!, to: parsePoint(pointRange[2]!)! };
  }
  return parsePoint(text);
}

export function parsePoint(text: string): Point | null {
  const m = POINT_RE.exec(text);
  return m ? { kind: "point", x: Number(m[1]!), y: Number(m[2]!) } : null;
}

export const isCompass = (word: string): boolean => COMPASS.has(word);
export const isMeasure = (word: string): boolean => MEASURE_RE.test(word);

export interface PredicateResult {
  placements: Placement[];
  flags: string[];
  pairs: Pair[];
  texts: string[];
  /** Every reference the predicate makes, for order-bounded validation (spec 02 §8.1). */
  refs: Ref[];
}

/** Parse a predicate token stream into placements, flags, pairs, and texts. */
export function parsePredicate(tokens: Token[], line: number, diagnostics: Diagnostic[]): PredicateResult {
  const result: PredicateResult = { placements: [], flags: [], pairs: [], texts: [], refs: [] };
  let i = 0;

  const peek = (offset = 0): Token | undefined => tokens[i + offset];
  const chunkText = (t: Token | undefined): string | null => (t?.kind === "chunk" ? t.text : null);

  const takeRef = (context: string): Ref | null => {
    const t = tokens[i];
    if (t?.kind === "string") {
      i++;
      const ref: Ref = { kind: "ref", form: "name", value: t.value };
      result.refs.push(ref);
      return ref;
    }
    if (t?.kind === "chunk" && !RELATIONAL_KEYWORDS.has(t.text) && !parsePositional(t.text)) {
      i++;
      const ref: Ref = { kind: "ref", form: "id", value: t.text };
      result.refs.push(ref);
      return ref;
    }
    diagnostics.push(error(line, `expected a reference after '${context}'`));
    return null;
  };

  // `along [<compass> edge of] <ref>` — the face qualifier names WHICH line
  // of an areal feature the boundary follows (ADR 0013): a crestless
  // mountain area offers two faces, and the language never guesses.
  const takeAlongFace = (): string | undefined => {
    const a = chunkText(peek());
    if (a && isCompass(a) && chunkText(peek(1)) === "edge" && chunkText(peek(2)) === "of") {
      i += 3;
      return a;
    }
    return undefined;
  };

  /**
   * `every <n>[x<m>] in <range>` after the keyword has been consumed (#114).
   * Returns the expanded cells, or null having already reported why not — one
   * implementation for both the bare form and the `on <ref> at every …` form,
   * so the two can never drift into different diagnostics.
   */
  const takeRepeat = (): Address[] | null => {
    const stepText = chunkText(peek());
    const m = stepText ? /^(\d+)(?:x(\d+))?$/.exec(stepText) : null;
    if (!m) {
      diagnostics.push(error(line, "'every' takes a whole-number step: 'every 4 in <range>', or 'every 4x6 in <range>' for independent column and row steps (spec 02 §9)"));
      return null;
    }
    const stepX = Number(m[1]);
    const stepY = m[2] === undefined ? stepX : Number(m[2]);
    i++;
    if (stepX < 1 || stepY < 1) {
      diagnostics.push(error(line, "'every' steps by at least 1 cell (spec 02 §9)"));
      return null;
    }
    const kw = chunkText(peek());
    if (kw !== "in") {
      diagnostics.push(error(line, kw === "along"
        ? "'every … along <ref>' spaces by a MEASURE, not a count — 'every 6ft along gallery' (spec 02 §9)"
        : "'every <n>' is followed by 'in <range>' (spec 02 §9)"));
      return null;
    }
    i++;
    const rangeText = chunkText(peek());
    const range = rangeText ? parsePositional(rangeText) : null;
    if (!range || range.kind !== "range") {
      // `every` over EDGES is deliberately refused rather than merely unparsed
      // (#114 with #130). Repetition in edge space is what side words are for:
      // `cave-in : east` names the whole run however long, and survives the
      // structure moving, which a stepped edge list would not.
      const edgeish = rangeText !== null && /^[A-Z]+\d+\.(ne|nw|se|sw|n|e|s|w)\.\./.test(rangeText);
      diagnostics.push(error(line, edgeish
        ? "'every' steps over CELLS, not edges — name the side instead ('cave-in : east' replaces that whole run, spec 06 §3), or list the edges (spec 02 §9)"
        : "expected a cell range after 'in', e.g. 'every 4 in FH38..GF102' (spec 02 §9)"));
      return null;
    }
    i++;
    const cells = expandRepeat(range, stepX, stepY);
    if (cells.length > REPEAT_LIMIT) {
      diagnostics.push(error(line, `'every ${stepText} in ${rangeText}' expands past ${REPEAT_LIMIT} cells — narrow the range or widen the step (spec 02 §9)`));
      return null;
    }
    return cells;
  };

  const takeEndpoint = (): Endpoint | null => {
    const t = tokens[i];
    if (t?.kind === "chunk") {
      const point = parsePoint(t.text);
      if (point) {
        i++;
        return { at: point };
      }
    }
    const ref = takeRef("from/to");
    if (!ref) return null;
    if (chunkText(peek()) === "at") {
      i++;
      const pt = chunkText(peek());
      const point = pt ? parsePoint(pt) : null;
      if (!point) {
        diagnostics.push(error(line, "expected a point after 'at' in a path endpoint"));
        return { at: ref };
      }
      i++;
      return { at: ref, point };
    }
    return { at: ref };
  };

  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === "pair") {
      result.pairs.push({ key: t.key, value: t.value });
      i++;
      continue;
    }
    if (t.kind === "string") {
      result.texts.push(t.value);
      i++;
      continue;
    }
    if (t.kind === "colon") {
      diagnostics.push(error(line, "unexpected ':' in predicate"));
      i++;
      continue;
    }
    const c = t.text;

    if (SHAPES.has(c)) {
      i++;
      // `ridge on <ref> at (…) (…)` (#142): the points that follow are offsets
      // in the referent's frame, so the whole shape travels with it. Spec 02
      // §7 already says exactly this for a structure's contents; a spur off a
      // peak is the same relationship, and shapes were the one place the
      // live-anchor promise did not reach.
      let frame: Ref | undefined;
      if (chunkText(peek()) === "on") {
        i++;
        const ref = takeRef("on");
        if (!ref) continue;
        if (chunkText(peek()) !== "at") {
          diagnostics.push(error(line, `'${c} on ${ref.value}' needs 'at' and the offsets that follow it — '${c} on ${ref.value} at (-70,100) (-90,170)' (spec 02 §9)`));
          continue;
        }
        i++;
        frame = ref;
      }
      const args: Placement[] = [];
      while (i < tokens.length) {
        const next = tokens[i]!;
        // Area boundaries may follow features (#81): `along <ref>` between
        // two vertices makes the boundary trace the feature's curve there.
        if (c === "area" && ((next.kind === "chunk" && next.text === "along"))) {
          i++;
          const face = takeAlongFace();
          const ref = takeRef("along");
          if (ref) args.push(face ? { kind: "relational", form: "along", ref, face } : { kind: "relational", form: "along", ref });
          continue;
        }
        if (next.kind !== "chunk") break;
        const pos = parsePositional(next.text);
        if (!pos) break;
        args.push(pos);
        i++;
      }
      result.placements.push(frame ? { kind: "shape", shape: c as ShapeKind, args, frame } : { kind: "shape", shape: c as ShapeKind, args });
      continue;
    }

    // `every <n> in <range>` / `every <n>x<m> in <range>` (#114): a repeat
    // QUALIFIER, not a tenth relational form — spec 02 §7's closed list is
    // untouched. A dwarf-hall IS its colonnade, and writing one meant 56
    // hand-computed addresses that said nothing about the regularity and
    // silently broke the moment the hall moved.
    if (c === "every") {
      i++;
      // `every <measure> along <ref>` (#140) needs geometry the parser does not
      // have, so it survives as a placement for the renderer to expand. The
      // `along` keyword is what disambiguates it from `every 4 in …`, since a
      // bare integer is also a legal measure.
      const stepText = chunkText(peek());
      if (stepText !== null && isMeasure(stepText) && chunkText(peek(1)) === "along") {
        i += 2;
        const ref = takeRef("along");
        if (!ref) continue;
        result.placements.push({ kind: "relational", form: "every-along", measure: stepText, ref });
        continue;
      }
      const cells = takeRepeat();
      if (cells === null) continue;
      result.placements.push(...cells);
      continue;
    }

    if (c === "at") {
      i++;
      const targetText = chunkText(peek());
      const target = targetText ? parsePositional(targetText) : null;
      if (!target || target.kind === "point-range") {
        diagnostics.push(error(line, "expected a point, cell, range, or edge after 'at'"));
        continue;
      }
      i++;
      result.placements.push({ kind: "relational", form: "at", target });
      continue;
    }

    if (c === "on") {
      i++;
      const ref = takeRef("on");
      if (!ref) continue;
      // An `at` clause binds to the `on` (spec 02 §7, #34): a point is the
      // gridless form; a cell/range/edge is interpreted in the referent's
      // frame (structure footprint, or the document grid for paths — the
      // crossing chooser of spec 06 §6 rides this same form).
      let point: Point | undefined;
      let at: Address | AddressRange | Edge | undefined;
      if (chunkText(peek()) === "at" && chunkText(peek(1)) === "every") {
        // `on <ref> at every <n> in <range>` — the repeat lands in the
        // REFERENT's frame, which is the whole point of #114: a colonnade
        // written in its hall's own coordinates moves when the hall moves,
        // where fifty-six absolute addresses silently do not.
        i += 2;
        const cells = takeRepeat();
        if (cells === null) continue;
        for (const cell of cells) result.placements.push({ kind: "relational", form: "on", ref, at: cell });
        continue;
      }
      if (chunkText(peek()) === "at") {
        const after = chunkText(peek(1));
        const parsed = after ? parsePositional(after) : null;
        if (parsed?.kind === "point") {
          point = parsed;
          i += 2;
        } else if (parsed && parsed.kind !== "point-range") {
          at = parsed;
          i += 2;
        }
      }
      // `on <ref> at <point> via <point>…` (#169): the feature's CENTERLINE.
      // A bite is otherwise one straight run, and Hood Canal turns hard east
      // at the Great Bend — one inlet with one mouth and one head, which is
      // not the line-BRANCHING that spec 05 §4 stages. Only meaningful after
      // an `at` point, since the centerline starts at the mouth.
      const via: Point[] = [];
      if (point && chunkText(peek()) === "via") {
        i++;
        for (;;) {
          const text = chunkText(peek());
          const next = text ? parsePoint(text) : null;
          if (!next) break;
          via.push(next);
          i++;
        }
        if (via.length === 0) {
          diagnostics.push(error(line, `'via' on '${ref.value}' has no points — a centerline needs at least one (spec 05 §4)`));
        }
      }
      result.placements.push(
        point && via.length > 0 ? { kind: "relational", form: "on", ref, point, via }
        : point ? { kind: "relational", form: "on", ref, point }
        : at ? { kind: "relational", form: "on", ref, at }
        : { kind: "relational", form: "on", ref },
      );
      continue;
    }

    if (c === "near") {
      i++;
      const nextText = chunkText(peek());
      const point = nextText ? parsePoint(nextText) : null;
      if (point) {
        i++;
        result.placements.push({ kind: "relational", form: "near", target: point });
        continue;
      }
      const ref = takeRef("near");
      if (ref) result.placements.push({ kind: "relational", form: "near", target: ref });
      continue;
    }

    if (c === "along") {
      i++;
      const face = takeAlongFace();
      const ref = takeRef("along");
      if (ref) result.placements.push(face ? { kind: "relational", form: "along", ref, face } : { kind: "relational", form: "along", ref });
      continue;
    }

    if (c === "from") {
      i++;
      const from = takeEndpoint();
      if (!from) continue;
      const via: Point[] = [];
      if (chunkText(peek()) === "via") {
        i++;
        while (i < tokens.length) {
          const pt = chunkText(peek());
          const point = pt ? parsePoint(pt) : null;
          if (!point) break;
          via.push(point);
          i++;
        }
        if (via.length === 0) diagnostics.push(error(line, "expected at least one point after 'via'"));
      }
      // `join <ref>` is a terminal endpoint alongside `to` (#94): the river
      // ends on the referenced course rather than at a place. `to <river>`
      // stays what aspect adaptation says it is — the course's MIDPOINT —
      // because overloading it would break that rule for one archetype; the
      // two spellings now read as the deliberate pair they are.
      const terminal = chunkText(peek());
      if (terminal !== "to" && terminal !== "join") {
        diagnostics.push(error(line, "expected 'to' or 'join' in from…to placement (spec 02 §7)"));
        continue;
      }
      i++;
      const to = takeEndpoint();
      if (!to) continue;
      if (terminal === "join") {
        if (to.at.kind !== "ref") {
          diagnostics.push(error(line, "'join' takes the watercourse to end on, not a position — 'join mitheithel' (spec 02 §7)"));
          continue;
        }
        if (to.point) {
          diagnostics.push(error(line, "'join <ref>' finds the meeting point itself; drop the 'at <point>' (spec 02 §7)"));
          continue;
        }
        to.join = true;
      }
      result.placements.push({ kind: "relational", form: "from-to", from, via, to });
      continue;
    }

    if (isMeasure(c) && isCompass(chunkText(peek(1)) ?? "") && chunkText(peek(2)) === "of") {
      const compass = chunkText(peek(1))!;
      i += 3;
      const ref = takeRef("of");
      if (ref) result.placements.push({ kind: "relational", form: "offset-of", measure: c, compass, ref });
      continue;
    }

    if (isCompass(c)) {
      if (chunkText(peek(1)) === "edge" && chunkText(peek(2)) === "of") {
        i += 3;
        const ref = takeRef("edge of");
        if (ref) result.placements.push({ kind: "relational", form: "edge-of", compass: c, ref });
        continue;
      }
      if (chunkText(peek(1)) === "of") {
        i += 2;
        const ref = takeRef("of");
        if (ref) result.placements.push({ kind: "relational", form: "side-of", compass: c, ref });
        continue;
      }
      // Standalone compass word: a flag (e.g. structure-detail side words).
      result.flags.push(c);
      i++;
      continue;
    }

    const positional = parsePositional(c);
    if (positional) {
      result.placements.push(positional);
      i++;
      continue;
    }

    if (RELATIONAL_KEYWORDS.has(c)) {
      // The relational grammar is closed (spec 02 §7): a keyword outside its
      // form is a syntax error, never a silent flag ("X to Y" without `from`).
      diagnostics.push(error(line, `misplaced relational keyword '${c}' — the closed placement grammar defines only the nine forms of spec 02 §7`));
      i++;
      continue;
    }

    result.flags.push(c);
    i++;
  }

  return result;
}
