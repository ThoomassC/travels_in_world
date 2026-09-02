import type { MetadataRoute } from "next";
import { listTripSummaries } from "@/content/trips";
import { hasStory } from "@/domain/trip";
import { localePathname } from "@/i18n/pathname";
import { aboutPath, tripPath, tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { absoluteUrl } from "./site-url";

/**
 * `/sitemap.xml`, and it lists **published trips only**.
 *
 * That is not a filter written here: `listTripSummaries()` is the content façade,
 * which already removes drafts — the same call, with the same answer, as the home
 * page and the listing. A sitemap that decided publication for itself would be a
 * second publication rule, and two rules are how a draft ends up advertised to a
 * crawler by the one file nobody reads. `tests/build/drafts.test.ts` reads the
 * built artefacts and would catch the leak; not having a second rule is what makes
 * it unable to happen.
 *
 * WITHDRAWN AND RENAMED ADDRESSES ARE ABSENT, for free and for two different
 * reasons worth separating. A withdrawn trip has no `trip.yaml` any more, so the
 * façade cannot return it. A renamed trip returns under its *new* slug only, which
 * is the only address that should be advertised — the old one exists as a 301 for
 * the links already sent, and putting a redirect in a sitemap asks a crawler to
 * index a hop.
 *
 * **This route is prerendered.** It is a Route Handler, and Next caches it at build
 * time unless it reads a request-time API; it reads the disk and `process.env`,
 * neither of which is one. Verify in `npm run build`: `○ /sitemap.xml`, never `ƒ`.
 */

/**
 * A page's absolute URL in every active locale, with the `hreflang` alternates
 * that a multilingual sitemap needs — and without them while there is one locale.
 *
 * The alternates are emitted only from the second locale on. With one active
 * locale the block would be `<xhtml:link hreflang="fr" href="…"/>` next to the very
 * `<loc>` it points at, which says nothing and adds a line per URL. The shape is
 * already right for the day `en` is activated: `routing.locales` grows and this
 * function starts emitting pairs, with no diff here.
 */
function localisedEntry(
  path: string,
  lastModified: string | undefined
): readonly MetadataRoute.Sitemap[number][] {
  const byLocale = new Map<Locale, string>(
    routing.locales.map((locale) => [locale, absoluteUrl(localePathname({ href: path, locale }))])
  );

  const alternates =
    routing.locales.length > 1
      ? { languages: Object.fromEntries(byLocale) as Record<string, string> }
      : undefined;

  return [...byLocale.values()].map((url) => ({
    url,
    ...(lastModified === undefined ? {} : { lastModified }),
    ...(alternates === undefined ? {} : { alternates }),
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const trips = await listTripSummaries();

  /**
   * `lastModified` is the trip's **end date**, and the honest reading of that
   * choice is that it is a proxy: nothing in this project records when a `trip.yaml`
   * was last edited, and a `Date` taken at build time would stamp every URL with
   * the deployment's clock — telling a crawler that sixty stories changed because
   * one did. The end date is wrong in one direction only (a story edited after the
   * trip looks older than it is) and it is stable across rebuilds, which is the
   * property that matters: a sitemap whose dates move on every deploy is a sitemap
   * a crawler stops believing.
   *
   * The collection arrives ordered by `startDate` descending, so the two index
   * pages take the most recent trip's end date — they are lists, and what changes
   * them is a trip arriving.
   */
  const mostRecentEnd = trips[0]?.endDate;

  return [
    ...localisedEntry("/", mostRecentEnd),
    ...localisedEntry(tripsPath(), mostRecentEnd),
    /**
     * The colophon (TIW-25), and it is here because it has to be: every
     * reader-facing prerendered page must appear in this file, and
     * `tests/build/durable-urls.test.ts` compares the two sets in both directions.
     * A page absent from the sitemap is a page nobody finds.
     *
     * **No `lastModified`, and that is the honest answer rather than a shortcut.**
     * The two entries above take the most recent trip's end date because what
     * changes a list is a trip arriving; this page changes when its *code* changes,
     * and nothing in this project records that date. A build-time `Date` would
     * stamp it with the deployment's clock and tell a crawler it changed on every
     * deploy — which is exactly how a sitemap stops being believed.
     * `localisedEntry` omits the element entirely for `undefined`.
     */
    ...localisedEntry(aboutPath(), undefined),
    /**
     * **The trips that have a page, and not every trip in the list** (TIW-18).
     *
     * `tripStaticParams` leaves an untold trip out of the build, so its address is
     * an immediate 404 — and a sitemap is a *promise* that an address exists.
     * `tests/build/durable-urls.test.ts` compares this set against the prerendered
     * pages in both directions, so the mistake in either direction is caught: a
     * page absent from here, and a URL advertised here with no page behind it.
     *
     * Note what is deliberately **not** filtered: `mostRecentEnd` above still reads
     * the whole collection. The two index entries take their date from "what
     * changes a list is a trip arriving", and an untold trip does arrive in the
     * listing — it is rendered there, with its dates and its countries. Only its own
     * address is missing.
     */
    ...trips.filter(hasStory).flatMap((trip) => localisedEntry(tripPath(trip.slug), trip.endDate)),
  ];
}
