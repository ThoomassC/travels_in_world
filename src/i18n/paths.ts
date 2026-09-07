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
 * **The second and third locales arrived in TIW-38 and this segment stayed
 * French, deliberately.** This note used to say the day `en` was activated the
 * segment would become a `pathnames` entry; the day came, and the trade did not
 * change: declaring `pathnames` changes the type of `Link` and `getPathname`
 * across the whole project and invalidates the fork in `src/i18n/pathname.ts`,
 * which is what keeps next-intl's client `Link` off every route.
 *
 * What that costs, stated rather than discovered: `/en/voyages/crete` reads
 * `voyages`, not `trips`. It is one French word in an address whose story is in
 * French anyway. Re-open it the day the stories themselves are translated —
 * that, and not the number of locales, is the signal.
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

/**
 * The index of the journal's cities and places (TIW-38) — the third entry of the
 * main navigation, between the countries listing and the colophon.
 *
 * **TOP-LEVEL, and deliberately not `/voyages/villes`.** The trip segment already
 * owns a `[slug]` route, so a static `villes` folder under it would shadow, for
 * good, any trip whose slug is `villes` — Next resolves a static segment before a
 * dynamic one, silently and with a green build. A collection of places is not an
 * item of the collection of trips either, so nesting it would have been a URL
 * claiming a containment that does not hold.
 *
 * French, like {@link aboutPath} and {@link TRIP_SEGMENT}, in every locale:
 * `src/i18n/routing.ts` records at length why the segments are not translated and
 * what declaring a `pathnames` map would cost.
 *
 * A function and not a constant, so the four paths of this module read alike at
 * every call site.
 *
 * WHAT KEEPS IT AGREEING WITH THE FOLDER NAME: the same guard `aboutPath` names
 * above — `tests/build/durable-urls.test.ts` reads every prerendered document and
 * compares its canonical with its own URL, and it holds `sitemap.xml` and the
 * prerendered set to each other in both directions. A value that stopped matching
 * `src/app/[locale]/villes/` makes that suite red rather than shipping a
 * navigation entry pointing at nothing.
 */
export function placesPath(): string {
  return "/villes";
}
