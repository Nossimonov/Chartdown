/**
 * The pure half of the MCP server (issue #58): tool logic with no SDK
 * surface, so it tests as plain functions. The server entry (mcp.ts) wires
 * these into @modelcontextprotocol/sdk.
 *
 * Design: fail-loud diagnostics ARE the teaching loop — they cite the spec
 * sections they enforce, so an agent can iterate a draft to valid without a
 * human decoding errors.
 */

import { parse } from "@chartdown/core";
import { exportUvttSource, renderSource, type RenderMode } from "@chartdown/render-svg";

const formatDiagnostics = (diagnostics: { severity: string; line: number; message: string }[]): string =>
  diagnostics.map((d) => `line ${d.line}: ${d.severity}: ${d.message}`).join("\n");

export interface ToolText {
  text: string;
  isError?: boolean;
}

/** Parse + render (GM mode: nothing skipped) and report every diagnostic. */
export function runCheck(source: string): ToolText {
  const { document, diagnostics } = renderSource(source, { mode: "gm" });
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const entityCount = document.sections.reduce(
    (n, s) => n + s.entries.filter((entry) => entry.kind === "entity" || entry.kind === "hex-line").length,
    0,
  );
  if (errors.length > 0) {
    return {
      isError: true,
      text: `INVALID — ${errors.length} error(s):\n${formatDiagnostics(errors)}${
        warnings.length > 0 ? `\n\nwarnings:\n${formatDiagnostics(warnings)}` : ""
      }`,
    };
  }
  const levels = document.levels.length > 0 ? `, levels: ${document.levels.join(" ")}` : "";
  return {
    text: `ok — valid ${document.mapType} map "${document.title ?? document.docId}", ${entityCount} content lines${levels}${
      warnings.length > 0 ? `\n\nwarnings (render still succeeds):\n${formatDiagnostics(warnings)}` : ""
    }`,
  };
}

export interface RenderArgs {
  mode?: RenderMode;
  level?: string;
  theme?: string;
}

/** Render to SVG; errors come back as check-style text instead of a broken image. */
export function runRender(source: string, args: RenderArgs = {}): ToolText {
  const options: Parameters<typeof renderSource>[1] = {};
  if (args.mode) options.mode = args.mode;
  if (args.level !== undefined) options.level = args.level;
  if (args.theme !== undefined) options.theme = args.theme;
  const { svg, diagnostics } = renderSource(source, options);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    return { isError: true, text: `render refused — fix these first:\n${formatDiagnostics(errors)}` };
  }
  return { text: svg };
}

/** UVTT export (spec 06 §9): the geometry JSON, image left empty for the caller. */
export function runUvtt(source: string, args: { mode?: RenderMode; level?: string } = {}): ToolText {
  const options: { mode?: RenderMode; level?: string } = {};
  if (args.mode) options.mode = args.mode;
  if (args.level !== undefined) options.level = args.level;
  const { uvtt, diagnostics } = exportUvttSource(source, options);
  if (!uvtt) {
    const errors = diagnostics.filter((d) => d.severity === "error");
    return { isError: true, text: `UVTT export refused:\n${formatDiagnostics(errors)}` };
  }
  return { text: JSON.stringify(uvtt, null, 2) };
}

// parse is re-exported so the server can enumerate levels for tool hints.
export { parse };
