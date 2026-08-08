/**
 * Vocabulary machinery (spec 04): the embedded standard library (spec 05/06,
 * itself a Chartdown vocabulary document — dogfooding), shadowing order
 * (stdlib < use: libraries < document), derivation-chain resolution with
 * cycle detection, and archetype inference for unknown words.
 */

import type { Pair, Placement, VocabEntryNode } from "./ast";
import { error, warning, type Diagnostic } from "./diagnostics";
import { splitLines, tokenize } from "./lex";

/**
 * Facets with a CLOSED value set (spec 04 §1). Unlike `side=`, which feeds
 * themes and degrades to a default colour, these feed the normative UVTT
 * transform (spec 06 §9), where an unknown value has no safe degradation —
 * and silently mapped to a shut portal, so `passes=opne` produced a locked
 * door in the VTT with nothing to say so (#126).
 */
export const CLOSED_FACETS: Record<string, Set<string>> = {
  passes: new Set(["open", "closed", "none"]),
  sight: new Set(["all", "none"]),
  // How a placed morphology feature relates to the line it sits on (spec 05
  // §4, ADR 0023). The WORD says what a thing is and how it is coloured; this
  // says what its geometry does to the host — so `bay` and `cove` both bite,
  // and `island` and `oxbow` are both detached while being land and water.
  morph: new Set(["jut", "bite", "detached"]),
};

/**
 * Is this value one the facet accepts? Open facets accept anything.
 *
 * Resolution and validation MUST agree on this predicate. They did not (#131):
 * `checkFacetValues` warned that "the vocabulary default applies" while the
 * renderer passed the bad value straight through to a `!== "open"` test, so a
 * typo exported a SHUT portal — the exact conformance failure #126 was filed
 * about, now wearing a warning that said it had been handled.
 */
export const facetAccepts = (key: string, value: string): boolean =>
  CLOSED_FACETS[key]?.has(value) ?? true;

/** Warn on a value outside a closed facet set; the facet default then applies. */
export function checkFacetValues(
  pairs: { key: string; value: string }[],
  line: number,
  diagnostics: Diagnostic[],
): void {
  for (const p of pairs) {
    const allowed = CLOSED_FACETS[p.key];
    if (!allowed || allowed.has(p.value)) continue;
    diagnostics.push(
      warning(line, `'${p.key}=${p.value}' is not one of ${[...allowed].join(", ")} — the vocabulary default applies (spec 04 §1)`),
    );
  }
}

export const ARCHETYPES = new Set([
  "terrain", "path", "feature", "structure", "barrier",
  "opening", "token", "zone", "field",
]);

/**
 * The facets each archetype gives a word **whether or not the word states a
 * default** — spec 04 §1's table, which §2 makes normative for what a `key=`
 * may be: "a facet its archetype gives it whether or not the word states a
 * default".
 *
 * That clause was unimplemented (#267). Consumable keys were resolved from
 * DECLARED facets alone, so a word bound straight to an archetype inherited
 * nothing — `[vocab] hatch : opening` then `hatch : at A1.w sight=all` warned
 * that `sight=` was not a parameter `hatch` could use, citing the very section
 * that grants it. The standard library hid it: `door` and `window` declare
 * `passes=`/`sight=` themselves and so never exercised the clause. It showed on
 * its own words the moment one of them left a facet at the default — `pillar`
 * declares neither and could take neither, and `fence` declares `sight=` and
 * could not take `passes=`.
 *
 * Mirrors §1 exactly rather than listing only the gaps. Four of these keys are
 * also reserved generic parameters usable on any line (spec 01 §5) and would be
 * accepted without this table; they are here so the table can be read against
 * the spec section it encodes, instead of against that section minus another
 * list somewhere else.
 */
export const ARCHETYPE_FACETS: Record<string, readonly string[]> = {
  terrain: [],                      // `difficult` is a STATE, not a facet
  path: ["width"],
  feature: ["facing"],
  structure: [],
  barrier: ["passes", "sight"],
  opening: ["passes", "sight"],
  token: ["size", "side"],
  zone: [],
  field: ["occluded"],
};

