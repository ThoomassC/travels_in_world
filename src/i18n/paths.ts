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
 * The `id` of one country's section inside the full listing — the other half of
 * {@link tripsCountryPath}, and the reason both live here rather than each on its
 * own side.
 *
 * The map's textual equivalent (TIW-15) links a country to the group of trips
 * that country holds, and that group is a `<section>` of `/voyages` rendered by
 * `TripCatalogue`. A fragment is part of a URL, so it falls under this module's
 * rule: one definition for an address someone may already have in their history.
 *
 * The alternative — spelling `pays-${code}` on both sides — is the mistake
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` records for `voyage-<slug>`,
 * where the two spellings are hand-duplicated and held together by a test alone.
 * A fragment that matches nothing does not fail: the browser silently leaves the
 * reader at the top of a page of sixty trips, which is a promise the link made
 * and the document did not keep.
 *
 * Lowercased because a fragment is compared byte for byte by every browser while
 * ISO 3166-1 alpha-2 is uppercase by schema, and a lowercase URL is what the rest
 * of this site's addresses look like.
 */
export function countryAnchor(code: string): string {
  return `pays-${code.toLowerCase()}`;
}

/**
 * The full listing, addressed at the country the reader asked about.
 *
 * Not a separate route, deliberately: `/voyages` is prerendered once and already
 * groups by country, so a per-country page would be a second rendering of the
 * same content — and this ticket's whole posture is to *link* the map to that
 * inventory rather than duplicate it.
 */
export function tripsCountryPath(code: string): string {
  return `${tripsPath()}#${countryAnchor(code)}`;
}
