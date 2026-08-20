import { defineConfig } from "vitest/config";

/**
 * The build-artefact suite, separate from `vitest.config.ts` on purpose.
 *
 * `tests/build/**` asserts on `.next/` and therefore needs `npm run build` to
 * have run first. Keeping it out of `npm run test` keeps the unit suite fast and
 * build-free; `npm run test:build` runs this one. Node environment, no jsdom and
 * no `tests/setup.ts`: nothing here touches the DOM.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/build/**/*.test.ts"],
  },
});