/** The shipped standard library — normative content of specs 05 §1 and 06 §2. */
export const STDLIB_SOURCE = `# Chartdown Standard Library

[vocab]
; terrain (spec 05)
sea : terrain
lake : terrain
plains : terrain
grassland : terrain
farmland : terrain
forest : terrain
jungle : terrain
hills : terrain
mountains : terrain
peak : terrain
volcano : peak states=dormant,erupting
marsh : terrain states=difficult
desert : terrain
dunes : desert
snowfield : terrain
tundra : terrain
wasteland : terrain

; linear features
river : path
stream : river width=1
road : path
trail : road
canal : river
pass : path
coastline : path

; placed morphology (spec 05 §4, ADR 0023) — discrete features ON a line, each
; a real addressable entity rather than generated noise. \`morph=\` says what the
; geometry does to the host line; the word says what the thing IS, which is what
; a theme colours, so a bite can be water and a jut can be land. \`reach=\` is
; depth as a multiple of mouth width and \`taper=\` is how much of the mouth is
; spent narrowing — calibrated against Puget Sound (#161), where the measured
; ratios run from Point No Point at 0.33 to Hood Canal at 27.
cape : terrain morph=jut reach=0.55
headland : cape
peninsula : cape reach=1.6
spit : cape reach=5 taper=0.5
bay : terrain morph=bite reach=1
cove : bay reach=3 taper=0.7
sound : bay reach=6 taper=0.4
fjord : sound reach=20 taper=0.15
island : terrain morph=detached
islet : island
atoll : island
oxbow : terrain morph=detached

; crossings
ford : feature states=difficult
bridge : feature

; settlements
settlement : feature
capital : settlement
city : settlement
town : settlement
village : settlement
hamlet : village

; sites
keep : feature
castle : keep
tower : feature
ruin : feature
dungeon : feature
lair : feature
camp : feature
mine : feature
shrine : feature
temple : shrine
port : feature
cave : feature
landmark : feature

; zones
realm : zone
region : zone
border : zone

; annotation (spec 07)
note : feature

; battlemap (spec 06)
building : structure states=ruined
wall : barrier states=ruined
fence : barrier sight=all
pillar : barrier
door : opening passes=closed sight=none states=locked,barred,stuck,ruined
gate : door
window : opening passes=none sight=all
arrow-slit : window
stairs : feature
mud : terrain states=difficult
sand : terrain
grass : terrain
snow : terrain
ice : terrain states=difficult
water : terrain states=difficult
rubble : terrain states=difficult
ramp : feature
slope : terrain
earth : terrain
terrace : terrain
roof : terrain
air : terrain
void : air
wagon : feature states=overturned
crates : feature
barrel : feature
chest : feature
table : feature
altar : feature
statue : feature
well : feature
boulder : feature
tree : feature
pit : feature states=difficult
campfire : feature light=20ft
torch : feature light=20ft
lantern : feature light=15ft
brazier : feature light=20ft
start : zone

; fields — emanate from sources over an ambient baseline (spec 04 §6)
light : field states=dark,dim,daylight,moonlight
`;

export class VocabTable {
  private entries = new Map<string, VocabEntryNode>();

  add(entry: VocabEntryNode, diagnostics: Diagnostic[]): void {
    // Shadowing later-over-earlier is deliberate and silent (spec 04 §2) —
    // but a derivation must resolve at definition time, cycle-free.
    if (!entry.baseIsArchetype) {
      const seen = new Set<string>([entry.word]);
      let base: string | undefined = entry.base;
      while (base !== undefined && !ARCHETYPES.has(base)) {
        if (seen.has(base)) {
          diagnostics.push(error(entry.line, `vocabulary cycle: '${entry.word}' derives (transitively) from itself`));
          return;
        }
        seen.add(base);
        const next: VocabEntryNode | undefined = this.entries.get(base);
        if (!next) {
          diagnostics.push(
            error(entry.line, `'${entry.word}' derives from unknown word '${base}' — derivation bases must already exist (stdlib, use: library, or an earlier [vocab] line)`),
          );
          return;
        }
        base = next.baseIsArchetype ? undefined : next.base;
      }
    }
    this.entries.set(entry.word, entry);
  }

