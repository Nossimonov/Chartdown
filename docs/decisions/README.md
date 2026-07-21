# Architecture Decision Records

Every decision that closes off alternatives — syntax choices, technology choices, scope cuts — is recorded here before its issue is closed. See [CONTRIBUTING.md](../../CONTRIBUTING.md#adrs-architecture-decision-records) for the rules.

- Files are numbered sequentially: `0001-<slug>.md`, `0002-<slug>.md`, …
- Copy [0000-template.md](0000-template.md) to start a new one.
- ADRs are immutable once **Accepted**. To reverse a decision, write a new ADR that marks the old one **Superseded** and links both ways.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-mit-code-cc-by-spec.md) | Code is MIT; the specification is CC-BY-4.0 | Accepted |
| [0002](0002-document-model-lexical-layer.md) | One line grammar, `;` comments, `key=value` properties; embedded and standalone documents are identical | Accepted |
| [0003](0003-coordinates-and-placement.md) | Chess-style addresses on every grid; a closed relational grammar; live, order-bounded, fail-loud anchor resolution | Accepted |
| [0004](0004-identity-and-references.md) | Explicit ids and display names are both reference keys; anonymous entities are unreferenceable; resolution is fail-loud | Accepted |
| [0005](0005-open-vocabulary-archetypes.md) | The language knows no nouns: closed archetypes, open vocabulary, usage inference, theme-owned appearance | Accepted |
| [0006](0006-battlemap-primitives-decisions.md) | No bestiary; elevation as emergent terraces; orthogonal footprints with renderer smoothing | Accepted |
| [0007](0007-typescript-stack.md) | The reference implementation is TypeScript | Accepted |
