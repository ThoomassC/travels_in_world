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

/**
 * The second server, and why there is one.
 *
 * The photo viewer of TIW-17 can only be exercised on a trip page that *has*
 * photographs, and the repository's own `content/trips` is empty until TIW-24 —
 * deliberately. The specs in `routing.spec.ts` assert the empty state of `/fr`
 * precisely because that is what production serves today, so pointing the single
 * build at a fixture trip would falsify them, and weakening them to accommodate
 * this suite would trade a real guard for a convenience.
 *
 * So: a second production build over `tests/fixtures/e2e/photos`, on its own port
 * and — the part that matters — its own `distDir`. Two builds sharing `.next`
 * would clobber each other, and the second would leave the *fixture* build there
 * for the next `npm run test:build` to measure, with nothing to say so.
 *
 * What it costs, measured on this workstation: ~6 s of build. In CI it is a second
 * `next build` inside the `e2e` job, which already pays one and runs in parallel
 * with the other two jobs — so it costs runner time (free, public repository) and
 * nothing in feedback latency.
 *
 * **What it cannot test, stated rather than discovered later.** `next start` serves
 * the repository's own `public/`, which is not the fixture's, and no configuration
 * moves it. So the photographs 404 in the browser: the `<picture>`, the links, the
 * reserved boxes and every interaction are real, and the *decoding* of an AVIF is
 * not. That is covered where it can be — `tests/content/photo-files.test.ts`
 * asserts the real encoder's real output, codec and dimensions included.
 */
const PHOTOS_PORT = Number(process.env.E2E_PHOTOS_PORT ?? PORT + 1);
const PHOTOS_BASE_URL = `http://127.0.0.1:${PHOTOS_PORT}`;
const PHOTOS_FIXTURE = "tests/fixtures/e2e/photos";

/**
 * The environment both halves of the fixture build need — the build *and* the
 * `next start` that serves it, since `distDir` is read from the config by both.
 *
 * `TIW_PUBLIC_DIR` is there for `validate:content`, which npm's `prebuild` hook
 * runs before every build: without it the hook would validate the real (empty)
 * content directory while the build read the fixture, so the fixture's photos
 * would go unchecked by the one command that guarantees them.
 */
const PHOTOS_ENV = [
  "TIW_DIST_DIR=.next-photos",
  `TIW_CONTENT_DIR=${PHOTOS_FIXTURE}/trips`,
  `TIW_PUBLIC_DIR=${PHOTOS_FIXTURE}/public`,
].join(" ");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    trace: "on-first-retry",
  },
  /**
   * Two projects, split by file name rather than by folder: `*.photos.spec.ts`
   * runs against the fixture build, everything else against the real one.
   *
   * `baseURL` lives on each project and no longer on the top-level `use`, which is
   * what makes a relative `page.goto("/fr")` land on the right server. A top-level
   * default would silently send the photo specs at the empty build — where the
   * trip page 404s, and where a `toBeVisible()` failure would look like a bug in
   * the component.
   */
  projects: [
    {
      name: "chromium",
      testIgnore: /\.photos\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: BASE_URL },
    },
    {
      name: "chromium-photos",
      testMatch: /\.photos\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: PHOTOS_BASE_URL },
    },
  ],
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
  webServer: [
    {
      command: `npm run build && npm run start -- --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
    },
    {
      command: `${PHOTOS_ENV} npm run build && ${PHOTOS_ENV} npm run start -- --port ${PHOTOS_PORT}`,
      url: PHOTOS_BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
    },
  ],
});
