/**
 * Chartdown MCP server (issue #58): three tools over stdio so agents can
 * draft, validate, and visually verify plain-text TTRPG maps.
 *
 *   chartdown_spec   — the whole language in one file (the spec digest)
 *   chartdown_check  — fail-loud validation; diagnostics cite spec sections
 *   chartdown_render — deterministic SVG (player/GM, level, theme)
 *   chartdown_uvtt   — Universal VTT geometry export
 *
 * Run: `npx @chartdown/mcp` (binary name chartdown-mcp).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import digest from "../../../docs/spec/digest.md";
import { rasterizePng } from "./raster";
import { runCheck, runRender, runUvtt } from "./tools";

const server = new McpServer({ name: "chartdown", version: "0.2.0" });

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

await server.connect(new StdioServerTransport());
