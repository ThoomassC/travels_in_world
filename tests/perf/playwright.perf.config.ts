import path from "node:path";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * The performance run — TIW-26's first acceptance criterion, and the only suite
 * in this repository whose result depends on how busy the machine is.
 *
 * **Why it is not a third set of specs inside `playwright.content.config.ts`,
 * which already builds exactly this fixture.** One option: `workers`. That config
 * is `workers: 1` on CI and unbounded on a workstation, and a Largest Contentful
 * Paint taken while three other Chromiums share the cores measures the runner.
 * Making it serial everywhere would have slowed a 40-case functional suite to
 * protect two measurements; a config of its own costs one build in a job that
 * runs in parallel with the others and costs nothing in feedback latency.
 *
 * The second reason is legibility: a red `perf` job says "the site got slower",
 * where the same failure inside `Playwright (build de production)` says "the
 * end-to-end suite is broken" and sends the reader to the wrong place.
 *
 * **What it shares with `playwright.content.config.ts`, and why.** The same
 * fixture (`TIW_CONTENT_DIR`), the same frozen build day (`TIW_BUILD_DATE`) and
 * the same `TIW_PUBLIC_DIR` for the `prebuild` validation. `content/trips` is
 * empty until TIW-24, so there is no trip page on the repository's own content to
 * measure at all — and the frozen day is not a detail here: without it the
 * "nouveau récit" banner appears or vanishes with the calendar, which changes what
 * the home page's biggest element *is*.
 *
 * **The `.next` it leaves behind is the fixture's.** Same trap
 * `playwright.content.config.ts` documents, and the same answer: run
 * `npm run build` before `npm run test:build` rather than trusting whatever the
 * last suite left on disk. On CI the question does not arise — `perf` is its own
 * job with its own checkout.
 */

/** A port of its own, for the reason the other two configs give at length. */
const PORT = Number(process.env.E2E_PERF_PORT ?? 3279);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const CONTENT_DIR = "tests/fixtures/content/home-map/trips";
const PUBLIC_DIR = "tests/fixtures/content/home-map/public";
const BUILD_DATE = "2026-01-06";

/**
 * The fixture's photographs, copied into `public/` before the server starts and
 * removed by `globalTeardown`. `./fixture-photos.ts` carries the whole argument,
 * including the measured reason the copy cannot live in `globalSetup`.
 *
 * `node` with no loader: the file is self-contained TypeScript with no `@/` alias
 * and no relative import, which Node strips types from on its own since 23.6.
 */
const INSTALL_PHOTOS = "node tests/perf/fixture-photos.ts";

const ENVIRONMENT = `TIW_CONTENT_DIR=${CONTENT_DIR} TIW_PUBLIC_DIR=${PUBLIC_DIR} TIW_BUILD_DATE=${BUILD_DATE}`;

export default defineConfig({
  testDir: ".",
  /**
   * The whole point. Serial on every machine, workstation included: this is the
   * one suite where a parallel run would not be flaky but *wrong*.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  /**
   * One retry on CI, and the reasoning is written down because a retry on a
   * performance test is normally a way of hiding one.
   *
   * Each case is already the median of five cold loads, so an ordinary hiccup is
   * absorbed inside the case. What a retry covers is the other kind of event — a
   * runner that gets descheduled for two seconds — which makes *all five* samples
   * bad at once and has nothing to do with the code. A real regression is
   * reproducible, so it fails twice. Zero retries on a workstation: there, a red
   * run is information.
   */
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  /** Five cold loads under CPU ×4 and a 150 ms round trip, twice over. */
  timeout: 300_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["Pixel 5"] } }],
  globalTeardown: "./global-teardown.ts",
  webServer: {
    command:
      `${INSTALL_PHOTOS} && ${ENVIRONMENT} npm run build && ` +
      `${ENVIRONMENT} npm run start -- --port ${PORT}`,
    /**
     * The repository root, explicitly. Playwright defaults a `webServer`'s working
     * directory to the **config file's** directory, which for the other two configs
     * is the root and for this one is `tests/perf` — where `npm run build` finds no
     * `package.json` and every relative path above means something else.
     */
    cwd: path.resolve(import.meta.dirname, "../.."),
    url: BASE_URL,
    /** Same reason as the other two configs: attaching to a stranger costs the point. */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
