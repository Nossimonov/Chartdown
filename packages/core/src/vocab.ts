/**
 * Vocabulary machinery (spec 04): the embedded standard library (spec 05/06,
 * itself a Chartdown vocabulary document — dogfooding), shadowing order
 * (stdlib < use: libraries < document), derivation-chain resolution with
 * cycle detection, and archetype inference for unknown words.
 */

import type { Pair, Placement, VocabEntryNode } from "./ast";
import { error, warning, type Diagnostic } from "./diagnostics";
import { splitLines, tokenize } from "./lex";

export const ARCHETYPES = new Set([
  "terrain", "path", "feature", "structure", "barrier",
  "opening", "token", "zone", "light",
]);

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
border : path

; annotation (spec 07)
note : feature

; battlemap (spec 06)
building : structure states=ruined
wall : barrier states=ruined
fence : barrier sight=all
pillar : barrier
door : opening passes=closed sight=none
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

  has(word: string): boolean {
    return this.entries.has(word);
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
export function parseVocabDocument(
  source: string,
  origin: VocabEntryNode["source"],
  table: VocabTable,
  diagnostics: Diagnostic[],
): void {
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
    if (entry) table.add(entry, diagnostics);
  }
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

/** Usage inference for unknown words (spec 04 §3, as amended by #21's errata). */
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
  if (placements.length === 1 && (placements[0]!.kind === "point" || placements[0]!.kind === "address")) {
    return { archetype: "feature", source: "inferred-shape" };
  }
  const bySection = SECTION_ARCHETYPE[section];
  if (bySection) return { archetype: bySection, source: "inferred-section" };
  return { archetype: "feature", source: "default" };
}
