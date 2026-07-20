# 0004 — Explicit ids and display names are both reference keys; anonymous entities are unreferenceable; resolution is fail-loud

- **Status:** Accepted
- **Date:** 2026-07-20
- **Issue:** #15 (spawned from #11)

## Context

Vision principle 6 requires bidirectional prose↔map linking, which requires stable entity identity. The original proposal offered three identity sources: explicit id words, display-name slugs, and singleton type words (`ford` referenceable while unique). Review exposed the singleton tripwire — adding a second entity of the type breaks existing references, violating the spirit of append-stability. The owner first explored the strict fix (explicit ids required for any reference), then pulled back from its keystroke tax with the deciding argument: a quoted display name *is* a form of id, unique enough on most maps; names are natural keys that exhaust eventually (nineteen US towns named Edgewood, because proximity to woods is often the distinguishing feature) — but that failure is occasional and loud, whereas mandatory ids tax every simple map to safeguard authors from a hypothetical.

## Decision

Spec section [03-identity-and-links.md](../spec/03-identity-and-links.md), summarized:

- Identity keys: **explicit id words** (unique per document, parse-time collision errors) and **display names** (may repeat). Entities with neither are **anonymous** — renderable, unreferenceable. Type words never confer identity.
- References: bare word → id lookup; quoted string → display-name lookup; misses and ambiguity are fail-loud errors whose fix is promoting the target to an explicit id.
- Anchors: renderers export `cd-<doc-id>-<entity-id>` (new `id:` header key, defaulting to title slug). Display-name anchors are rename-sensitive *by analogy to Markdown heading anchors*; explicit-id anchors are stable.
- Map→prose and map→map via reserved generic parameters `link=` and `detail=`, silently ignored by non-supporting renderers.
- `[gm]` lines: resolving subject = attachment (placements forbidden); non-resolving subject with a placement = new GM-only entity; non-resolving subject without a placement = error (closes the misspelled-attachment typo hole).

## Alternatives considered

- **Singleton-type identity** — rejected: the only construct where appending lines breaks existing references.
- **Explicit ids required for all references** — cleanest resolution model, rejected for taxing simple descriptive maps to protect against a rare, loud, self-locating failure; "safeguarding strangers from imagined dangers they pose to themselves."
- **Auto-numbered implicit ids** (`goblin-1`) — silently unstable under insertion; rejected outright.
- **`#id` sigil syntax** — `#` is the title character; subject position already has an id home.
- **Cross-document entity references** — deferred to ecosystem phase; `link=`/`detail=` cover the narrated use cases.

## Consequences

- Simple maps stay simple (`east of "The Serpent's Spine"` needs no ceremony); growing maps hit loud, self-explaining errors at exactly the point ids become necessary.
- Renaming a display name can break quoted references and slug anchors — a known, documented trade with a familiar precedent (heading anchors) and a stated remedy.
- The Redford example restructures two subjects (`building tollhouse "Ruined Toll House"`, `crates loot`) so its `[gm]` attachments resolve; Vessany demonstrates both reference forms coexisting.
- Anonymous entities give authors a zero-ceremony tier with a hard guarantee: nothing can ever depend on them.
