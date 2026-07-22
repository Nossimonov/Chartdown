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
      const args: Placement[] = [];
      while (i < tokens.length) {
        const next = tokens[i]!;
        // Area boundaries may follow features (#81): `along <ref>` between
        // two vertices makes the boundary trace the feature's curve there.
        if (c === "area" && ((next.kind === "chunk" && next.text === "along"))) {
          i++;
          const ref = takeRef("along");
          if (ref) args.push({ kind: "relational", form: "along", ref });
          continue;
        }
        if (next.kind !== "chunk") break;
        const pos = parsePositional(next.text);
        if (!pos) break;
        args.push(pos);
        i++;
      }
      result.placements.push({ kind: "shape", shape: c as ShapeKind, args });
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
      result.placements.push(
        point ? { kind: "relational", form: "on", ref, point }
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
      const ref = takeRef("along");
      if (ref) result.placements.push({ kind: "relational", form: "along", ref });
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
      if (chunkText(peek()) !== "to") {
        diagnostics.push(error(line, "expected 'to' in from…to placement"));
        continue;
      }
      i++;
      const to = takeEndpoint();
      if (!to) continue;
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
