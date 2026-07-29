/**
 * The Chartdown parser: document structure (spec 01), placements (spec 02),
 * identity and references (spec 03), vocabulary (spec 04), map-type sections
 * (specs 05–07). Fail-loud: every violated rule produces a diagnostic naming
 * its line; the parser recovers and keeps going so authors see everything.
 */

import type {
  Address,
  AddressRange,
  DetailNode,
  DocumentNode,
  EntityNode,
  GmAttachmentNode,
  GridSpec,
  HeaderEntry,
  HexLineNode,
  LabelHint,
  LabelOverrideNode,
  Pair,
  Ref,
  SectionNode,
  VocabEntryNode,
} from "./ast";
import { error, warning, type Diagnostic } from "./diagnostics";
import { splitLines, tokenize, type RawLine, type Token } from "./lex";
import { isCompass, parseAddress, parsePositional, parsePredicate } from "./placements";
import { checkFacetValues, inferArchetype, loadStdlib, parseVocabDocument, parseVocabLine, VocabTable } from "./vocab";

// The spec and the packages version together (see CHANGELOG): a release's
// major.minor IS the spec version its documents may target.
export const SPEC_VERSION = "0.4";

export interface ParseOptions {
  /** Sources for `use:` libraries, keyed by the exact `use:` value. */
  libraries?: Record<string, string>;
  /**
   * Other documents this one is joined to, keyed by the exact path written in
   * `detail=` or `inset:` (#109, #143). A map is the sum of the files that make
   * it up (ADR 0021), and this is how the other files reach a checker: the
   * caller resolves paths, the parser never touches a filesystem. Without them
   * the seam simply goes unchecked.
   */
  documents?: Record<string, string>;
}

export interface ParseResult {
  document: DocumentNode;
  diagnostics: Diagnostic[];
}

const MAP_TYPES = new Set(["battlemap", "hexcrawl", "region"]);
// Exported for the digest-completeness test: every known key must appear in
// the digest's "Header keys" list (#99) — agents learn the language from it.
export const KNOWN_HEADER_KEYS = new Set([
  "map", "kind", "chartdown", "id", "grid", "scale", "extent", "seed",
  "use", "theme", "labels", "legend", "scale-bar", "compass", "numbers",
  "levels", "level", "ground", "detail", "inset",
]);

/** Document kinds a `kind:` header may name — `map` is spelled by `map:` itself. */
export const DOCUMENT_KINDS = new Set(["vocabulary", "theme"]);

/**
 * Header keys whose value is a FORMAT rather than a value set.
 *
 * Each of these was consumed by a coercion with a silent fallback —
 * `Number(seed) || 0`, `measureToNumber(scale) || 5`, a regex on `extent:`
 * defaulting to 800x600, `parseFloat(chartdown)` compared against NaN. So a
 * malformed value produced a map built on a default the author never wrote,
 * and `check` said ok.
 *
 * The forward-compatibility argument is the decisive one (owner, #136): a
 * document that silently rides a default today is a document that BREAKS the
 * day the assumed grammar becomes real. If `seed: goldenrod` is ever made
 * legal by hashing the string, every map that quietly rendered at seed 0
 * changes its organic geometry at once — and the author never wrote anything
 * wrong enough to be told about it. Rejecting now keeps that door open.
 */
export const HEADER_FORMATS: Record<string, { re: RegExp; expected: string }> = {
  extent: { re: /^\d+x\d+[a-z]*$/, expected: "<width>x<height> with an optional unit, e.g. '900x600mi'" },
  seed: { re: /^-?\d+$/, expected: "a whole number, e.g. '3742'" },
  // Unit optional: grammar.ebnf defines `measure = number , [ unit ]`, so
  // `scale: 5` is grammar-legal and tightening it here would be a language
  // change smuggled in as a bug fix.
  scale: { re: /^\d+(\.\d+)?[a-z]*$/, expected: "a measure, e.g. '5ft' or '6mi'" },
  chartdown: { re: /^\d+(\.\d+)*$/, expected: "a spec version, e.g. '0.3'" },
};

const formatMessage = (key: string, value: string): string =>
  `'${key}: ${value}' is malformed — expected ${HEADER_FORMATS[key]!.expected} (spec 01 §2)`;

/**
 * Header keys whose value is a closed set, and therefore checkable.
 *
 * These all fed a bare equality test in the renderer (`=== "on"`), so every
 * near-miss an author would reasonably write — `legend: yes`, `compass: true`,
 * `numbers: ON` — silently turned the feature OFF, and `labels: dense` was
 * silently read as `names`. The document said one thing and rendered another
 * with nothing to say so.
 *
 * These are ERRORS, not warnings, matching `map:` and `kind:` — the language's
 * other closed header sets. Unlike vocabulary facets there is no open-vocabulary
 * argument here: the language defines every legal value, so an out-of-set one
 * cannot be an author extending the language and can only be a mistake.
 */
export const CLOSED_HEADER_VALUES: Record<string, Set<string>> = {
  labels: new Set(["names", "keyed", "none"]),
  detail: new Set(["overview", "reference"]),
  legend: new Set(["on", "off"]),
  "scale-bar": new Set(["on", "off"]),
  compass: new Set(["on", "off"]),
  numbers: new Set(["on", "off"]),
};
const UNIVERSAL_SECTIONS = new Set(["vocab", "gm", "labels"]);
const SECTIONS_BY_TYPE: Record<string, Set<string>> = {
  battlemap: new Set(["terrain", "structures", "features", "tokens"]),
  hexcrawl: new Set(["hexes", "routes", "regions"]),
  region: new Set(["water", "terrain", "paths", "settlements", "features", "realms"]),
};
// Bare words the LANGUAGE defines, as opposed to states a word declares
// (spec 01 §5, spec 06): these are never checked against states= (#108).
const RESERVED_FLAGS = new Set([
  "hidden", "nolabel", "difficult", "seen", "unexplored", "drop", "open", "sprawl", "raw",
]);

