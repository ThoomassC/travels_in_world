import { defineConfig, devices } from "@playwright/test";

/**
 * A dedicated port, deliberately NOT 3000.
 *
 * `PORT`/3000 is where `npm run dev` listens, which is the normal state of a
 * workstation. Combined with `reuseExistingServer`, the suite then attached to
 * that dev server and the four specs passed green against development HTML
 * (verified: `next-devtools` present in the page) with no build at all — the
 * exact opposite of what this config's own comment promises.
 */
const PORT = Number(process.env.E2E_PORT ?? 3277);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  /**
   * `*.populated.spec.ts` belongs to `playwright.content.config.ts`, which serves
   * a build of `tests/fixtures/content/home-map` instead of the repository's own
   * (empty) `content/trips`. Those specs count trips per country, so against this
   * server they would fail on every count they assert. `npm run test:e2e` runs
   * both configs, in sequence — see `package.json`.
   */
  testIgnore: /\.populated\.spec\.ts$/,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /**
   * The E2E suite runs against a production build: the locale redirect and the
   * server-rendered map (TIW-13) behave differently under `next dev`, so
   * testing dev would test something we never ship.
   *
   * `reuseExistingServer: false` everywhere, CI and workstation alike — that is
   * what makes the sentence above true. It costs a build per run; attaching to
   * whatever already listens costs the whole point of the suite. If the port is
   * busy, Playwright fails loudly instead of silently testing a stranger.
   */
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
