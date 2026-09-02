import { removeFixturePhotos } from "./fixture-photos";

/**
 * Takes the fixture's photographs back out of `public/`.
 *
 * A separate file because Playwright's `globalTeardown` wants a default export,
 * and `./fixture-photos` is imported by the command line too — where a default
 * export would be one more thing to explain.
 */
export default function globalTeardown(): void {
  removeFixturePhotos();
}
