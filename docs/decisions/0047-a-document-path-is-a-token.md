# 0047 — A document path is a token: quoting protects its spaces, and the quotes are not part of the path

- **Status:** Accepted
- **Date:** 2026-08-10
- **Issue:** #323 (with #324 as the standing question underneath)

## Context

`inset:` is the child half of the sub-map seam (spec 03 §4, ADR 0021). It is the only
file-reference surface in the language that cannot name a file with a space in it, and the
reason is one line — `packages/core/src/check.ts:215`:

```ts
const match = /^(\S+)\s+at\s+(\S+)$/.exec(header.value.trim());
```

Two failures fall out of that one regex, and the second is the one that matters:

1. A path with a space is a hard error with no workaround. Quoting does not rescue it — the
   quotes are just more characters inside a `\S+` that still cannot span the space.
2. **A quoted path without a space checks `ok` and silently stops validating.** The quotes are
   never stripped, so the lookup key becomes `"parent.cd"` and never matches the supplied
   `parent.cd`. The checker reports the parent *"was not provided"* — for a parent that **was**
   provided — and `check` exits `ok`. Spec 03 §4 says the seam's whole value is that *"the
   relationship being declared twice is what makes it checkable"*; symptom 2 is precisely the
   silent drift that sentence exists to prevent.

**The mechanism is not really "a strict regex" — it is a round-trip.** The lexer already
implements the rule this ADR wants. `tokenize()` (`lex.ts:51`) treats a quoted string as one
token whose whitespace is protected (`lex.ts:56`) and strips the quotes (`lex.ts:102`, and for
pair values `lex.ts:109`). The header path then **re-serializes those tokens back into a
string** (`parse.ts:538-540`), putting the quotes back:

```ts
const value = split.predicate
  .map((t) => (t.kind === "chunk" ? t.text : t.kind === "string" ? `"${t.value}"` : …))
  .join(" ");
```

So `checkInset` receives `"The Parent.cd" at tavern`, and re-parses with a regex a string the
parser had just rebuilt from tokens that were already correct. The quotes it chokes on are
quotes the parser re-added after the lexer had properly removed them.

**A second defect sits in the same regex, and it is a plain spec violation.** `grammar.ebnf:30`
gives the form as `inset = doc-path , "at" , ref`, and `grammar.ebnf:184` already defines
`ref = word | string` — a quoted display name is a *specified* spelling for the entity half, and
`checkInset` compares against `e.name`, so display-name lookup is plainly intended. Measured:

| `inset:` line | result today |
|---|---|
| `inset: parent.cd at tavern` | clean |
| `inset: parent.cd at "The Chipped Tankard"` | **error** — rejected by `\S+` |

That half needs no new grammar at all. It is already normative and the code does not honour it.

**`doc-path`, by contrast, is named once and never defined** — `grammar.ebnf:30` is the only
occurrence in the file. That gap is #324, and it is why the three file-reference surfaces drifted
apart unnoticed. This ADR answers the question for `inset:` only, in the way that matches the
surface that already works.

## Decision

**A document path is a token, lexed the way every other token in Chartdown is lexed.** A quoted
string protects the whitespace inside it, and the quotes delimit the path rather than belonging
to it. Written as the grammar production `doc-path` has been missing:

```ebnf
doc-path = word | string ;   (* quoting protects spaces; the quotes are not part of the path *)
inset    = doc-path , "at" , ref ;
```

`checkInset` stops re-splitting the re-serialized header value with a regex and **consumes it as
tokens** — `tokenize(header.value, …)`, expecting exactly `[ doc-path, "at", ref ]`. The
round-trip is lossless for this purpose: the serializer re-quotes string tokens, so
re-tokenizing recovers the same tokens the lexer produced, with the quotes stripped.

This resolves both halves at once, because both halves become the same kind of thing:

