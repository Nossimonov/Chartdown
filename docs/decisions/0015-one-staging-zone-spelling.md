# 0015 — A staging zone has one spelling: the word `start`

- **Status:** Accepted
- **Date:** 2026-07-25
- **Issue:** #121 (split from #118)

## Context

Two mechanisms produced a staging zone, and they took **different theme subjects**:

1. the standard-library word — `start : zone` (spec 06 §2), so `start s2 : E2..F3` is a zone themed by `start`;
2. an inference rule — spec 06 §4's *"a token-archetype word with an area placement renders as a staging zone: `party start : J14..L15`"*, where `party` is the type word and `start` is merely an **id**, so the zone is themed by `party` and `start : fill=…` styles nothing.

The second was the documented idiom and the one every example used. It reads as though `start` were the type word, and it isn't. The trap caught a careful reader: a reporting agent that cited §4 filed #118 claiming `start` was "the only zone word that ignores its theme entry," and shipped a theme whose `start : fill=` was dead. Nothing was broken — every spelling themed through its own word — but one visual object had two spellings with different behaviour, which is the same emergent-second-location smell ADR 0012 removed from borders.

## Decision

**A staging zone is the word `start`** (`start : zone`) with an area placement, and so is any word deriving from it:

```chartdown
[tokens]
start party : J14..L15                  ; where the PCs begin
rally r1 : H2..I3                       ; [vocab] rally : start
```

Spec 06 §4's inference rule is removed. A **token word carrying an area placement is a fail-loud error** naming the fix, so the second spelling is inexpressible rather than merely discouraged (spec 02 §8.3's posture). gm-only range entities and elevation areas are unaffected — they resolve to `feature`, not `token`, and keep their zone rendering.

## Alternatives considered

- **Keep both spellings; make the inference rule resolve its theme through `start` too.** Fixes the theming symptom but leaves two spellings for one thing, so the reading trap survives — and it would introduce a word whose theme subject is not its own word, which nothing else in spec 08 does.
- **Drop `start : zone` and keep the inference rule.** Makes the stdlib entry a lie and leaves staging zones with no shared theme subject; every token word would need its own entry.
- **Document the difference in spec 06 §4 and change nothing.** Rejected by the owner: a documented trap is still a trap, and this one had already caught a reader of that very section.
- **Keep `party start` as sugar.** Two spellings again, and the id-before-type-word order would contradict every other line in the language.

## Consequences

One word, one archetype, one theme subject, inherited by derivation the way everything else is. The cost is a **breaking change**: three example lines migrate (`redford-crossing`, `fairwater-manor`, `gilded-tankard`), any document using the old form now errors, and the rendered zone label changes from `start` to `party` (a zone labels by name → first id → type word) — judged an improvement, since the box now says whose it is. Because it breaks, it ships in a minor (0.4), never a patch. Documents pinned to an older spec still parse under spec 01's older-targets-are-silent rule, but the error is unconditional at parse time — version-gated parsing is not something the language does, and adding it for one rule was not judged worth it.
