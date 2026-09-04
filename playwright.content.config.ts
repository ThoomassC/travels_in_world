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

/**
 * The fixture's own `public/`, which only `validate:content` reads — and it has to
 * be given, since TIW-17, or the build fails before it starts.
 *
 * npm's `prebuild` hook runs `validate:content` before every `next build`. Without
 * this variable it would validate against the repository's `public/`, where the
 * fixture's photographs are not — so the hook would refuse the trip for a missing
 * file while the build read it happily, and the whole config would stop at a
 * message about a photo nobody had moved.
 *
 * `next start` never reads it: it serves the repository's own `public/`, and no
 * configuration moves that. So the photographs 404 in the browser here, which
 * `photo-viewer.populated.spec.ts` states at the top and works within — every
 * element, box and interaction is real, and only the decoding of an AVIF is not.
 */
const PUBLIC_DIR = "tests/fixtures/content/home-map/public";

/**
 * The fixture's visited places (TIW-36) — two of them, dateless, with no page.
 *
 * Given explicitly for the same reason `TIW_PUBLIC_DIR` is: npm's `prebuild` hook
 * runs `validate:content` before every `next build`, and without this variable it
 * would validate the *repository's* fourteen places while the build read the
 * fixture's two. The two collections would then disagree about what a run just
 * checked, which is the one thing a validator must never do.
 *
 * Exported to the `start` half as well, like `TIW_CONTENT_DIR`: a `start` that
 * disagrees with its own build is how a spec goes mysteriously green.
 */
const PLACES_FILE = "tests/fixtures/content/home-map/places.yaml";

/**
 * The day this build believes it is — one day after the fixture's newest
 * publication (`islande-2022`, `publishedAt: 2026-01-05`).
 *
 * **Without it the "nouveau récit" badge is a function of the day the suite
 * runs**, which is the definition of a flaky spec: green until early March 2026,
 * red for ever after, and nobody would connect that failure to this file. With
 * it, `fresh-trip.populated.spec.ts` asserts a J+1 journal on any machine on any
 * date.
 *
 * Read by `src/app/build-day.ts` — the one module on the render path that reads a
 * clock — and it is a **build**-time input like `TIW_CONTENT_DIR` above, because
 * the badge is prerendered bytes and `next start` never re-decides it. Exported
 * to both halves for the same reason that variable is: a `start` disagreeing with
 * its own build is how a spec goes mysteriously green.
 *
 * The far end of the window — J+61, the badge gone — is not asserted here and
 * could not be: a served page pins exactly one day per build. It is asserted over
 * this same committed collection, with the date injected, in
 * `tests/app/freshness-pipeline.test.ts`.
 */
const BUILD_DATE = "2026-01-06";

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
      `TIW_CONTENT_DIR=${CONTENT_DIR} TIW_PLACES_FILE=${PLACES_FILE} TIW_PUBLIC_DIR=${PUBLIC_DIR} ` +
      `TIW_BUILD_DATE=${BUILD_DATE} npm run build && ` +
      `TIW_CONTENT_DIR=${CONTENT_DIR} TIW_PLACES_FILE=${PLACES_FILE} TIW_BUILD_DATE=${BUILD_DATE} ` +
      `npm run start -- --port ${PORT}`,
    url: BASE_URL,
    /** Same reason as the other config: attaching to a stranger costs the point. */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
