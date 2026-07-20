# 01 — Document Model

**Status: Draft** (accepted from proposal [#13](https://github.com/Nossimonov/Chartdown/issues/13); "Draft" until spec v0.1 ships as a whole). Defines the document skeleton and lexical layer. Placement grammar (§02), semantic vocabulary, and anchor resolution are defined by their own sections; here they appear only as opaque tokens.

## 1. Documents and embedding

A Chartdown document is UTF-8 plain text. It exists in two byte-identical forms:

- a **standalone file** with the `.cd` extension;
- an **embedded document**: the content of a fenced code block whose info string is `chartdown`, inside any Markdown document.

There is no embedded dialect. Everything valid in a file is valid in a fence and vice versa.

## 2. Document skeleton

```chartdown
# Ambush at Redford Crossing     ; optional title, first line only

map: battlemap                   ; required, first header line
grid: square 20x15
scale: 5ft

[terrain]
mud : area H11..J11 difficult
```

In order:

1. **Title** — an optional line `# <text>`, legal only as the first non-blank line. It is the document's display name. `#` has no other meaning in the language.
2. **Header** — every line between the title and the first section. Header lines are ordinary lines (§4) whose subjects are reserved keys. `map:` MUST be present and MUST be the first header line; its value is the map type. Map types in v0.1: `battlemap`, `hexcrawl`, `region`. Experimental future types carry a `-beta` suffix until stabilized. Other header keys are defined per map type; a renderer MUST warn on unknown header keys and otherwise ignore them.
3. **Sections** — a line `[name]` opens a section, which runs until the next section line or end of document. The section determines the grammar of its lines, as defined by the map type's spec sections. A renderer MUST warn on unknown section names and ignore their contents — except names prefixed `x-` (e.g. `[x-mytool]`), which are the sanctioned extension namespace and are ignored silently.
4. **Blank lines** are insignificant everywhere.

## 3. Comments

`;` begins a comment, at line start or after content, running to end of line. A `;` inside a quoted string is content, not a comment.

## 4. Lines

Outside spec-defined shorthand sections (§7), every content line has the form:

```
<subject> : <predicate>
```

- **subject** — a type word, optionally followed by id word(s), optionally followed by one quoted display name. A section's spec MAY permit omitting the type word where the section implies it (e.g. `[labels]`).
- **predicate** — a sequence of tokens: placements (grammar: §02), bare words, quoted strings, and `key=value` pairs, separated by whitespace.

Header lines use the same form with reserved subjects. There is one line grammar for the whole document.

**Detail lines (provisional).** A line indented beneath a content line is a *detail line* attached to the nearest preceding unindented line; its grammar is defined by the parent's section spec (motivating case: a `building`'s doors, windows, and ruined walls). This construct is provisional pending the battlemap-primitives section and may be revised there.

## 5. Properties

One canonical form, everywhere:

| Form | Meaning | Examples |
|---|---|---|
| bare word | flag / state | `hidden`, `overturned`, `difficult`, `ruined` |
| `key=value` | parameter | `width=2`, `facing=south`, `light=20ft`, `size=2x2` |
| `"quoted"` in subject | display name | `ogre "Gruk"` |
| `"quoted"` in predicate | textual content | `gm="Archers hold fire."` |

Parenthesized property forms are **not** part of the language. Nothing after a subject's type word is part of the name unless quoted.

Values may carry units (`20ft`, `6mi`, `90mi`); unit semantics belong to §02.

## 6. GM/player rendering (reserved constructs)

- A `[gm]` section is legal in every map type. Its contents render only in GM mode.
- The parameter `gm="…"` and the flag `hidden` are legal on any content line, marking that note or entity GM-only.
- Render modes: `player` and `gm`. `player` is the default and is **fail-closed**: it strips `[gm]` sections, `gm=` parameters, and `hidden` entities. A renderer that does not understand a GM construct MUST NOT render it.

## 7. Shorthand sections

A section's spec MAY define a colon-less line grammar where density demands it. The motivating case is the hexcrawl `[hexes]` ledger (`0203 plains village "Saltmere"`). Shorthands are per-section and spec-defined; documents cannot introduce their own. Apart from omitting the `subject :` separator, shorthand lines use the same tokens (words, quoted strings, `key=value` pairs, comments).

## 8. Version pinning

The optional header key `chartdown:` records the spec version a document targets (e.g. `chartdown: 0.1`). A renderer MUST warn when a document declares a version newer than it supports, and SHOULD render best-effort anyway.

## 9. Grammar sketch

Informal EBNF of the lexical layer (placements opaque; to be refined and made normative per [#12](https://github.com/Nossimonov/Chartdown/issues/12)):

```ebnf
document   = [ title ] , header , { section } ;
title      = "#" , text , EOL ;
header     = map-line , { line } ;
map-line   = "map" , ":" , word , EOL ;
section    = "[" , name , "]" , EOL , { line | detail | shorthand } ;
line       = subject , ":" , predicate , EOL ;
detail     = INDENT , line ;
subject    = [ word ] , { word } , [ string ] ;
predicate  = { token } ;
token      = word | string | pair | placement ;
pair       = key , "=" , ( word | string ) ;
comment    = ";" , text , EOL ;              (* legal at end of any line *)
```

---

*This document is part of the Chartdown specification and is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), per [ADR 0001](../decisions/0001-mit-code-cc-by-spec.md).*
