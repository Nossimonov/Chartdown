import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against SOURCE, not built output: the package `exports` fields
// point at dist/ for npm consumers, so the workspace aliases here keep the
// dev loop build-free (tsconfig `paths` do the same for the typechecker).
export default defineConfig({
  resolve: {
    alias: {
      "@chartdown/core": fileURLToPath(new URL("packages/core/src/index.ts", import.meta.url)),
      "@chartdown/render-svg": fileURLToPath(new URL("packages/render-svg/src/index.ts", import.meta.url)),
    },
  },
});
