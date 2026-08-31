import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end suite, run a second time against a **populated** journal.
 *
 * **Why a second run rather than a second server.** `playwright.config.ts` builds
 * the repository's own `content/trips`, which is empty until TIW-24, and its specs
 * assert that state deliberately — an honest empty block, a world map with no
 * marker. That is production today and it is worth pinning. But the map's textual
 * equivalent (TIW-15) exists to say *how many trips reach each country*, and there
 * is no such number on an empty journal: the counts, the per-country links, the
 * cropped-caption branch and the fragment that has to resolve on `/fr/voyages`
 * are all unassertable there.
 *
 * Two Playwright *webServers* in one config was the first shape, and it was
 * dropped: two `next build` runs sharing one `.next` overwrite each other's
 * `server/app/fr.html`, and giving the second one a `distDir` of its own puts a
 * new top-level build directory in the repository — which `eslint .` then walks,
 * because ESLint's flat config does not read `.gitignore` and its ignore list is
 * in `eslint.config.js`. Two sequential runs of the *default* `.next` cost the
 * same two builds and touch no shared configuration at all.
 *
 * **The order matters, and `package.json` fixes it**: this config runs *first*, so
 * the `.next` left on disk afterwards is the one built from the repository's real
 * content — the same thing `npm run build` produces, which is what
 * `npm run test:build` reads.
 */

/**
 * A port of its own, so a stale server from the other config cannot answer these
 * specs. Same reasoning as the note in `playwright.config.ts` about port 3000.
 */
const PORT = Number(process.env.E2E_CONTENT_PORT ?? 3278);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Four trips over four countries, one country holding two, and one trip crossing
 * two — the fixture's own README says why each. `TIW_CONTENT_DIR` names the trips
 * directory itself and not its parent.
 */
const CONTENT_DIR = "tests/fixtures/content/home-map/trips";

export default defineConfig({
  testDir: "./tests/e2e",
  /** The mirror of the `testIgnore` in `playwright.config.ts`: these specs only. */
  testMatch: /\.populated\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium-populated", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    /**
     * `TIW_CONTENT_DIR` is exported for the `start` half as well as the `build`
     * half. It is only read at build time today, but a `start` that disagreed with
     * its own build is the kind of difference nobody notices until a test is
     * mysteriously green.
     */
    command:
      `TIW_CONTENT_DIR=${CONTENT_DIR} npm run build && ` +
      `TIW_CONTENT_DIR=${CONTENT_DIR} npm run start -- --port ${PORT}`,
    url: BASE_URL,
    /** Same reason as the other config: attaching to a stranger costs the point. */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
