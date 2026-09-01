/**
 * The internal routes that are named by something other than the file they live
 * in. One module, so a URL that is already in someone's history has exactly one
 * definition in the codebase.
 *
 * This is *not* a replacement for `@/i18n/navigation`: the paths here are
 * locale-agnostic, and it is `getPathname` that turns one into the `/fr/…` a
 * browser can follow. Keeping the two apart is what lets a Server Component
 * build a href without ever reading a request header — the locale arrives as a
 * prop, never as ambient state.
 */

/**
 * The first segment of a trip's URL. French, and deliberately not the English
 * `slug` used inside the content directory: this string is what a visitor reads
 * and what search engines index, and the site is French.
 *
 * The day a second locale is activated, this becomes a `pathnames` entry in
 * `src/i18n/routing.ts` so the segment itself can be translated. It is not one
 * today because declaring `pathnames` changes the type of `Link` and
 * `getPathname` across the whole project, for a benefit that only exists once
 * `en` is real — and `tests/smoke.test.tsx` holds the alarm that goes red on
 * that day.
 */
export const TRIP_SEGMENT = "voyages";

/**
 * The canonical path of a trip page, without a locale prefix.
 *
 * TIW-16 creates the page this points at, and must read the segment from here
 * rather than write `"voyages"` a second time — the map (TIW-13) already links
 * to these URLs, so the two spellings drifting apart means a dead link on the
 * home page with nothing failing to say so.
 */
export function tripPath(slug: string): string {
  return `/${TRIP_SEGMENT}/${slug}`;
}

/**
 * The full listing — the index of the collection {@link tripPath} addresses an
 * item of, and the second entry of the main navigation.
 *
 * It is a function rather than a constant so that the two paths of this module
 * read alike at every call site, and so that the day `TRIP_SEGMENT` becomes a
 * translated `pathnames` entry there is one shape to change and not two.
 */
export function tripsPath(): string {
  return `/${TRIP_SEGMENT}`;
}

/**
 * The colophon — who made this site and how — and the third entry of the main
 * navigation (TIW-25).
 *
 * French, and deliberately not `/about`: same reason as `TRIP_SEGMENT` above, this
 * string is what a visitor reads and what a crawler indexes, and the site is
 * French. It has no segment constant of its own because nothing else composes it —
 * `tripPath` and `tripsPath` share `TRIP_SEGMENT` because they address an item and
 * its collection; this page is one address.
 *
 * WHAT KEEPS IT AGREEING WITH THE FOLDER NAME, since a mismatch here is a 404 that
 * nothing in `src/` would notice: `tests/build/durable-urls.test.ts` reads every
 * prerendered document and compares its canonical with its own URL. The page builds
 * its canonical from this function, so a value that stopped matching
 * `src/app/[locale]/a-propos/` would make that suite red rather than ship a
 * navigation entry pointing at nothing.
 */
export function aboutPath(): string {
  return "/a-propos";
}
