import { defineConfig } from "vitest/config";

/**
 * The lint-boundary suite: `tests/lint/**` runs ESLint through its Node API and
 * asserts that the rules which guard an architectural invariant actually refuse
 * what they claim to refuse. Third config, and each of the three exists for a
 * measured reason.
 *
 * **Why not in `npm run test`.** The decisive reason is the environment, not the
 * cost. This suite needs `environment: "node"`, because under jsdom
 * `import.meta.url` is not a `file:` URL and resolving the repository root throws
 * outright — and `environment: "node"` is in turn incompatible with
 * `tests/setup.ts`, whose `afterEach` clears `window.localStorage`. The two
 * suites could not share a config even if this one were instant.
 *
 * The cost, measured and secondary: ~4 s on a cold Vite cache, ~0.8 s warm. It is
 * dominated by the *first* `lintText`, which pulls `eslint-config-next` and
 * `typescript-eslint` in through Vite; each further case then costs 1–4 ms. That
 * shape is why this suite can afford to be exhaustive rather than
 * representative — and why it would still be the slowest thing in a unit suite
 * that finishes in under a second on every save.
 *
 * No `setupFiles`, no jsdom, no build prerequisite: unlike `vitest.build.config.ts`
 * this one reads nothing but `eslint.config.js`, so it can run on a clean
 * checkout. `npm run test:lint`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/lint/**/*.test.ts"],
    /**
     * The first lint pays for loading the whole ESLint config graph; the default
     * 5 s timeout leaves too little headroom on a cold cache or a loaded CI box.
     */
    testTimeout: 30_000,
  },
});