/**
 * A bare word should be a DECLARED state of the entity's word or an ancestor
 * (spec 04 §2, #108). Warning, not error: spec 04 §3's promise is that nothing
 * is blocked on defining, so an undeclared state still renders — but flags
 * were the one place a misspelling cost a rendered state and said nothing,
 * while spec 03 §5 and spec 02 §8.3 close exactly that hole everywhere else.
 *
 * `border` is exempt: ADR 0012 gives its predicate its own grammar — realm
 * names, compass words, `inner`, and states that are OPEN vocabulary by
 * decision. Checking it would warn on every border line in the corpus.
 */
function checkDeclaredStates(
  typeWord: string | null,
  flags: string[],
  vocabTable: VocabTable,
  line: number,
  diagnostics: Diagnostic[],
): void {
  if (typeWord === null || flags.length === 0) return;
  // Only DEFINED vocabulary is checked. Two reasons, both empirical:
  //  - an unknown word has no declared states to compare against, and spec 04
  //    §3 promises you can flag anything without defining it first;
  //  - a wall-state detail (`ruined : north east`, spec 06 §3) has the state
  //    as its SUBJECT and side words as its predicate — those are grammar,
  //    not states of `ruined`, and `ruined` is not vocabulary.
  if (vocabTable.archetypeOf(typeWord) === null) return;
  if (vocabTable.chain(typeWord).includes("border")) return;
  const declared = vocabTable.statesOf(typeWord);
  for (const flag of flags) {
    if (RESERVED_FLAGS.has(flag) || declared.has(flag)) continue;
    diagnostics.push(
      warning(line, `'${flag}' is not a declared state of '${typeWord}' — it still renders; declare it with states= to silence this (spec 04 §2)`),
    );
  }
}

/**
 * Reserved parameters, usable on any content line whatever the word is.
 *
 * Generic in the sense that they say something about the ENTITY rather than
 * about what kind of thing it is: where it sits, how big, what it links to,
 * what the GM knows. Everything else has to be earned from the vocabulary.
 */
const RESERVED_PAIRS = new Set([
  "gm", "link", "detail", "detail-at", "facing", "size", "side", "width",
  "light", "elevation", "key", "level", "to", "through", "at",
]);

/**
 * Warn on a `key=` no archetype, vocabulary word or section grammar can
 * consume (#195).
 *
 * An unknown pair used to be read, discarded and never mentioned, so a typo in
 * a KEY — unlike a typo in a value, which `checkFacetValues` catches — silently
 * lost whatever it was meant to say: `taepr=0.3` drew a wedge where a
 * parallel-sided inlet was asked for, and checked clean. It is the same hole
 * spec 01's closed value sets close for header keys, left open one level down.
 *
 * The set a word can consume is RESOLVED rather than listed. Vocabulary brings
 * its own facets — `fjord` earns `reach=` and `taper=` by derivation from
 * `bay` — and a field word makes its own name a parameter on any emitter
 * (spec 04 §5), so no static list could be right for a language whose whole
 * design is an open vocabulary.
 *
 * The exemptions are `checkDeclaredStates`' and for the same reasons: an
 * UNDEFINED word has no declared facets to compare against, and spec 04 §3
 * promises a word may be used without defining it first; `border` has its own
 * predicate grammar (ADR 0012). An `x-` prefix carries deliberate extension
 * data without argument, mirroring `[x-*]` sections.
 */
