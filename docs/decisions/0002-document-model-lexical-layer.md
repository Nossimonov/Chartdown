# 0002 — One line grammar, `;` comments, `key=value` properties; embedded and standalone documents are identical

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #13 (spawned from #7)

## Context

Every later syntax proposal needs a lexical layer to be written against, and the three aspirational examples had begun to diverge: four property forms (`(difficult)`, bare `hidden`, `width 2`, `light 20 ft`), an ambiguity the project owner caught in review (`wagon (overturned)` — name or state?), and an undecided comment character. Separately, the prior-art survey established that embedding is the product (Mermaid beat PlantUML on frictionless fenced-block rendering), which constrains how standalone and embedded documents may relate.

## Decision

Spec section [01-document-model.md](../spec/01-document-model.md), summarized:

- Standalone `.cd` files and ` ```chartdown ` fenced blocks are **byte-identical** document forms; no embedded dialect.
- Skeleton: optional `# Title` (first line only) → header (`map:` required and first; `-beta` suffix convention for experimental map types) → `[sections]`, where the section determines line grammar. Unknown header keys/sections warn and are ignored; `x-`-prefixed sections are the silent extension namespace.
- Comments are `;` to end of line; quoted strings protect it.
- **One line grammar**: `subject : predicate` for header and content alike; per-section colon-less shorthand only where the spec itself defines it (the hexcrawl ledger).
- **One property form**: bare word = flag, `key=value` = parameter, quoted = display name (subject) or text (predicate). **Parentheses are removed from the language.**
- GM/player split reserved at the document level: `[gm]` sections, `gm=` parameters, `hidden` flag; `player` render mode is the default and fail-closed.
- Optional `chartdown:` header key pins the targeted spec version.

## Alternatives considered

- **Mermaid-style first-token dispatch** (`chartdown battlemap`) — redundant inside a fence; `map:` reads as data and behaves identically in both document forms.
- **`#` comments** — one sigil with two meanings once the title exists; **`//`** — heavier, no heritage claim. `;` matches the INI family the `[section]` syntax already evokes.
- **YAML frontmatter header** — ceremony disproportionate to 3–5 keys; revisit only if config sprawls (Mermaid's own trajectory).
- **`key: value` properties** — collides with the line separator.
- **Keeping parentheticals** — preserves a proven ambiguity in a language whose premise is unambiguous plain text.

## Consequences

- All three examples re-rendered to canonical form (same commit); future proposals write examples against one lexical layer, and #12's formal grammar has a stable target (§9's EBNF sketch is its seed).
- The battlemap's pseudo-English relations (`on river at`, `crossing`) did not survive canonicalization — dropped rather than frozen prematurely; region-map relational placements remain #8's open question.
- Detail lines (indented sub-lines under `building`) are **provisional** — admitted because the example needs them, owned by the battlemap-primitives section, and may be revised there.
- `;` comments and `=` in values mean those characters are reserved outside quotes; any future syntax wanting them must quote.
