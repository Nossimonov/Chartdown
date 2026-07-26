/**
 * @chartdown/core — parser and AST for the Chartdown language.
 *
 * This package MUST remain free of runtime dependencies (ADR 0007) —
 * it may depend on nothing but the language.
 */

export { parse, slugify, SPEC_VERSION, type ParseOptions, type ParseResult } from "./parse";
export { checkDetailSeams, checkInset, checkSource, documentKind, type CheckResult, type DocumentKind } from "./check";
export { STDLIB_SOURCE, ARCHETYPES, CLOSED_FACETS, facetAccepts, VocabTable, loadStdlib, parseVocabDocument } from "./vocab";
export { parseThemeDocument, THEME_PROPS, SURFACE_WORDS, ZONE_WORDS, type ThemeDocumentNode, type ThemeEntry } from "./theme";
export type { Diagnostic, Severity } from "./diagnostics";
export { locationOf } from "./diagnostics";
export type * from "./ast";
