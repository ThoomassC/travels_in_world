import { defineConfig, devices } from "@playwright/test";
import { E2E_SLUG_HISTORY } from "./tests/e2e/slug-history.fixture";

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

/**
 * **The empty journal, served on purpose rather than by circumstance.**
 *
 * Every spec this config owns describes a carnet with nothing in it: "the empty
 * map still frames the whole world", "a journal with no published récit",
 * "Aucun voyage publié". Until now they got that state for free, because the
 * repository's own `content/trips` happened to hold nothing — the comment on
 * `testIgnore` below still says "(empty) content/trips", and it was true.
 *
 * It stopped being true the day real trips landed, and sixteen specs went red at
 * once without a single one of them being wrong: they assert an emptiness the
 * server no longer had. A suite whose subject depends on what a content folder
 * happens to contain is not testing that subject.
 *
 * So it names the state it wants, exactly as `playwright.content.config.ts`
 * names the populated one. The fixture holds a `.gitkeep` and nothing else.
 */
const CONTENT_DIR = "tests/fixtures/content/no-trips/trips";

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
   * a build of `tests/fixtures/content/home-map`. This config serves the empty
   * fixture named above — the two are now a matched pair, each naming its own
   * content, and neither reads `content/trips`. Those specs count trips per
   * country, so against this server they would fail on every count they assert. `npm run test:e2e` runs
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
    /**
     * `TIW_CONTENT_DIR` on both halves, for the reason the other config records:
     * it is read at build time today, but a `start` disagreeing with its own
     * build is the kind of difference nobody notices until a test is
     * mysteriously green.
     */
    command:
      `TIW_CONTENT_DIR=${CONTENT_DIR} npm run build && ` +
      `TIW_CONTENT_DIR=${CONTENT_DIR} npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    /**
     * The renamed and withdrawn addresses TIW-21's spec asserts on, injected into
     * the **build** as well as the server — a redirect from the register is compiled
     * into `next.config.ts`'s output and a withdrawn slug is prerendered, so both
     * are build-time facts.
     *
     * The committed register in `src/i18n/slug-history.ts` is empty, and correctly
     * so while no trip is published; without this the 301 spec would have no address
     * to request and would pass by asserting nothing. The reasoning at length, and
     * why the variable cannot publish anything in production, is in
     * `./tests/e2e/slug-history.fixture.ts` and in `readSlugHistory`.
     */
    env: { TIW_SLUG_HISTORY: E2E_SLUG_HISTORY },
  },
});