```chartdown
inset: "Whispering Glen.md" at tavern                    ; path with a space — now legal
inset: parent.cd at "The Chipped Tankard"                ; ref by display name — grammar.ebnf:184
inset: "The Parent.cd" at "The Chipped Tankard"          ; both
inset: khazad-dum.cd at mazarbul                         ; unchanged
```

**The resolved path string is the unquoted one**, which is what makes the two ends of the seam
agree: `detail="The Chipped Tankard.md"` on the parent already yields `The Chipped Tankard.md`
(measured — `lex.ts:109` strips it), and `inset:` will now yield the identical string from the
identical spelling. Accepting quotes *without* stripping them would convert today's loud error
into tomorrow's silent pass, which is strictly worse than the bug.

**A bare path containing spaces stays an error**, and this is a decision rather than an omission
— see the alternatives. Because that error is now the *only* way to spell a spaced path wrongly,
`checkInset` gains a diagnostic that says so, instead of the generic form message the issue
complains about:

> `'inset:' takes one document then 'at' then one entity — a path with a space is quoted:
> `inset: "The Parent.cd" at tavern` (spec 03 §4)`

## Alternatives considered

**Do nothing.** Rejected. The seam is unwriteable in any Obsidian vault, where every file is
named the Obsidian way — capitalised words separated by spaces. `../Whispers` has never had a
clean `locations/The Chipped Tankard.md`, on any version, and its only workarounds are renaming
every file (breaking every `[[wiki-link]]`) or deleting the `inset:` line, which checks `ok` by
throwing the seam away. Symptom 2 is also actively harmful in a way "do nothing" cannot hold:
it reports a supplied parent as missing and passes.

**Widen the regex to admit a quoted segment** — `/^("[^"]*"|\S+)\s+at\s+("[^"]*"|\S+)$/`, then
strip the quotes. This works, and it is a two-line change; it lost on what it teaches rather
than on what it does. It would be the **fourth** independent definition of how a file reference
is spelled (`detail=` via the lexer, `use:` via no lexing at all, `inset:` via this regex), and
the proliferation of exactly those private definitions is what #324 identifies as the root cause
of the drift. It also entrenches the round-trip described above: it hand-writes a quote-stripper
whose whole job is to undo `parse.ts:539`, so the language would then strip quotes in three
places and re-add them in one. The token form deletes that reasoning instead of duplicating it.

**Stop re-serializing — have `parse.ts` keep structured header values**, so no consumer has to
re-parse a string. This is the change that fixes the *category*, and it is the one I most wanted
to make. It lost on blast radius, measured rather than assumed: 36 sites read `.header`, and
`HeaderEntry.value` is consumed as a plain string by the `HEADER_FORMATS` regex tests
(`parse.ts:583`), the closed-set and format checks, `levels:` splitting (`parse.ts:537`),
`scale:` measurement in both `check.ts` and `render-svg/src/model.ts`, and the theme layer.
Changing the shape of `value` for every header key, to fix one seam, is a refactor wearing a
bug fix's clothes — and it is breaking under ADR 0041 in a way this issue has no mandate for.
The token approach gets the same result for `inset:` by re-tokenizing at the point of use, which
is cheap and local. **If #324 is answered "all surfaces, one definition", this is the right shape
for that work, and this ADR should be revisited then rather than treated as having settled it.**

**Support a bare spaced path** — `inset: The Parent.cd at tavern`, no quotes. Rejected on
ambiguity, and the ambiguity is real rather than theoretical: `at` is the separator, so the
value `The Parent.cd at tavern` cannot be split without guessing, and a file named `at.cd` or a
path containing ` at ` has no reading at all. The measured header value for that line is exactly
`The Parent.cd at tavern` — the lexer has already thrown away the information that would be
needed, because there was none. Quoting is the only unambiguous spelling, which is why every
other surface in the language uses it. The cost is that the issue's headline symptom ("cannot
name a file with a space") is fixed *only* in its quoted form, and the targeted diagnostic above
is what keeps that from being a silent disappointment.

