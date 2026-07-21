/** Flattens a parsed document into render-ready collections, honoring render mode. */

import type {
  DocumentNode,
  EntityNode,
  GmAttachmentNode,
  HexLineNode,
  LabelOverrideNode,
  Pair,
  Ref,
} from "@chartdown/core";
import { loadStdlib, slugify, VocabTable, type Diagnostic } from "@chartdown/core";
import type { Theme } from "./theme";

export type RenderMode = "player" | "gm";

export interface Model {
  doc: DocumentNode;
  mode: RenderMode;
  entities: EntityNode[];
  hexLines: HexLineNode[];
  labelOverrides: LabelOverrideNode[];
  /** gm notes attached by reference, keyed by resolved anchor id (or display name slug). */
  gmNotes: Map<string, string[]>;
  header: Map<string, string>;
  seed: number;
  theme: Theme;
  /** `labels:` header (spec 07 §3): derived labels render only in "names" mode. */
  labelsMode: "names" | "none";
  /**
   * Theme fallback chain for a word (spec 04 §4): the word, then its
   * derivation bases — a theme lookup walks it until a word it knows.
   * Built from the standard library plus the document's [vocab] entries.
   * (`use:` library vocab is resolved by the parser for archetypes; theme
   * chains for library-defined derivations are a known gap until #20.)
   */
  chainOf(word: string | null): string[];
}

export const pairOf = (pairs: Pair[], key: string): string | undefined =>
  pairs.find((p) => p.key === key)?.value;

/** Entity anchor id per spec 03 §3: explicit id, else display-name slug; null if anonymous. */
export function entityAnchor(e: { ids: string[]; name: string | null }): string | null {
  if (e.ids.length > 0) return e.ids[0]!;
  if (e.name) return slugify(e.name);
  return null;
}

export function buildModel(doc: DocumentNode, mode: RenderMode, theme: Theme): Model {
  const entities: EntityNode[] = [];
  const hexLines: HexLineNode[] = [];
  const labelOverrides: LabelOverrideNode[] = [];
  const gmNotes = new Map<string, string[]>();

  const refKey = (ref: Ref): string => (ref.form === "id" ? ref.value : slugify(ref.value));

  for (const section of doc.sections) {
    for (const entry of section.entries) {
      switch (entry.kind) {
        case "entity": {
          if (mode === "player" && (entry.gmOnly || entry.flags.includes("hidden"))) break;
          entities.push(entry);
          break;
        }
        case "hex-line":
          hexLines.push(entry);
          break;
        case "label-override":
          labelOverrides.push(entry);
          break;
        case "gm-attachment": {
          if (mode === "gm") {
            const attachment: GmAttachmentNode = entry;
            const key = refKey(attachment.target);
            const notes = gmNotes.get(key) ?? [];
            notes.push(...attachment.texts, ...attachment.pairs.filter((p) => p.key === "gm").map((p) => p.value));
            gmNotes.set(key, notes);
          }
          break;
        }
        case "vocab-entry":
          break;
      }
    }
  }

  const header = new Map(doc.header.map((h) => [h.key, h.value]));
  const seed = Number(header.get("seed") ?? 0) || 0;

  const vocab = new VocabTable();
  loadStdlib(vocab);
  const scratch: Diagnostic[] = [];
  for (const section of doc.sections) {
    for (const entry of section.entries) {
      if (entry.kind === "vocab-entry") vocab.add(entry, scratch);
    }
  }
  const chainOf = (word: string | null): string[] => (word ? vocab.chain(word) : []);

  const labelsMode: "names" | "none" = header.get("labels") === "none" ? "none" : "names";
  return { doc, mode, entities, hexLines, labelOverrides, gmNotes, header, seed, theme, labelsMode, chainOf };
}

/** Derived-label gate (spec 07 §3): `labels: none` silences everything except `note` free text. */
export function labelsOn(model: Model, e?: { typeWord?: string | null }): boolean {
  return model.labelsMode !== "none" || e?.typeWord === "note";
}

export const anchorAttr = (model: Model, e: { ids: string[]; name: string | null }): string | undefined => {
  const anchor = entityAnchor(e);
  return anchor ? `cd-${model.doc.docId}-${anchor}` : undefined;
};

/** A gm= pair on the entity itself, plus attached [gm] notes — GM mode only. */
export function gmTitleFor(model: Model, e: EntityNode): string | null {
  if (model.mode !== "gm") return null;
  const parts: string[] = [];
  const own = pairOf(e.pairs, "gm");
  if (own) parts.push(own);
  if (e.gmOnly) parts.push(...e.texts);
  const anchor = entityAnchor(e);
  if (anchor) parts.push(...(model.gmNotes.get(anchor) ?? []));
  return parts.length ? parts.join(" ") : null;
}
