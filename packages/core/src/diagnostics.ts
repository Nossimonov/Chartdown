/** Author-facing diagnostics. Per the spec's error philosophy, every error names its line. */

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** 1-indexed source line. */
  line: number;
  message: string;
}

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
