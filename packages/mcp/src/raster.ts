/**
 * SVG → PNG for the render tool's image mode: @resvg/resvg-wasm (pure WASM,
 * no native binaries or browser) with the vendored DejaVu Sans standing in
 * for the renderer's `sans-serif` — no system-font assumption, so the raster
 * is the same on every machine an agent runs on.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

let ready: Promise<Uint8Array> | null = null;

function init(): Promise<Uint8Array> {
  ready ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
    await initWasm(readFile(wasmPath));
    // dist/mcp.js at runtime; src/raster.ts under vitest — assets sit one level up.
    const here = dirname(fileURLToPath(import.meta.url));
    return new Uint8Array(await readFile(join(here, "..", "assets", "DejaVuSans.ttf")));
  })();
  return ready;
}

export async function rasterizePng(svg: string, zoom = 2): Promise<Uint8Array> {
  const font = await init();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: zoom },
    font: {
      fontBuffers: [font],
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans",
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}
