// Build the distributable bundles: the CLI (node) and the browser entry (iife).
// Dev-time tooling only — the bundles themselves remain runtime-dependency-free.
import { build } from "esbuild";

await build({
  entryPoints: ["packages/cli/src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  outfile: "packages/cli/dist/cli.js",
  logLevel: "info",
});

await build({
  entryPoints: ["packages/browser/src/browser.ts"],
  bundle: true,
  format: "iife",
  outfile: "packages/browser/dist/chartdown.browser.js",
  logLevel: "info",
});
