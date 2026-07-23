import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against SOURCE, not built output: the package `exports` fields
// point at dist/ for npm consumers, so the workspace aliases here keep the
// dev loop build-free (tsconfig `paths` do the same for the typechecker).
export default defineConfig({
  plugins: [
    {
      // Mirror build.mjs's `.md: "text"` esbuild loader (digest imports).
      name: "md-as-text",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".md")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      "@chartdown/core": fileURLToPath(new URL("packages/core/src/index.ts", import.meta.url)),
      "@chartdown/render-svg": fileURLToPath(new URL("packages/render-svg/src/index.ts", import.meta.url)),
    },
  },
  test: {
    // Obsidian DOM helper stand-ins for the plugin's happy-dom suites
    // (self-guarded no-op in node-environment suites).
    setupFiles: ["packages/obsidian/src/obsidian-dom-shim.ts"],
  },
});
