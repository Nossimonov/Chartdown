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
import { isCompass, parsePositional, parsePredicate } from "./placements";
import { inferArchetype, loadStdlib, parseVocabDocument, parseVocabLine, VocabTable } from "./vocab";

// The spec and the packages version together (see CHANGELOG): a release's
// major.minor IS the spec version its documents may target.
export const SPEC_VERSION = "0.3";

export interface ParseOptions {
  /** Sources for `use:` libraries, keyed by the exact `use:` value. */
  libraries?: Record<string, string>;
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
  "levels", "level", "ground",
]);

/** Document kinds a `kind:` header may name — `map` is spelled by `map:` itself. */
export const DOCUMENT_KINDS = new Set(["vocabulary", "theme"]);
const UNIVERSAL_SECTIONS = new Set(["vocab", "gm", "labels"]);
const SECTIONS_BY_TYPE: Record<string, Set<string>> = {
  battlemap: new Set(["terrain", "structures", "features", "tokens"]),
  hexcrawl: new Set(["hexes", "routes", "regions"]),
  region: new Set(["water", "terrain", "paths", "settlements", "features", "realms"]),
};
// Bare words the LANGUAGE defines, as opposed to states a word declares
// (spec 01 §5, spec 06): these are never checked against states= (#108).
const RESERVED_FLAGS = new Set([
  "hidden", "nolabel", "difficult", "seen", "unexplored", "drop", "open", "sprawl",
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
  while (i < lines.length && !lines[i]!.text.startsWith("[")) {
    const raw = lines[i]!;
    const tokens = tokenize(raw.text, raw.line, diagnostics);
    const split = splitAtColon(tokens, raw.line, diagnostics);
    i++;
    if (!split) continue;
    const keyToken = split.subject[0];
    if (split.subject.length !== 1 || keyToken?.kind !== "chunk") {
      diagnostics.push(error(raw.line, "malformed header line — expected 'key: value'"));
      continue;
    }
    const key = keyToken.text;
    const value = split.predicate
      .map((t) => (t.kind === "chunk" ? t.text : t.kind === "string" ? `"${t.value}"` : t.kind === "pair" ? `${t.key}=${t.value}` : ":"))
      .join(" ");
    document.header.push({ key, value, line: raw.line } satisfies HeaderEntry);

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
      if (parseFloat(value) > parseFloat(SPEC_VERSION)) {
        diagnostics.push(warning(raw.line, `document targets spec ${value}; this parser implements ${SPEC_VERSION}`));
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
    } else if (!KNOWN_HEADER_KEYS.has(key)) {
      diagnostics.push(warning(raw.line, `unknown header key '${key}'`));
    }
  }
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
    if (toParam !== undefined && !validLevel(toParam)) {
      diags.push(error(raw.line, document.levels.length === 0 ? "to= requires a levels: declaration (spec 06 §8)" : `unknown level '${toParam}' — declared levels: ${document.levels.join(" ")}`));
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
    // Openings and wall-states are usually DETAILS, so the same rule applies
    // here or the check would miss the case that motivated it (#108).
    checkDeclaredStates(subject.typeWord, predicate.flags, vocabTable, raw.line, diags);

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
