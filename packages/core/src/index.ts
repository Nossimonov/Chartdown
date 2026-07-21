/**
 * @chartdown/core — parser and AST for the Chartdown language.
 *
 * This package MUST remain free of runtime dependencies (ADR 0007) —
 * it may depend on nothing but the language.
 */

export { parse, slugify, SPEC_VERSION, type ParseOptions, type ParseResult } from "./parse";
export { STDLIB_SOURCE, ARCHETYPES } from "./vocab";
export type { Diagnostic, Severity } from "./diagnostics";
export type * from "./ast";
