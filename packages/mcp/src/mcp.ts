/**
 * Chartdown MCP server (issue #58): tools over stdio so agents can draft,
 * validate, and visually verify plain-text TTRPG maps.
 *
 *   chartdown_spec   — the whole language in one file (the spec digest)
 *   chartdown_check  — fail-loud validation; diagnostics cite spec sections
 *   chartdown_render — deterministic SVG (player/GM, level, theme)
 *   chartdown_uvtt   — Universal VTT geometry export
 *   chartdown_frame  — absolute trace to anchored outline (#174)
 *
 * Run: `npx @chartdown/mcp` (binary name chartdown-mcp).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import digest from "../../../docs/spec/digest.md";
import { rasterizePng } from "./raster";
import { runCheck, runFrame, runRender, runUvtt } from "./tools";

// THE HANDSHAKE READS ITS VERSION RATHER THAN RESTATING IT (#365).
// `serverInfo.version` goes to every host on every connection, and this
// said "0.2.0" at 0.7.0 — compiled into the published bundle. It was on no
// list: `bump` had never heard of it, and #363's new sweep filters .md/.ebnf,
// so a .ts is excluded by construction. A version that is DERIVED cannot go
// stale, which is the only form of this that stays fixed. esbuild inlines the
// JSON at build time, so there is no runtime read.
import pkg from "../package.json";

const server = new McpServer({ name: "chartdown", version: pkg.version });

const textResult = (r: { text: string; isError?: boolean }): { content: { type: "text"; text: string }[]; isError?: boolean } => ({
  content: [{ type: "text", text: r.text }],
  ...(r.isError ? { isError: true } : {}),
});

server.registerTool(
  "chartdown_spec",
  {
    title: "Chartdown language digest",
    description:
      "Returns the complete Chartdown language in one file (the spec digest): document model, coordinates, the closed relational grammar, vocabulary, battlemap/hexcrawl/region primitives, themes, and a few-shot corpus of valid documents. Read this BEFORE writing Chartdown.",
  },
  () => textResult({ text: digest }),
);

server.registerTool(
  "chartdown_check",
  {
    title: "Validate a Chartdown document",
    description:
      "Parses and renders (GM mode, nothing skipped) a Chartdown document and reports every diagnostic. Errors and warnings cite the spec sections they enforce — fix and re-check until ok. Use after every substantive edit.",
    inputSchema: { source: z.string().describe("The full Chartdown document text") },
  },
  ({ source }) => textResult(runCheck(source)),
);

server.registerTool(
  "chartdown_render",
  {
    title: "Render a Chartdown document",
    description:
      "Deterministic render of a valid document. mode 'player' (default, secrets stripped fail-closed) or 'gm'; level selects one floor of a multi-level battlemap; theme accepts a Chartdown theme document. format 'png' (default) returns an image you can LOOK at to verify the map; format 'svg' returns the SVG text for saving or embedding.",
    inputSchema: {
      source: z.string().describe("The full Chartdown document text"),
      mode: z.enum(["player", "gm"]).optional(),
      level: z.string().optional().describe("A level word from the document's levels: header"),
      theme: z.string().optional().describe("A Chartdown theme document ([theme]/[glyphs] sections)"),
      format: z.enum(["png", "svg"]).optional().describe("png (default): viewable image; svg: the text"),
    },
  },
  async ({ source, mode, level, theme, format }) => {
    const result = runRender(source, { ...(mode ? { mode } : {}), ...(level !== undefined ? { level } : {}), ...(theme !== undefined ? { theme } : {}) });
    if (result.isError || format === "svg") return textResult(result);
    const png = await rasterizePng(result.text);
    return { content: [{ type: "image" as const, data: Buffer.from(png).toString("base64"), mimeType: "image/png" }] };
  },
);

server.registerTool(
  "chartdown_uvtt",
  {
    title: "Export a battlemap to Universal VTT geometry",
    description:
      "Exports one level of a battlemap to Universal VTT JSON (walls to line_of_sight, openings to portals, lights, resolution — spec 06 §9). The image field is left empty; rasterize the SVG separately if needed.",
    inputSchema: {
      source: z.string().describe("The full Chartdown document text"),
      mode: z.enum(["player", "gm"]).optional(),
      level: z.string().optional(),
    },
  },
  ({ source, mode, level }) => textResult(runUvtt(source, { ...(mode ? { mode } : {}), ...(level !== undefined ? { level } : {}) })),
);

server.registerTool(
  "chartdown_frame",
  {
    title: "Convert a traced outline into an anchored one",
    description:
      "Converts a list of ABSOLUTE points into the anchored form a detached feature's outline needs (spec 05 §4, ADR 0026): an anchor plus offsets from it, so moving the feature is one coordinate. Use this whenever you have traced a real coastline or island — the subtraction is easy to get subtly wrong, and a shape shifted by a constant renders as a perfectly plausible island in the wrong place, which nothing will report.",
    inputSchema: {
      points: z.string().describe("Absolute points, e.g. '(52,60) (55,70) (58,85)'. A leading 'area' is accepted."),
      anchor: z.string().optional().describe("Optional anchor 'x,y'. Omitted, one is derived from the shape's centre."),
    },
  },
  ({ points, anchor }) => textResult(runFrame(points, anchor)),
);

await server.connect(new StdioServerTransport());
