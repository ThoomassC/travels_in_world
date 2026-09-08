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

/**
 * The countries the carnet has been to (TIW-39) — the index, and one page per
 * country under it.
 *
 * French, in every locale, like every other segment of this site:
 * `src/i18n/routing.ts` records at length why the segments are not translated and
 * what declaring a `pathnames` map would cost.
 *
 * **TOP-LEVEL, and deliberately not `/voyages/pays`**, for the reason
 * {@link placesPath} gives about `/villes`: the trip segment already owns a
 * `[slug]` route, so a static folder under it would shadow, for good and in
 * silence, any trip whose slug matched it. A country is not an item of the
 * collection of trips either.
 */
export const COUNTRY_SEGMENT = "pays";

/**
 * The index of the visited countries — the destination of the « Pays » entry in
 * the main navigation since TIW-39, where it used to point at {@link tripsPath}.
 *
 * The two pages are peers and not duplicates: this one answers "which countries,
 * and how much of each", `/voyages` answers "every trip, grouped". The entry that
 * used to name the second with the first one's word is what made three names for
 * one thing; there are now two things and two names.
 */
export function countriesPath(): string {
  return `/${COUNTRY_SEGMENT}`;
}

/** One country's page. The slug is {@link countrySlug}'s, never a raw ISO code. */
export function countryPath(slug: string): string {
  return `/${COUNTRY_SEGMENT}/${slug}`;
}

/** The alphabet a country slug is allowed, and it is `SlugSchema`'s. */
const COUNTRY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A country's address, folded from its **French** name — `Grèce` → `grece`,
 * `Côte d’Ivoire` → `cote-d-ivoire`.
 *
 * **The French name in every locale**, so `/en/pays/espagne` and `/es/pays/espagne`
 * are the same address as `/fr/pays/espagne`. Same decision, same reason, as
 * `TRIP_SEGMENT` above: one URL per page, and the site is French.
 *
 * **The name is ICU's, so this string can move without anybody touching this
 * repository** — and that is the one thing to know before reading further.
 * `Intl.DisplayNames` answers from the ICU data bundled with the Node the build
 * runs on, and ICU renames regions: `Macédoine` became `Macédoine du Nord`,
 * `Swaziland` became `Eswatini`. A rename moves the URL of a country somebody has
 * already linked to, with a green build and nothing to say so — the exact failure
 * `./slug-history.ts` refuses for trips.
 *
 * The parade is {@link PUBLISHED_COUNTRY_SLUGS} below: the slugs already published
 * are frozen there, {@link countrySlugsByCode} compares every derivation against
 * it and throws during `next build`, and `tests/i18n/paths.test.ts` re-derives the
 * register from the runtime's own ICU so the alarm also rings in CI.
 *
 * Throws rather than returning `""` for a name that folds to nothing: the empty
 * slug is `/fr/pays/`, which is the index — a country page silently served at the
 * address of the list of countries.
 */
export function countrySlug(frenchName: string): string {
  const folded = frenchName
    // NFD splits an accented letter into its base and its combining mark; the
    // range below is exactly the combining marks, so `é` becomes `e` and a
    // letter with no decomposition is left alone.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Everything that is not the slug alphabet becomes one hyphen — the
    // apostrophe of `Côte d’Ivoire`, the space of `Îles Åland`, the hyphen of
    // `Bosnie-Herzégovine`, which collapses with its neighbours rather than
    // doubling.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!COUNTRY_SLUG_PATTERN.test(folded)) {
    throw new Error(
      `countrySlug : « ${frenchName} » ne se réduit pas à un slug utilisable (« ${folded} »). Une adresse vide est celle de l'index des pays.`
    );
  }

  return folded;
}

/**
 * The country addresses this site has already published, frozen.
 *
 * **This is the register `./slug-history.ts` is to trips**, and it exists for the
 * same reason: a URL that has been shared is a promise, and the failure it guards
 * is not deletion — deletion is loud — but the silent move. Here the mover is not
 * a person renaming a folder; it is an `npm install` or a Node upgrade shipping a
 * new ICU.
 *
 * **A code that is NOT here is accepted**, and that asymmetry is the whole
 * design: an unregistered country is one this site has never published a page
 * for, so no link to it can exist yet and its derived slug is by definition
 * correct. A registered one whose derivation no longer matches is a promise
 * broken, and {@link countrySlugsByCode} refuses the build.
 *
 * TO ADD A COUNTRY: run the build, take the slug it derives, and write the line.
 * TO CHANGE ONE: don't — that is the mistake this file exists to make loud. If a
 * country really must move, the entry stays and a redirect is owed to the old
 * address, exactly as `./slug-history.ts` describes for a renamed trip.
 *
 * Sorted by code, so a duplicate is visible by reading.
 */
export const PUBLISHED_COUNTRY_SLUGS: Readonly<Record<string, string>> = {
  BE: "belgique",
  CH: "suisse",
  ES: "espagne",
  FR: "france",
  GR: "grece",
};

/**
 * The slug of every country a set of codes names, keyed by code — the one
 * derivation the country pages, their index and `sitemap.xml` share, so the three
 * cannot disagree about an address.
 *
 * The French name arrives as a function for the reason every arranging module of
 * this project takes its labels that way: this module is loaded by
 * `next.config.ts` (through `./slug-history.ts`), which Next evaluates before the
 * `@/` aliases exist, so it imports nothing at all — an `Intl.DisplayNames` here
 * would be a dependency a config file has no business loading.
 *
 * **Two failures are refused rather than resolved**, and both would otherwise be
 * invisible:
 *
 * - a registered country whose derivation has moved (see
 *   {@link PUBLISHED_COUNTRY_SLUGS}) — the old address 404s and the new one works,
 *   which reads like a fixed page and is a broken link;
 * - two countries folding to one slug — one page would be built, the other
 *   dropped, and which of them survives depends on iteration order.
 *
 * Insertion order is the caller's, deduplicated; every consumer that renders a
 * list sorts by the reader's collation on its own.
 */
export function countrySlugsByCode(
  codes: readonly string[],
  frenchNameOf: (code: string) => string
): ReadonlyMap<string, string> {
  const byCode = new Map<string, string>();
  const bySlug = new Map<string, string>();

  for (const code of codes) {
    if (byCode.has(code)) {
      continue;
    }

    const name = frenchNameOf(code);
    const slug = countrySlug(name);
    const frozen = PUBLISHED_COUNTRY_SLUGS[code];

    if (frozen !== undefined && frozen !== slug) {
      throw new Error(
        `Le pays ${code} est publié à l'adresse « ${countryPath(frozen)} », et son nom français (« ${name} ») donne aujourd'hui « ${countryPath(slug)} ». ` +
          `Les données ICU de ce runtime ont bougé : garde l'entrée ${code} de PUBLISHED_COUNTRY_SLUGS et ajoute une redirection vers la nouvelle adresse, ou reviens à la version d'ICU qui donnait l'ancienne.`
      );
    }

    const claimed = bySlug.get(slug);
    if (claimed !== undefined) {
      throw new Error(
        `Les pays ${claimed} et ${code} revendiquent tous deux l'adresse « ${countryPath(slug)} » (« ${name} ») : une seule page serait construite, et laquelle dépendrait de l'ordre de parcours.`
      );
    }

    byCode.set(code, slug);
    bySlug.set(slug, code);
  }

  return byCode;
}