function checkPairKeys(
  typeWord: string | null,
  pairs: { key: string; value: string }[],
  vocabTable: VocabTable,
  line: number,
  diagnostics: Diagnostic[],
): void {
  if (typeWord === null || pairs.length === 0) return;
  if (vocabTable.archetypeOf(typeWord) === null) return;
  if (vocabTable.chain(typeWord).includes("border")) return;
  const facets = vocabTable.facetKeysOf(typeWord);
  const fields = vocabTable.fieldWords();
  // WHAT THE ARCHETYPE CAN CONSUME, not only what the word happens to declare.
  // `reach=` and `taper=` belong to placed morphology as such (spec 05 §4), and
  // the stdlib declares them only where it has a non-default to state — so
  // `bay` carries no `taper=` and `island` no `reach=`, while both accept one.
  // Read from `morph=` rather than from a list of words, so a derived word or
  // a document's own gets the same treatment.
  const morph = vocabTable.facetOf(typeWord, "morph");
  if (morph === "jut" || morph === "bite") {
    facets.add("reach");
    facets.add("taper");
  } else if (morph === "detached") {
    // On a detached feature `reach=` is ELONGATION, and there are no flanks to
    // converge, so `taper=` is genuinely not one of its parameters.
    facets.add("reach");
  }
  for (const pair of pairs) {
    if (RESERVED_PAIRS.has(pair.key) || facets.has(pair.key) || fields.has(pair.key)) continue;
    if (pair.key.startsWith("x-")) continue;
    diagnostics.push(
      warning(line, `'${pair.key}=' is not a parameter '${typeWord}' can use, so it is ignored — check the spelling, or give '${typeWord}' a ${pair.key}= facet in [vocab] (spec 04 §2)`),
    );
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface SymbolEntry {
  ids: string[];
  name: string | null;
  index: number;
  line: number;
}

class SymbolTable {
  readonly entries: SymbolEntry[] = [];
  private byId = new Map<string, SymbolEntry>();

  add(ids: string[], name: string | null, line: number, diagnostics: Diagnostic[]): void {
    const entry: SymbolEntry = { ids, name, index: this.entries.length, line };
    for (const id of ids) {
      const existing = this.byId.get(id);
      if (existing) {
        diagnostics.push(error(line, `duplicate explicit id '${id}' (first declared on line ${existing.line})`));
      } else {
        this.byId.set(id, entry);
      }
    }
    this.entries.push(entry);
  }

  /** Order-bounded resolution (spec 02 §8.1, spec 03 §2). Returns the entry or null with a diagnostic. */
  resolve(ref: Ref, line: number, diagnostics: Diagnostic[]): SymbolEntry | null {
    const bound = this.entries.length;
    if (ref.form === "id") {
      const entry = this.byId.get(ref.value);
      if (!entry) {
        diagnostics.push(error(line, `unresolved reference '${ref.value}' — no earlier entity has this id`));
        return null;
      }
      if (entry.index >= bound) {
        diagnostics.push(
          error(line, `forward reference '${ref.value}' (declared on line ${entry.line}) — references may only point to earlier declarations`),
        );
        return null;
      }
      return entry;
    }
    const matches = this.entries.filter((e) => e.name === ref.value);
    if (matches.length === 0) {
      diagnostics.push(error(line, `unresolved reference "${ref.value}" — no earlier entity has this display name`));
      return null;
    }
    if (matches.length > 1) {
      diagnostics.push(
        error(line, `ambiguous reference "${ref.value}" — matches entities on lines ${matches.map((m) => m.line).join(", ")}; give the intended one an explicit id`),
      );
      return null;
    }
    return matches[0]!;
  }

  /** Resolution without emitting diagnostics — used to classify [gm] lines. */
  tryResolve(ref: Ref): SymbolEntry | null {
    if (ref.form === "id") return this.byId.get(ref.value) ?? null;
    const matches = this.entries.filter((e) => e.name === ref.value);
    return matches.length === 1 ? matches[0]! : null;
  }
}

interface SubjectParts {
  typeWord: string | null;
  ids: string[];
  name: string | null;
}

function parseSubject(tokens: Token[], line: number, diagnostics: Diagnostic[]): SubjectParts {
  const parts: SubjectParts = { typeWord: null, ids: [], name: null };
  for (const t of tokens) {
    if (t.kind === "chunk") {
      if (parts.name !== null) {
        diagnostics.push(error(line, "subject words must precede the display name"));
        continue;
      }
      if (parts.typeWord === null) parts.typeWord = t.text;
      else parts.ids.push(t.text);
    } else if (t.kind === "string") {
      if (parts.name !== null) diagnostics.push(error(line, "a subject may carry only one display name"));
      else parts.name = t.value;
    } else {
      diagnostics.push(error(line, "unexpected token in subject"));
    }
  }
  return parts;
}

function splitAtColon(tokens: Token[], line: number, diagnostics: Diagnostic[]): { subject: Token[]; predicate: Token[] } | null {
  const idx = tokens.findIndex((t) => t.kind === "colon");
  if (idx === -1) {
    diagnostics.push(error(line, "expected 'subject : predicate'"));
    return null;
  }
  return { subject: tokens.slice(0, idx), predicate: tokens.slice(idx + 1) };
}

function parseGrid(value: string, line: number, diagnostics: Diagnostic[]): GridSpec | null {
  const words = value.split(/\s+/).filter(Boolean);
  const kind = words[0];
  const dims = /^(\d+)x(\d+)$/.exec(words[1] ?? "");
  if ((kind !== "square" && kind !== "hex") || !dims) {
    diagnostics.push(error(line, "malformed grid: expected 'square WxH' or 'hex WxH <pointy|flat> <odd-row|even-row|odd-col|even-col>'"));
    return null;
  }
  const spec: GridSpec = { kind, cols: Number(dims[1]!), rows: Number(dims[2]!) };
  if (kind === "hex") {
    const orientation = words[2];
    const parity = words[3];
    if (
      (orientation !== "pointy" && orientation !== "flat") ||
      (parity !== "odd-row" && parity !== "even-row" && parity !== "odd-col" && parity !== "even-col")
    ) {
      diagnostics.push(error(line, "hex grids must declare orientation (pointy|flat) and offset parity (odd-row|even-row|odd-col|even-col) — spec 02 §4"));
      return spec;
    }
    spec.orientation = orientation;
    spec.parity = parity;
  }
  return spec;
}

/**
 * Dead `[vocab]` declarations (#116, ADR 0022): a word this document defines
 * and then never spends.
 *
 * Spec 04 §3's "unknown words never fail" is about AUTHORING FREEDOM — an
 * author who never promised anything gets a sensible default. It has been read
 * as "a declaration that matches nothing never warns," which is a different
 * thing: a broken promise. `mountian : terrain` is a perfectly legal line that
 * styles, derives, and validates nothing, and the author finds out by reading
 * the render.
 *
 * Only the document's OWN words are checked. A `use:`-imported library exists
 * to offer more words than any one map spends, so silence is its normal
 * condition — the same reason a shared theme is exempt on the theme side.
 */
function reportDeadVocab(document: DocumentNode, diagnostics: Diagnostic[]): void {
  if (document.mapType === "") return; // a vocabulary document's words ARE its product
  const spent = new Set<string>();
  // Header keys AND values: a `field` word is spent by `light: dim`, and
  // `ground: heath` names a terrain word (spec 05 §2).
  for (const h of document.header) {
    spent.add(h.key);
    for (const word of h.value.split(/[\s,]+/)) if (word) spent.add(word);
  }
  const declared: VocabEntryNode[] = [];
  for (const section of document.sections) {
    for (const entry of section.entries) {
      if (entry.kind === "vocab-entry") {
        if (entry.source === "document") declared.push(entry);
        spent.add(entry.base); // derivation spends the parent word
        continue;
      }
      if (entry.kind !== "entity") continue;
      if (entry.typeWord) spent.add(entry.typeWord);
      for (const d of entry.details) if (d.typeWord) spent.add(d.typeWord);
      // Flags are open vocabulary (states), but a word declared as a state's
      // home is spent by carrying it — `volcano : peak states=erupting` is
      // spent by `volcano ... erupting`, which the typeWord above covers.
    }
  }
  for (const entry of declared) {
    if (spent.has(entry.word)) continue;
    diagnostics.push(
      warning(
        entry.line,
        `'${entry.word}' is declared here and never used — nothing in this document carries the word or derives from it (spec 04 §3)`,
      ),
    );
  }
}

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = splitLines(source);
  const vocab = new VocabTable();
  loadStdlib(vocab);
  const symbols = new SymbolTable();

  const document: DocumentNode = {
    kind: "document",
    title: null,
    docId: "document",
    mapType: "",
    header: [],
    grid: null,
    levels: [],
    defaultLevel: "",
    importedVocab: [],
    sections: [],
  };

  let i = 0;

  // Title (spec 01 §2.1)
  if (lines[i] && lines[i]!.text.startsWith("#")) {
    document.title = lines[i]!.text.replace(/^#+\s*/, "");
    i++;
  }

  // Header (spec 01 §2.2)
  let sawMap = false;
  let sawFirstHeader = false;
  let declaredKind: string | null = null;
  const deferredHeaderKeys: { key: string; line: number }[] = [];
  while (i < lines.length && !lines[i]!.text.startsWith("[")) {
    const raw = lines[i]!;
    const tokens = tokenize(raw.text, raw.line, diagnostics);
    const split = splitAtColon(tokens, raw.line, diagnostics);
    i++;
    if (!split) continue;
    const keyToken = split.subject[0];
    // A header subject is the key, optionally followed by ONE qualifier
    // token (spec 01 §2, #106): `light celebdil: daylight` scopes an ambient
    // to a level, the same shape `[structures upper]` already uses.
    const qualifierToken = split.subject[1];
    if (split.subject.length > 2 || keyToken?.kind !== "chunk" || (qualifierToken !== undefined && qualifierToken.kind !== "chunk")) {
      diagnostics.push(error(raw.line, "malformed header line — expected 'key: value' or 'key qualifier: value'"));
      continue;
    }
    const key = keyToken.text;
    const qualifier = qualifierToken !== undefined && qualifierToken.kind === "chunk" ? qualifierToken.text : undefined;
    const value = split.predicate
      .map((t) => (t.kind === "chunk" ? t.text : t.kind === "string" ? `"${t.value}"` : t.kind === "pair" ? `${t.key}=${t.value}` : ":"))
      .join(" ");
    document.header.push({ key, value, line: raw.line, ...(qualifier !== undefined ? { qualifier } : {}) } satisfies HeaderEntry);

    // The first header line is `map:` or `kind:` (spec 01 §2, #110) — one rule
    // covering all three document kinds, where two of them used to be defined
    // by what they LACKED and were therefore undecidable from the file alone.
    if (!sawFirstHeader) {
      if (key !== "map" && key !== "kind") {
        diagnostics.push(error(raw.line, "the first header line is 'map:' or 'kind:' (spec 01 §2)"));
      }
      sawFirstHeader = true;
    }
    if (key === "kind") {
      declaredKind = value;
      if (!DOCUMENT_KINDS.has(value)) {
        diagnostics.push(error(raw.line, `unknown document kind '${value}' — expected vocabulary or theme (a map is spelled by 'map:')`));
      }
      if (sawMap) diagnostics.push(error(raw.line, "a document declares 'map:' or 'kind:', never both (spec 01 §2)"));
      continue;
    }
    if (key === "map") {
      if (declaredKind !== null) {
        diagnostics.push(error(raw.line, "a document declares 'map:' or 'kind:', never both (spec 01 §2)"));
      }
      sawMap = true;
    }
    if (key === "map") {
      document.mapType = value;
      if (!MAP_TYPES.has(value) && !value.endsWith("-beta")) {
        diagnostics.push(error(raw.line, `unknown map type '${value}' — expected battlemap, hexcrawl, or region`));
      }
    } else if (key === "grid") {
      document.grid = parseGrid(value, raw.line, diagnostics);
    } else if (key === "chartdown") {
      // Spec 01: warn only when the document targets a NEWER spec than this
      // parser implements (render best-effort anyway); older targets are
      // this parser's own history and parse silently.
      if (!HEADER_FORMATS.chartdown!.re.test(value)) {
        diagnostics.push(error(raw.line, formatMessage("chartdown", value)));
      } else if (parseFloat(value) > parseFloat(SPEC_VERSION)) {
        diagnostics.push(warning(raw.line, `document targets spec ${value}; this parser implements ${SPEC_VERSION}`));
      }
    } else if (HEADER_FORMATS[key] !== undefined) {
      if (!HEADER_FORMATS[key]!.re.test(value)) {
        diagnostics.push(error(raw.line, formatMessage(key, value)));
      } else if (key === "extent" && /^0+x|x0+[a-z]*$/.test(value)) {
        diagnostics.push(error(raw.line, `'extent: ${value}' has a zero dimension — a map with no area renders nothing (spec 02 §5)`));
      }
    } else if (key === "use") {
      const lib = options.libraries?.[value];
      if (lib === undefined) {
        diagnostics.push(warning(raw.line, `library '${value}' not provided to the parser — its vocabulary is unavailable`));
      } else {
        document.importedVocab.push(...parseVocabDocument(lib, "library", vocab, diagnostics));
      }
    } else if (key === "id") {
      document.docId = value;
    } else if (key === "levels") {
      document.levels = value.split(/\s+/).filter(Boolean);
      if (document.levels.length < 2) diagnostics.push(error(raw.line, "levels: declares at least two levels, physical order topmost first (spec 06 §8)"));
    } else if (key === "level") {
      document.defaultLevel = value;
    } else if (CLOSED_HEADER_VALUES[key] !== undefined) {
      const allowed = CLOSED_HEADER_VALUES[key]!;
      if (!allowed.has(value)) {
        diagnostics.push(
          error(raw.line, `'${key}: ${value}' is not one of ${[...allowed].join(", ")} — the value is a closed set (spec 01 §2)`),
        );
      }
    } else if (!KNOWN_HEADER_KEYS.has(key)) {
      // Deferred: a field word declared in a later [vocab] section is a legal
      // ambient key (spec 04 §5), and the header is parsed before we know it.
      deferredHeaderKeys.push({ key, line: raw.line });
    }
  }
  // Deferred header-key validation (#106): a field word declared in a [vocab]
  // section below is a legal ambient key, and the header was parsed before the
  // vocabulary existed. Everything still unrecognized warns as it always did.
  const reportUnknownHeaderKeys = (): void => {
    for (const { key, line } of deferredHeaderKeys) {
      if (vocab.archetypeOf(key) === "field") continue;
      diagnostics.push(warning(line, `unknown header key '${key}'`));
    }
    // A field's ambient value is a state like any other (spec 04 §5, #127):
    // any value renders, a declared one is silent, a typo warns. Without this
    // the rule reached predicates but not headers — and an ambient is set once
    // and never looked at again, so `light: darkk` gave a silently lit dungeon.
    // `detail:` sets the render resolution of a GRIDLESS canvas (#139). A
    // battlemap or hexcrawl sizes itself from its grid, so the key is inert
    // there — and an inert key that parses clean is the failure this project
    // has spent a phase removing (#126, #131, #135, #136).
    for (const h of document.header) {
      if (h.key !== "detail" || document.mapType === "region") continue;
      diagnostics.push(
        warning(h.line, `'detail:' sets the render resolution of a gridless canvas and does nothing on a ${document.mapType} — its size comes from its grid (spec 02 §5)`),
      );
    }
    for (const h of document.header) {
      if (vocab.archetypeOf(h.key) !== "field") continue;
      const declared = vocab.statesOf(h.key);
      if (declared.size === 0 || declared.has(h.value)) continue;
      diagnostics.push(
        warning(h.line, `'${h.value}' is not a declared value of '${h.key}' — it still renders; declare it with states= to silence this (spec 04 §5)`),
      );
    }
  };

  // A declared non-map kind is a complete answer: vocabulary and theme
  // documents need no map: (spec 04 par.2, spec 08 par.1).
  if (!sawMap && declaredKind === null) {
    diagnostics.push(error(lines[0]?.line ?? 1, "missing required 'map:' header line"));
  }
  if (document.docId === "document" && document.title) document.docId = slugify(document.title);

  // Level defaults and validation (spec 06 §8).
  if (document.levels.length > 0) {
    if (document.defaultLevel === "") document.defaultLevel = document.levels[0]!;
    else if (!document.levels.includes(document.defaultLevel)) {
      diagnostics.push(error(document.header.find((h) => h.key === "level")?.line ?? 1, `default level '${document.defaultLevel}' is not declared in levels:`));
    }
  } else if (document.defaultLevel !== "") {
    diagnostics.push(error(document.header.find((h) => h.key === "level")?.line ?? 1, "level: requires a levels: declaration"));
  }
  const validLevel = (word: string): boolean => document.levels.includes(word);

  const knownSections = SECTIONS_BY_TYPE[document.mapType] ?? new Set<string>();

  // Sections
  let section: SectionNode | null = null;
  let skippingUnknown = false;
  let lastEntity: EntityNode | null = null;

  const finishSection = () => {
    if (section) document.sections.push(section);
    section = null;
    lastEntity = null;
  };

  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const sectionMatch = /^\[(.+)\]$/.exec(raw.text);
    if (sectionMatch) {
      finishSection();
      const words = sectionMatch[1]!.trim().split(/\s+/);
      const name = words[0]!;
      const qualifier = words[1] ?? null;
      if (words.length > 2) diagnostics.push(error(raw.line, "a section header takes at most one qualifier token (spec 01 §3)"));
      if (qualifier !== null) {
        if (document.levels.length === 0) {
          diagnostics.push(error(raw.line, `section qualifier '${qualifier}' requires a levels: declaration (spec 06 §8)`));
        } else if (!validLevel(qualifier)) {
          diagnostics.push(error(raw.line, `unknown level '${qualifier}' — declared levels: ${document.levels.join(" ")}`));
        }
      }
      const known = knownSections.has(name) || UNIVERSAL_SECTIONS.has(name);
      skippingUnknown = !known;
      if (!known && !name.startsWith("x-")) {
        diagnostics.push(warning(raw.line, `unknown section [${name}] — contents ignored`));
      }
      section = { kind: "section", name, level: qualifier, known, entries: [], line: raw.line };
      continue;
    }
    if (!section) {
      diagnostics.push(error(raw.line, "content before any [section]"));
      continue;
    }
    if (skippingUnknown) continue;

    switch (section.name) {
      case "vocab": {
        const entry = parseVocabLine(raw.text, raw.line, "document", diagnostics);
        if (entry) {
          vocab.add(entry, diagnostics);
          section.entries.push(entry satisfies VocabEntryNode);
        }
        break;
      }
      case "labels":
        parseLabelsLine(raw, section, symbols, vocab, diagnostics);
        break;
      case "gm":
        parseGmLine(raw, section, symbols, vocab, diagnostics);
        break;
      case "hexes": {
        const tokens = tokenize(raw.text, raw.line, diagnostics);
        if (tokens.some((t) => t.kind === "colon")) {
          // Grouped form (spec 02 §4): an ordinary entity line.
          lastEntity = parseEntityLine(raw, tokens, section, symbols, vocab, diagnostics, false);
        } else {
          parseHexLedgerLine(raw, tokens, section, symbols, diagnostics);
        }
        break;
      }
      default: {
        if (raw.indent > 0) {
          parseDetailLine(raw, lastEntity, vocab, diagnostics);
          break;
        }
        const tokens = tokenize(raw.text, raw.line, diagnostics);
        lastEntity = parseEntityLine(raw, tokens, section, symbols, vocab, diagnostics, false);
        break;
      }
    }
  }
  finishSection();

  reportUnknownHeaderKeys();
  reportDeadVocab(document, diagnostics);
  return { document, diagnostics };

  // ---------- line parsers ----------

  function parseEntityLine(
    raw: RawLine,
    tokens: Token[],
    into: SectionNode,
    table: SymbolTable,
    vocabTable: VocabTable,
    diags: Diagnostic[],
    gmOnly: boolean,
  ): EntityNode | null {
    const split = splitAtColon(tokens, raw.line, diags);
    if (!split) return null;
    const subject = parseSubject(split.subject, raw.line, diags);
    const predicate = parsePredicate(split.predicate, raw.line, diags);

    // Order-bounded reference validation happens against the table BEFORE this entity registers.
    for (const ref of predicate.refs) table.resolve(ref, raw.line, diags);

    let archetype: EntityNode["archetype"];
    let archetypeSource: EntityNode["archetypeSource"];
    const known = subject.typeWord ? vocabTable.archetypeOf(subject.typeWord) : null;
    if (known) {
      archetype = known;
      archetypeSource = "vocab";
    } else {
      const inferred = inferArchetype(predicate.placements, into.name);
      archetype = inferred.archetype;
      archetypeSource = inferred.source;
    }

    // One spelling for a staging zone (#121, ADR 0015): a token word with an
    // area placement used to render as one, which meant `party start : <range>`
    // and `start party : <range>` produced the same picture from different
    // words — and therefore different theme subjects. The token+range form is
    // gone and says so; a staging zone is the word `start` (or anything
    // deriving from it). gm-only range entities are unaffected: they resolve
    // to `feature`, not `token`.
    if (archetype === "token" && predicate.placements.some((p) => p.kind === "range")) {
      diags.push(
        error(
          raw.line,
          "a token takes a cell (use size= for a larger token); for a staging area use 'start' ('start party : <range>'), and for another kind of zone declare the word ('[vocab] watch : zone') (spec 06 §4)",
        ),
      );
    }

    // Level resolution and validation (spec 06 §8).
    const levelParam = predicate.pairs.find((p) => p.key === "level")?.value;
    const toParam = predicate.pairs.find((p) => p.key === "to")?.value;
    if (levelParam !== undefined && !validLevel(levelParam)) {
      diags.push(error(raw.line, document.levels.length === 0 ? "level= requires a levels: declaration (spec 06 §8)" : `unknown level '${levelParam}' — declared levels: ${document.levels.join(" ")}`));
    }
    // `to=` and `through=` may name a RANGE of levels (#112). A stair from the
    // Seventh Level to the Gates is one stair; writing it as four connectors
    // gave it four ids, four chances to typo a column, and nothing anywhere
    // saying they were the same flight.
    const throughParam = predicate.pairs.find((p) => p.key === "through")?.value;
    const checkLevelSpan = (key: string, value: string): void => {
      const parts = value.split("..");
      if (parts.length > 2) {
        diags.push(error(raw.line, `${key}= takes a level or a range of two — '${value}' (spec 06 §8)`));
        return;
      }
      for (const part of parts) {
        if (validLevel(part)) continue;
        diags.push(error(raw.line, document.levels.length === 0
          ? `${key}= requires a levels: declaration (spec 06 §8)`
          : `unknown level '${part}' — declared levels: ${document.levels.join(" ")}`));
      }
    };
    // `detail-at=` upgrades `detail=` from a pointer to a spatial relationship
    // (#109): it names the parent cell the sub-map's A1 sits on. Alone it is
    // meaningless, so it requires the pointer it anchors.
    const detailAt = predicate.pairs.find((p) => p.key === "detail-at")?.value;
    if (detailAt !== undefined) {
      if (predicate.pairs.find((p) => p.key === "detail") === undefined) {
        diags.push(error(raw.line, "'detail-at=' anchors a 'detail=' sub-map and needs one to anchor (spec 03 §4)"));
      }
      if (parseAddress(detailAt) === null) {
        diags.push(error(raw.line, `'detail-at=${detailAt}' names the parent cell the sub-map's A1 sits on, e.g. 'detail-at=CP12' (spec 03 §4)`));
      }
    }
    if (toParam !== undefined) checkLevelSpan("to", toParam);
    if (throughParam !== undefined) {
      checkLevelSpan("through", throughParam);
      if (toParam === undefined) {
        diags.push(error(raw.line, "'through=' names the levels a connector passes WITHOUT opening onto, so it needs a 'to=' saying where it does open (spec 06 §8)"));
      }
    }

    // A bare word should be a DECLARED state of the entity's word or an
    // ancestor (spec 04 §2, #108). Warning, not error: spec 04 §3's promise is
    // that nothing is blocked on defining, so an undeclared state still
    // renders — but flags were the one place a misspelling cost a rendered
    // state and said nothing, while spec 03 §5 and spec 02 §8.3 close exactly
    // that hole everywhere else.
    //
    // `border` is exempt: ADR 0012 gives its predicate its own grammar — realm
    // names, compass words, `inner`, and states that are OPEN vocabulary by
    // decision. Warning there would fire on every border line in the corpus.
    checkDeclaredStates(subject.typeWord, predicate.flags, vocabTable, raw.line, diags);
    checkFacetValues(predicate.pairs, raw.line, diags);
    checkPairKeys(subject.typeWord, predicate.pairs, vocabTable, raw.line, diags);

    const entity: EntityNode = {
      kind: "entity",
      section: into.name,
      typeWord: subject.typeWord,
      ids: subject.ids,
      name: subject.name,
      archetype,
      archetypeSource,
      placements: predicate.placements,
      flags: predicate.flags,
      pairs: predicate.pairs,
      texts: predicate.texts,
      details: [],
      gmOnly: gmOnly || predicate.flags.includes("hidden"),
      level: levelParam ?? into.level ?? document.defaultLevel,
      line: raw.line,
    };
    table.add(subject.ids, subject.name, raw.line, diags);
    into.entries.push(entity);
    return entity;
  }

  function parseDetailLine(raw: RawLine, parent: EntityNode | null, vocabTable: VocabTable, diags: Diagnostic[]): void {
    if (!parent) {
      diagnostics.push(error(raw.line, "detail line has no parent entity"));
      return;
    }
    if (parent.archetype !== "structure") {
      diags.push(error(raw.line, "detail lines are only defined beneath structure entities (spec 06 §3)"));
      return;
    }
    const tokens = tokenize(raw.text, raw.line, diags);
    const split = splitAtColon(tokens, raw.line, diags);
    if (!split) return;
    const subject = parseSubject(split.subject, raw.line, diags);
    const predicate = parsePredicate(split.predicate, raw.line, diags);
    // A BARRIER word in a detail slot REPLACES that side's perimeter with that
    // barrier (#130): `cave-in : east` is the spelling authors already reach
    // for, and it used to draw an ordinary wall and take no styling. Its
    // predicate is side words or edge tokens — the same grammar `ruined` uses,
    // where the state is the subject and the sides are the predicate — so the
    // side words are grammar here, not states of the barrier.
    if (subject.typeWord !== null && vocabTable.archetypeOf(subject.typeWord) === "barrier") {
      const sides = predicate.flags.filter((f) => !isCompass(f));
      const hasEdges = predicate.placements.some((p) => p.kind === "edge" || (p.kind === "relational" && p.form === "at" && p.target.kind === "edge"));
      if (sides.length > 0) {
        diags.push(
          error(
            raw.line,
            `'${subject.typeWord}' replaces a side of this structure, so its predicate is side words or edge tokens — '${sides[0]}' is neither (spec 06 §3)`,
          ),
        );
      } else if (predicate.flags.length === 0 && !hasEdges) {
        diags.push(
          error(
            raw.line,
            `'${subject.typeWord}' replaces a side of this structure — name which: a side word ('${subject.typeWord} : east') or edge tokens ('${subject.typeWord} : K4.e K5.e') (spec 06 §3)`,
          ),
        );
      }
    } else {
      // Openings and wall-states are usually DETAILS, so the same rule applies
      // here or the check would miss the case that motivated it (#108).
      checkDeclaredStates(subject.typeWord, predicate.flags, vocabTable, raw.line, diags);
    }
    checkFacetValues(predicate.pairs, raw.line, diags);
    checkPairKeys(subject.typeWord, predicate.pairs, vocabTable, raw.line, diags);

    const detail: DetailNode = {
      kind: "detail",
      typeWord: subject.typeWord,
      ids: subject.ids,
      name: subject.name,
      placements: predicate.placements,
      flags: predicate.flags,
      pairs: predicate.pairs,
      texts: predicate.texts,
      line: raw.line,
    };
    if (subject.ids.length > 0) symbols.add(subject.ids, subject.name, raw.line, diags);
    parent.details.push(detail);
  }

  function parseHexLedgerLine(
    raw: RawLine,
    tokens: Token[],
    into: SectionNode,
    table: SymbolTable,
    diags: Diagnostic[],
  ): void {
    const addresses: (Address | AddressRange)[] = [];
    let terrain: string | null = null;
    const contents: string[] = [];
    const flags: string[] = [];
    const pairs: Pair[] = [];
    let name: string | null = null;

    for (const t of tokens) {
      if (t.kind === "pair") {
        pairs.push({ key: t.key, value: t.value });
        continue;
      }
      if (t.kind === "string") {
        if (name !== null) diags.push(error(raw.line, "a hex line may carry only one display name"));
        else name = t.value;
        continue;
      }
      if (t.kind === "colon") continue; // unreachable; grouped form routed elsewhere
      const positional = parsePositional(t.text);
      if (positional && (positional.kind === "address" || positional.kind === "range")) {
        if (terrain !== null) {
          diags.push(error(raw.line, "hex addresses must precede the terrain word"));
          continue;
        }
        addresses.push(positional);
        continue;
      }
      if (RESERVED_FLAGS.has(t.text)) {
        flags.push(t.text);
        continue;
      }
      if (terrain === null) terrain = t.text;
      else contents.push(t.text);
    }

    if (addresses.length === 0 || terrain === null) {
      diags.push(error(raw.line, "malformed hex ledger line — expected '<address> <terrain> [contents] [\"Name\"]' (spec 05 §3)"));
      return;
    }
    const node: HexLineNode = { kind: "hex-line", addresses, terrain, contents, name, flags, pairs, line: raw.line };
    table.add([], name, raw.line, diags);
    into.entries.push(node);
  }

  function parseGmLine(
    raw: RawLine,
    into: SectionNode,
    table: SymbolTable,
    vocabTable: VocabTable,
    diags: Diagnostic[],
  ): void {
    const tokens = tokenize(raw.text, raw.line, diags);
    const split = splitAtColon(tokens, raw.line, diags);
    if (!split) return;

    // A single-token subject that resolves is an attachment (spec 03 §5).
    if (split.subject.length === 1) {
      const t = split.subject[0]!;
      const ref: Ref | null =
        t.kind === "chunk" ? { kind: "ref", form: "id", value: t.text }
        : t.kind === "string" ? { kind: "ref", form: "name", value: t.value }
        : null;
      if (ref && table.tryResolve(ref)) {
        const predicate = parsePredicate(split.predicate, raw.line, diags);
        if (predicate.placements.length > 0) {
          diags.push(error(raw.line, "a [gm] attachment must not contain a placement — repositioning from [gm] is an error (spec 03 §5)"));
        }
        for (const r of predicate.refs) table.resolve(r, raw.line, diags);
        const node: GmAttachmentNode = {
          kind: "gm-attachment",
          target: ref,
          texts: predicate.texts,
          pairs: predicate.pairs,
          flags: predicate.flags,
          line: raw.line,
        };
        into.entries.push(node);
        return;
      }
    }

    // Otherwise: a new GM-only entity — which requires a placement (anti-typo rule).
    const entity = parseEntityLine(raw, tokens, into, table, vocabTable, diags, true);
    if (entity && entity.placements.length === 0) {
      diags.push(
        error(raw.line, `[gm] line resolves no existing entity and declares no placement — a misspelled attachment target? (spec 03 §5)`),
      );
    }
  }

  function parseLabelsLine(
    raw: RawLine,
    into: SectionNode,
    table: SymbolTable,
    vocabTable: VocabTable,
    diags: Diagnostic[],
  ): void {
    const tokens = tokenize(raw.text, raw.line, diags);
    const split = splitAtColon(tokens, raw.line, diags);
    if (!split) return;

    // Free text requires the `note` type word — or ANY word deriving from it
    // through the vocabulary chain (#111, ADR 0016). Matching the literal word
    // stopped the escalation ladder at the door: `[vocab] waypoint : note` is a
    // textbook derivation, and rejecting it told authors the vocabulary system
    // did not apply here. The typo-loudness this rule protects is untouched —
    // `noet` still derives from nothing and is still an error.
    const first = split.subject[0];
    if (first?.kind === "chunk" && vocabTable.chain(first.text).includes("note")) {
      parseEntityLine(raw, tokens, into, table, vocabTable, diags, false);
      return;
    }

    if (split.subject.length !== 1) {
      diags.push(error(raw.line, "a [labels] override subject must be a single reference; free text requires the 'note' type word or a word deriving from it (spec 07 §2)"));
      return;
    }
    const t = split.subject[0]!;
    const ref: Ref | null =
      t.kind === "chunk" ? { kind: "ref", form: "id", value: t.text }
      : t.kind === "string" ? { kind: "ref", form: "name", value: t.value }
      : null;
    if (!ref) {
      diags.push(error(raw.line, "malformed [labels] subject"));
      return;
    }
    table.resolve(ref, raw.line, diags); // MUST resolve — typos are errors, not stray labels.

    const hint = parseLabelHint(split.predicate, raw.line, table, diags);
    if (!hint) return;
    const node: LabelOverrideNode = { kind: "label-override", target: ref, hint, line: raw.line };
    into.entries.push(node);
  }

  function parseLabelHint(tokens: Token[], line: number, table: SymbolTable, diags: Diagnostic[]): LabelHint | null {
    const first = tokens[0];
    if (first?.kind !== "chunk") {
      diags.push(error(line, "expected a label hint: sprawl | along | at | <compass> (spec 07 §2)"));
      return null;
    }
    if (first.text === "sprawl") {
      const arg = tokens[1]?.kind === "chunk" ? parsePositional(tokens[1].text) : null;
      if (arg?.kind === "range" || arg?.kind === "point-range") return { kind: "sprawl", range: arg };
      diags.push(error(line, "sprawl requires a cell range or point range"));
      return null;
    }
    if (first.text === "along") {
      const t = tokens[1];
      const ref: Ref | null =
        t?.kind === "chunk" ? { kind: "ref", form: "id", value: t.text }
        : t?.kind === "string" ? { kind: "ref", form: "name", value: t.value }
        : null;
      if (!ref) {
        diags.push(error(line, "along requires a reference"));
        return null;
      }
      table.resolve(ref, line, diags);
      return { kind: "along", ref };
    }
    if (first.text === "at") {
      const arg = tokens[1]?.kind === "chunk" ? parsePositional(tokens[1].text) : null;
      if (arg?.kind === "point" || arg?.kind === "address") return { kind: "at", target: arg };
      diags.push(error(line, "at requires a point or cell"));
      return null;
    }
    if (isCompass(first.text)) return { kind: "side", compass: first.text };
    diags.push(error(line, `unknown label hint '${first.text}' — expected sprawl | along | at | <compass>`));
    return null;
  }
}
