/**
 * The pure half of the MCP server (issue #58): tool logic with no SDK
 * surface, so it tests as plain functions. The server entry (mcp.ts) wires
 * these into @modelcontextprotocol/sdk.
 *
 * Design: fail-loud diagnostics ARE the teaching loop — they cite the spec
 * sections they enforce, so an agent can iterate a draft to valid without a
 * human decoding errors.
 */

import { checkSource, documentKind, formatPoints, frameShape, locationOf, parse, parsePoints, type Diagnostic, type FramePoint } from "@chartdown/core";
import { exportUvttSource, renderSource, type RenderMode } from "@chartdown/render-svg";

const formatDiagnostics = (diagnostics: Diagnostic[]): string =>
  diagnostics.map((d) => `${locationOf(d)}: ${d.severity}: ${d.message}`).join("\n");

export interface ToolText {
  text: string;
  isError?: boolean;
}

/** Parse + render (GM mode: nothing skipped) and report every diagnostic. */
export function runCheck(source: string): ToolText {
  // Vocabulary and theme documents need no `map:` (spec 04 §2, spec 08 §1) and
  // must be validated against their own rules, not the map's (#102).
  const kind = documentKind(source);
  if (kind !== "map") {
    const { diagnostics } = checkSource(source);
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      return { isError: true, text: `INVALID — ${errors.length} error(s) in this ${kind} document:\n${formatDiagnostics(errors)}` };
    }
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    return {
      text: `ok — valid ${kind} document${warnings.length > 0 ? `\n\nwarnings:\n${formatDiagnostics(warnings)}` : ""}`,
    };
  }
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

/**
 * Absolute trace -> anchored outline (#174, ADR 0026).
 *
 * Exposed to assistants because this is precisely the step they are worst at,
 * and its failures are invisible rather than loud: a shape shifted by a
 * constant is still a plausible island in the wrong place, and one mistyped
 * vertex is a plausible island with a cape that is not there. Nothing in the
 * document would report either. Twenty-two subtractions done deterministically
 * removes an authoring path that produces silently wrong maps — the same
 * reasoning that put diagnostics in the renderer.
 *
 * Deliberately narrow: it converts points and returns the clause. Deciding
 * where a feature belongs stays the author's job.
 */
export function runFrame(points: string, anchor?: string): ToolText {
  const parsed = parsePoints(points);
  if ("error" in parsed) return { isError: true, text: `could not read the outline: ${parsed.error}` };
  if (parsed.length < 3) {
    return { isError: true, text: `an outline needs at least three points (got ${parsed.length}) — spec 05 §4` };
  }
  let at: FramePoint | undefined;
  if (anchor !== undefined) {
    const a = parsePoints(anchor);
    if ("error" in a || a.length !== 1) return { isError: true, text: `the anchor wants one point, like 40,100` };
    at = a[0]!;
  }
  const framed = frameShape(parsed, at);
  return {
    text: [
      `at (${framed.anchor.x},${framed.anchor.y}) area ${formatPoints(framed.offsets)}`,
      ``,
      `${parsed.length} points; the shape measures ${framed.extent.width} x ${framed.extent.height}.`,
      framed.derived
        ? `The anchor was derived from the shape's own centre — pass one if the feature already has a position.`
        : `Offsets are measured from the anchor you gave.`,
      `Paste this onto a detached feature's entity line, after 'near <host>'. Do NOT also give size=/reach=/taper= — an outline and the dials together is an error (spec 05 §4).`,
    ].join("\n"),
  };
}

// parse is re-exported so the server can enumerate levels for tool hints.
export { parse };
