import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * The fixture's photographs, copied into the repository's own `public/` for the
 * duration of a performance run — and removed again afterwards.
 *
 * **Why this exists at all.** `playwright.content.config.ts` serves a build of
 * `tests/fixtures/content/home-map` through `TIW_CONTENT_DIR`, and its own header
 * records the limit: `next start` serves the repository's `public/`, no
 * configuration moves that, so the fixture's photographs 404 in the browser.
 * `photo-viewer.populated.spec.ts` works within that deliberately — every element
 * and every box is real, only the decoding of an AVIF is not.
 *
 * A Largest Contentful Paint cannot work within it. The trip page's cover is the
 * biggest element above the fold; measuring LCP with that request answering 404
 * would report the time of whatever text is next in line, which is *faster* than
 * the real page. That is a false green, and it is the one this ticket is supposed
 * to find rather than produce. So the bytes are put where the server looks.
 *
 * **Why the copy happens in the `webServer` command and not in `globalSetup`.**
 * Measured, in `node_modules/playwright/lib/runner/index.js:6003` —
 * `createGlobalSetupTasks` returns `[...createPluginSetupTasks(config),
 * ...globalSetups]`, and the web server is one of those plugins. So `globalSetup`
 * runs *after* `next start` is already listening, which is too late: Next
 * enumerates `public/` when the server starts. `globalTeardown` has no such
 * ordering problem and is where the removal lives.
 *
 * Eight files, 68 KB, untracked for the length of one run — `check:photo-weight`
 * asks `git ls-files`, so they are invisible to the repository's weight budget.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

/** The fixture's own `public/photos/<slug>`, and the slug it is filed under. */
const FIXTURE_SLUG = "japon-2024";
const FIXTURE_PHOTOS = path.join(
  REPOSITORY_ROOT,
  "tests/fixtures/content/home-map/public/photos",
  FIXTURE_SLUG
);

const PUBLIC_PHOTOS = path.join(REPOSITORY_ROOT, "public/photos");
const INSTALLED = path.join(PUBLIC_PHOTOS, FIXTURE_SLUG);

/**
 * Copies the fixture's photographs under `public/photos/`, refusing rather than
 * overwriting.
 *
 * The refusal is the interesting half. `content/trips/` is empty until TIW-24;
 * the day a real trip named `japon-2024` ships its own photographs, this copy
 * would shadow them, the teardown below would delete them, and the loss would
 * look like a git accident. Failing here says exactly what happened instead.
 */
export function installFixturePhotos(): void {
  if (!existsSync(FIXTURE_PHOTOS)) {
    throw new Error(
      `Les photos de fixture sont introuvables à ${FIXTURE_PHOTOS} : la configuration de perf sert tests/fixtures/content/home-map et mesure le LCP sur sa couverture.`
    );
  }

  if (existsSync(INSTALLED)) {
    throw new Error(
      `${INSTALLED} existe déjà. La mesure de performance y copie les photos de la fixture et les supprime après ; elle refuse d'écraser des fichiers qu'elle n'a pas posés. Vide ce dossier, ou fais pointer la fixture ailleurs.`
    );
  }

  mkdirSync(PUBLIC_PHOTOS, { recursive: true });
  cpSync(FIXTURE_PHOTOS, INSTALLED, { recursive: true });
}

/**
 * Removes exactly what {@link installFixturePhotos} put there, and nothing else:
 * the one slug's folder, then `public/photos` itself only if it is now empty.
 * Derived from the disk rather than from state shared between two Playwright
 * phases, so an interrupted run leaves nothing that a later one misreads.
 */
export function removeFixturePhotos(): void {
  rmSync(INSTALLED, { recursive: true, force: true });

  if (existsSync(PUBLIC_PHOTOS) && readdirSync(PUBLIC_PHOTOS).length === 0) {
    rmdirSync(PUBLIC_PHOTOS);
  }
}

/**
 * The command-line half, invoked by `webServer.command` before `next build`.
 *
 * `process.argv[1]` rather than `import.meta.main`: the latter needs Node 24.2,
 * and `.nvmrc` pins a major and not a minor.
 */
if (path.basename(process.argv[1] ?? "") === "fixture-photos.ts") {
  installFixturePhotos();
  process.stdout.write(`Photos de fixture installées dans ${INSTALLED}\n`);
}