  /** Resolve a word to its archetype through the derivation chain, or null if unknown. */
  archetypeOf(word: string): string | null {
    let current = this.entries.get(word);
    while (current) {
      if (current.baseIsArchetype) return current.base;
      current = this.entries.get(current.base);
    }
    return null;
  }

  /**
   * The derivation chain for theme fallback (spec 04 §4): the word itself,
   * then each base word, ending before the archetype. `licorice-forest` →
   * ["licorice-forest", "forest"] — a theme walks it until a word it knows.
   */
  chain(word: string): string[] {
    const out: string[] = [word];
    let current = this.entries.get(word);
    while (current && !current.baseIsArchetype) {
      out.push(current.base);
      current = this.entries.get(current.base);
    }
    return out;
  }

  has(word: string): boolean {
    return this.entries.has(word);
  }

  /**
   * Declared states for a word, **unioned along the derivation chain** (spec
   * 04 §2): `hovercart : wagon states=parked` is parked OR overturned, because
   * derivation carries states exactly as it carries facets (ADR 0016).
   */
  statesOf(word: string): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    let current = this.entries.get(word);
    while (current && !seen.has(current.word)) {
      seen.add(current.word);
      const declared = current.pairs.find((p) => p.key === "states")?.value;
      if (declared) for (const s of declared.split(",").map((v) => v.trim()).filter(Boolean)) out.add(s);
      if (current.baseIsArchetype) break;
      current = this.entries.get(current.base);
    }
    return out;
  }

  /**
   * First facet pair for `key` along the derivation chain — vocabulary facets
   * are overridable defaults (spec 06 §2: `campfire : feature light=20ft`
   * means every campfire glows unless the entity says otherwise).
   */
  /**
   * Every facet key a word declares, unioned along its derivation chain (#195).
   *
   * The set a pair may legitimately override. Unioned rather than resolved,
   * because `fjord : sound reach=20 taper=0.15` inherits `morph=` from `bay`
   * without restating it, and an entity may override any of the three.
   */
  facetKeysOf(word: string): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    let current = this.entries.get(word);
    while (current && !seen.has(current.word)) {
      seen.add(current.word);
      for (const pair of current.pairs) out.add(pair.key);
      if (current.baseIsArchetype) break;
      current = this.entries.get(current.base);
    }
    return out;
  }

  /**
   * Words that are FIELDS, whose name is itself a parameter (spec 04 §5).
   *
   * Declaring `radiation : field` is what makes `radiation=40ft` mean something
   * on an emitter — the parameter namespace is derived from the vocabulary
   * rather than fixed, so it cannot be checked against a static list.
   */
  fieldWords(): Set<string> {
    const out = new Set<string>();
    for (const word of this.entries.keys()) {
      if (this.archetypeOf(word) === "field") out.add(word);
    }
    return out;
  }

  /**
   * A word's facet value, walking the derivation chain (spec 04 §2).
   *
   * A value outside a closed set is SKIPPED rather than returned, so the walk
   * continues to the next word up (#131). That is what "the vocabulary default
   * applies" has to mean on a chain: for `mydoor : door passes=bogus`, the
   * default is `door`'s `closed`, not the archetype's `open` — dropping all
   * the way to the built-in would silently reopen every derived door.
   */
  facetOf(word: string, key: string): string | undefined {
    let current = this.entries.get(word);
    while (current) {
      const pair = current.pairs.find((p) => p.key === key);
      if (pair && facetAccepts(key, pair.value)) return pair.value;
      if (current.baseIsArchetype) return undefined;
      current = this.entries.get(current.base);
    }
    return undefined;
  }
}

