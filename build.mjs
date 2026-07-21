// Build the distributable bundles: the library ESM entries (npm), the CLI
// (node), and the browser entry (iife). Dev-time tooling only — the bundles
// themselves remain runtime-dependency-free (ADR 0007).
import { cpSync } from "node:fs";
import { build } from "esbuild";

// Bundles resolve workspace imports from SOURCE (same rule as vitest.config.ts
// and the tsconfig `paths`): package `exports` point at dist/ for consumers.
const sourceAliases = {
  "@chartdown/core": "./packages/core/src/index.ts",
  "@chartdown/render-svg": "./packages/render-svg/src/index.ts",
};

await build({
  entryPoints: ["packages/core/src/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  outfile: "packages/core/dist/index.js",
  logLevel: "info",
});

await build({
  entryPoints: ["packages/render-svg/src/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  external: ["@chartdown/core"],
  outfile: "packages/render-svg/dist/index.js",
  logLevel: "info",
});

await build({
  entryPoints: ["packages/cli/src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  alias: sourceAliases,
  banner: { js: "#!/usr/bin/env node" },
  outfile: "packages/cli/dist/cli.js",
  logLevel: "info",
});

await build({
  entryPoints: ["packages/browser/src/browser.ts"],
  bundle: true,
  format: "iife",
  alias: sourceAliases,
  outfile: "packages/browser/dist/chartdown.browser.js",
  logLevel: "info",
});

// Obsidian plugin (issue #38): CommonJS main.js with the `obsidian` module
// external (the app provides it); dist/ is the complete sideloadable folder.
await build({
  entryPoints: ["packages/obsidian/src/main.ts"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["obsidian"],
  alias: sourceAliases,
  outfile: "packages/obsidian/dist/main.js",
  logLevel: "info",
});
cpSync("packages/obsidian/manifest.json", "packages/obsidian/dist/manifest.json");
cpSync("packages/obsidian/styles.css", "packages/obsidian/dist/styles.css");

await build({
  entryPoints: ["playground/src/playground.ts"],
  bundle: true,
  format: "iife",
  alias: sourceAliases,
  loader: { ".cd": "text" },
  outfile: "playground/dist/playground.js",
  logLevel: "info",
});
