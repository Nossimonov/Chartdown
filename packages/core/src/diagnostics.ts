/** Author-facing diagnostics. Per the spec's error philosophy, every error names its line. */

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** 1-indexed source line. */
  line: number;
  message: string;
  /**
   * Which FILE the line belongs to, when it is not the document being checked.
   * A render pulls in theme sources, and their diagnostics were reported
   * against the map's path — sending a reader to line 22 of the wrong file.
   * Absent means the document itself, which is the overwhelming majority.
   */
  source?: "theme";
}

/**
 * How to say WHERE a diagnostic is, for consumers with no file path to print
 * (#116, ADR 0022). A theme-sourced line number belongs to the theme file, and
 * a bare "line 4" reads as line 4 of the map — the one file it is not.
 */
export const locationOf = (d: Diagnostic): string =>
  d.source === "theme" ? `theme line ${d.line}` : `line ${d.line}`;

export const error = (line: number, message: string): Diagnostic => ({
  severity: "error",
  line,
  message,
});

export const warning = (line: number, message: string): Diagnostic => ({
  severity: "warning",
  line,
  message,
});