/** Parse one `[vocab]` line: `word : (archetype | word) [pairs/flags]`. */
export function parseVocabLine(
  text: string,
  line: number,
  source: VocabEntryNode["source"],
  diagnostics: Diagnostic[],
): VocabEntryNode | null {
  const tokens = tokenize(text, line, diagnostics);
  const [first, second, third] = [tokens[0], tokens[1], tokens[2]];
  if (first?.kind !== "chunk" || second?.kind !== "colon" || third?.kind !== "chunk") {
    diagnostics.push(error(line, "malformed [vocab] line — expected 'word : archetype-or-word'"));
    return null;
  }
  const pairs: Pair[] = [];
  const flags: string[] = [];
  for (const t of tokens.slice(3)) {
    if (t.kind === "pair") pairs.push({ key: t.key, value: t.value });
    else if (t.kind === "chunk") flags.push(t.text);
    else diagnostics.push(error(line, "unexpected token in [vocab] line"));
  }
  checkFacetValues(pairs, line, diagnostics);
  return {
    kind: "vocab-entry",
    word: first.text,
    base: third.text,
    baseIsArchetype: ARCHETYPES.has(third.text),
    pairs,
    flags,
    source,
    line,
  };
}

/**
 * Parse a vocabulary document — an ordinary Chartdown document containing only
 * `[vocab]` sections; `map:` is not required (spec 04 §2). Non-vocab content warns.
 */
/**
 * Parse a vocabulary document into `table`, returning the entries it added so
 * callers can carry them onward. The document must carry its imported
 * vocabulary (#101): a consumer that rebuilds the table from the AST alone
 * would otherwise get a SHORTER chain than the parser used, and theme lookups
 * — which walk that chain (spec 04 §4) — would silently stop resolving.
 */
export function parseVocabDocument(
  source: string,
  origin: VocabEntryNode["source"],
  table: VocabTable,
  diagnostics: Diagnostic[],
): VocabEntryNode[] {
  const added: VocabEntryNode[] = [];
  let inVocab = false;
  for (const raw of splitLines(source)) {
    if (raw.text.startsWith("#")) continue;
    const sectionMatch = /^\[(.+)\]$/.exec(raw.text);
    if (sectionMatch) {
      inVocab = sectionMatch[1] === "vocab";
      if (!inVocab) diagnostics.push(warning(raw.line, `vocabulary document: ignoring non-vocab section [${sectionMatch[1]}]`));
      continue;
    }
    if (!inVocab) continue;
    const entry = parseVocabLine(raw.text, raw.line, origin, diagnostics);
    if (entry) {
      table.add(entry, diagnostics);
      added.push(entry);
    }
  }
  return added;
}

export function loadStdlib(table: VocabTable): void {
  const scratch: Diagnostic[] = [];
  parseVocabDocument(STDLIB_SOURCE, "stdlib", table, scratch);
  // The stdlib must be internally valid; a diagnostic here is an implementation bug.
  if (scratch.some((d) => d.severity === "error")) {
    throw new Error(`@chartdown/core: standard library failed to parse: ${scratch[0]!.message}`);
  }
}

const SECTION_ARCHETYPE: Record<string, string> = {
  terrain: "terrain",
  water: "terrain",
  paths: "path",
  routes: "path",
  structures: "structure",
  features: "feature",
  settlements: "feature",
  tokens: "token",
  realms: "zone",
  regions: "zone",
};

/**
 * Usage inference for unknown words (spec 04 §3, as amended by #21/#22 errata):
 * explicit shape/path phrases are the strongest signal; the section the author
 * filed the entity under comes next; the lone point/cell rule applies only in
 * sections that carry no archetype (a solo creature in [tokens] stays a token).
 */
export function inferArchetype(
  placements: Placement[],
  section: string,
): { archetype: string; source: "inferred-shape" | "inferred-section" | "default" } {
  for (const p of placements) {
    if (p.kind === "shape") {
      return {
        archetype: p.shape === "area" || p.shape === "blob" ? "terrain" : "path",
        source: "inferred-shape",
      };
    }
    if (p.kind === "relational" && p.form === "from-to") {
      return { archetype: "path", source: "inferred-shape" };
    }
  }
  const bySection = SECTION_ARCHETYPE[section];
  if (bySection) return { archetype: bySection, source: "inferred-section" };
  if (placements.length === 1 && (placements[0]!.kind === "point" || placements[0]!.kind === "address")) {
    return { archetype: "feature", source: "inferred-shape" };
  }
  return { archetype: "feature", source: "default" };
}
