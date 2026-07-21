/**
 * @chartdown/core — parser and AST for the Chartdown language.
 *
 * Skeleton only: the parser is issue #21. This package MUST remain free of
 * runtime dependencies (ADR 0007) — it may depend on nothing but the language.
 */

/** The Chartdown spec draft this implementation targets. */
export const SPEC_VERSION = "0.1";

/** Placeholder AST root; the real shape is defined by the parser work (#21). */
export interface ParseResult {
  readonly kind: "document";
}

/** Parse a Chartdown document. Not yet implemented — tracked as issue #21. */
export function parse(_source: string): ParseResult {
  throw new Error("@chartdown/core: parser not yet implemented (issue #21)");
}
