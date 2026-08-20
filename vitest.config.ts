import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    /**
     * `globals: true` is deliberately NOT set. It is a spring-loaded trap: the
     * globals it injects are only *typed* if `vitest/globals` is added to
     * `compilerOptions.types`, which would in turn pull Vitest's ambient types
     * into every `next build`. Measured without it: a spec written with bare
     * `describe`/`it` passes under Vitest and breaks `npm run typecheck` and
     * `next build` with `TS2582: Cannot find name 'describe'`. Explicit imports
     * from "vitest" keep the two chains telling the same story.
     */
    setupFiles: ["./tests/setup.ts"],
    css: true,
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    /**
     * Playwright owns `tests/e2e`; `tests/build` asserts on `.next/` and needs a
     * build first, so it lives in `vitest.build.config.ts` behind
     * `npm run test:build`. Neither belongs to this, build-free, suite.
     *
     * `tests/lint` is excluded for a different reason, written down in
     * `vitest.lint.config.ts`: it needs `environment: "node"`, where the
     * `tests/setup.ts` teardown above throws on `window` — and under jsdom it
     * cannot resolve the repository root at all. It runs behind
     * `npm run test:lint`.
     */
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**", "tests/build/**", "tests/lint/**"],
  },
});