**Fix `use:` in the same change.** Rejected on scope, but the measurement is worth recording
because the folder's handoff had deliberately left it unmeasured: `use:` performs **no lexing at
all** — the entire header value is the lookup key (`parse.ts:588`). So spaced library paths work
by accident, and quoted ones have symptom 2 exactly:

| `use:` line | key supplied | result |
|---|---|---|
| `use: My Lib.cd` | `My Lib.cd` | resolved |
| `use: "My Lib.cd"` | `My Lib.cd` | **`library '"My Lib.cd"' not provided`** — silent mismatch |

That is a third surface with the same defect, and it belongs to #324's "answer it for all three
at once", not to a bug fix for the seam. Fixing it here would bury an unfiled change inside a
filed one. It gets filed instead.

**Treat this as a syntax proposal (CONTRIBUTING rule 5) and stop.** Genuinely arguable, and the
reason it lost should be checkable rather than asserted: no new syntax is introduced. Quoting
already protects whitespace on every other line in the language (`lex.ts:56`), `ref = word |
string` is already normative (`grammar.ebnf:184`), and `detail=` already accepts and strips the
exact spelling being added. What is written down here is a *definition* of a production the
grammar names and never defines — which CONTRIBUTING rule 2 makes the first deliverable of the
fix, not a proposal. **If you read `doc-path`'s absence as an open design question rather than an
oversight, this is the point to send it back as a proposal instead** — that reading is defensible
and it is your call, not mine.

## Consequences

**The seam becomes writable where it is actually used.** `../Whispers/locations/The Chipped
Tankard.md` can carry `inset: "Whispering Glen.md" at tavern` and have it mean something. The
standing instruction not to "fix" that file by deleting its `inset:` line can finally be retired
rather than merely re-explained — though note the vault has a *separate* authoring gap that this
does not touch: the tavern entity carries `detail=` but no `detail-at=`, so the seam will error
for want of an anchor until `detail-at=J12` is added.

**Both ends of the seam resolve the same string from the same spelling**, which is the property
#324 says nothing checks today. It becomes testable here for two of the three surfaces.

**This is breaking under ADR 0041, and that is the point.** A document whose `inset:` names a
quoted path checks `ok` today *because its seam is not being validated*. After this change the
seam is validated, so real disagreements that were always present — a missing `detail=`, a
missing `detail-at=`, a non-integer magnification, an under-covering child grid — will start
failing loud. A clean document can stop checking clean, which is ADR 0041's definition of
breaking, so this rides `preview`. There is no way to fix symptom 2 that does not have this
consequence: the whole complaint is that checks were being skipped.

**The error message for a bare spaced path is now load-bearing.** Authors will still write
`inset: The Parent.cd at tavern` — it is the natural thing to type — and the diagnostic is the
only thing standing between them and the conclusion that the feature is broken. If it regresses
to the generic form message, symptom 1 returns in practice while the tests still pass.

**`use:` is left inconsistent on purpose**, and the language now has two surfaces that strip
quotes and one that does not. That is a worse *state* than fixing all three, and it is
deliberate: this ADR is not the place that gets to answer #324 for the whole language. Anyone
reading `use:`'s behaviour as settled by this decision has read it wrong.

**Found while building — the corpus cannot express this decision.** No document in
`examples/` uses `inset:` at all, so the 34-render both-mode sweep (17 examples × gm/player,
0 differ) and the byte-identical `check` sweep prove the change is CONTAINED, not that it
works. This is the same evidentiary shape ADR 0046 hit with `fairwater-manor`, and it is worth
stating because "the corpus did not move" reads like a pass and is not one. What carries the
decision instead is the unit coverage: the seven cases were run against the pre-fix `check.ts`
and all seven fail there, so they discriminate. Nothing here changes the decision — it records
what the evidence is and is not.

**What this constrains.** It fixes the spelling of `doc-path` for `inset:` as `word | string`.
Any later answer to #324 that wants a different lexing for file references — a bare rest-of-line
path, say — now has to supersede this ADR rather than simply decide, and would break documents
written against it.
