import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FacetFilter } from "@/components/filters/facet-filter";
import { buildFacetIndex, byLabel } from "@/components/filters/facets";
import { placeIdentity, repeatedStayCount, tallyVisitedPlaces } from "@/components/places/places";
import { PAGE_MARK } from "@/components/site/site-nav";
import { collatorFor, countryNameOf } from "@/components/trips/format";
import { loadTrips } from "@/content/trips";
import { localePathname } from "@/i18n/pathname";
import { placesPath, tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { shareMetadata } from "../../share";
import { MAIN_CONTENT_ID } from "../main-content";
import styles from "./page.module.css";

type LocaleParams = { locale: string };

/**
 * The journal's cities and places: every place the published trips reach, how
 * many stays each one holds, and a way into them.
 *
 * **What this page is for, and why `/voyages` does not already do it.** The
 * catalogue files a trip under the country its *first step arrives in*, so a
 * place a trip merely passes through has no heading anywhere on the site —
 * `buildCatalogue` records that trade-off, and this page is the other half of it.
 * Countries are too coarse a grain to stand in: five countries over fourteen
 * places answers "which flags" and not "where has he been".
 *
 * **The label is "Villes" and the sentence says "villes et lieux", deliberately.**
 * The owner named the entry, and Corse and Noirmoutier are not cities. Rather
 * than rename what he named, the heading keeps his word and the introduction
 * carries the nuance, so the count above the list is true of the list under it.
 *
 * **The filter above the list is a group of radio buttons and a generated
 * stylesheet**, with no client boundary — the argument is in
 * `src/components/filters/facets.ts`. One axis here and two on `/voyages`,
 * because a place carries one fact this journal can filter on: its country. The
 * number of stays would be the other candidate and every place holds exactly one
 * today, so `buildFacetIndex` would drop it; offering it would be the "filtre
 * dont toutes les valeurs sauf une sont vides" a listing must not have.
 *
 * **Rendered by the server, readable with JavaScript disabled**, like the
 * catalogue it sits beside: no `'use client'` anywhere in this tree, no
 * `next/image`, and plain anchors rather than `Link` from `@/i18n/navigation` —
 * the last one is what would ship next-intl's client `Link` to a page made
 * entirely of anchors (measured at 3.8 KB brotli and two chunks on `/fr`; see
 * `docs/adr/0005-getpathname-sans-le-link-client.md`).
 *
 * **`/villes` and not `/voyages/villes`** — `src/i18n/paths.ts` holds the reason,
 * and it is not a preference: a static segment under `[slug]` shadows a trip
 * whose slug matches it, for good and in silence.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  /**
   * `getTranslations({ locale, namespace })` and never the implicit
   * `getTranslations(namespace)`. Inside `[locale]` the implicit form is safe
   * once `setRequestLocale` has run — but `generateMetadata` runs *before* the
   * component, so there is no request locale set yet, and next-intl would read
   * the request headers to find one. A single such read turns the whole route
   * tree dynamic with `next build` still exiting 0, which is invariant 1 breaking
   * in silence. Same reasoning, at length, in `src/app/not-found.tsx`.
   */
  const t = await getTranslations({ locale, namespace: "places" });
  const site = await getTranslations({ locale, namespace: "metadata" });

  /**
   * `shareMetadata`, and the canonical is the point: the locale layout's
   * canonical is the *home page's*, so a page declaring none would ask a crawler
   * to drop this one in favour of `/fr`. `tests/build/durable-urls.test.ts`
   * refuses exactly that, and it is also what keeps `placesPath()` agreeing with
   * this folder's name.
   *
   * No share image, for the reason the catalogue gives: this page is an index,
   * and the only pictures the project holds are the trips' own photographs.
   * Promoting one of them here would put a single trip's picture on the card of
   * the whole journal.
   */
  return shareMetadata({
    locale,
    href: placesPath(),
    title: t("metaTitle"),
    description: t("metaDescription"),
    siteName: site("title"),
    type: "website",
  });
}

export default async function PlacesPage({ params }: { params: Promise<LocaleParams> }) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  /**
   * **`loadTrips()` and not `listTripSummaries()`**, which is the one unusual
   * call on this page and the reason it is annotated.
   *
   * `TripSummary` carries `countryCodes` and the single `firstArrival`; the full
   * list of a trip's places lives on `TripDetail` alone. The alternative was to
   * widen the summary, which would put a field on every listing in the project —
   * the map's markers, the cards, the feed — to serve one page. The façade
   * memoises its parse for the whole build and both doors project from the same
   * parsed trips, so the extra cost here is a projection and never a second read
   * of the disk.
   *
   * Untold trips are included, deliberately: a journey whose récit is not written
   * still happened, its countries are tinted on the map and its entry is in the
   * catalogue. The places it reached belong on this page for the same reason.
   */
  const trips = await loadTrips();
  const t = await getTranslations("places");

  /**
   * The naming and the collation come from the listing's own helpers, so a
   * country reads the same here, on `/voyages` and under the map — and so
   * `tallyVisitedPlaces` stays a pure function that knows no locale and no
   * `Intl`, which is what makes its boundary cases cheap to assert.
   */
  const places = tallyVisitedPlaces(trips, {
    countryName: (code) => countryNameOf(locale, code),
    compare: collatorFor(locale).compare,
  });

  /**
   * The choices above the list, keyed on the same identity the rows are keyed on
   * — `placeIdentity`, so a row and its tokens cannot come apart. The country's
   * name is the one the tally has already resolved, which is why nothing is
   * looked up twice and why a country reads the same on a pill and on the row
   * under it.
   */
  const facets = buildFacetIndex(
    places.map((place) => ({
      key: placeIdentity(place),
      facets: [{ group: "country", value: place.countryCode, label: place.countryName }],
    })),
    [{ key: "country", legend: t("filterCountry"), compare: byLabel(collatorFor(locale).compare) }]
  );

  /**
   * Absent rather than empty when there is nothing to choose: with one country in
   * the journal `FacetFilter` renders no control, and a `data-facets` attribute no
   * rule reads would be markup that says a filter exists.
   */
  const facetTokens = facets.groups.length === 0 ? undefined : facets.tokens;

  return (
    /*
      The landing point of the layout's skip link — the same `id` and the same
      `tabIndex={-1}` as every other page, from the same constant. See
      `../layout.tsx` for why the attribute is needed and why the `id` cannot
      live in the layout.

      `data-page` marks this page for the header's current-entry underline — the
      same mechanism, and the same limits, as the other three; the long note is
      on the home page's `<main>` and in `SiteNav`'s header.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1} data-page={PAGE_MARK.places}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("heading")}</h1>
        {/*
          The count is announced only when there is something to count, the same
          call the catalogue takes: with no place the section below says so in
          words, and a "0 lieu" line above nothing is exactly the empty block the
          acceptance criteria refuse.
        */}
        {places.length > 0 ? (
          <p className={styles.intro}>{t("intro", { count: places.length })}</p>
        ) : null}
      </header>

      {places.length === 0 ? (
        <section className={styles.empty}>
          <h2>{t("emptyHeading")}</h2>
          <p className={styles.emptyBody}>{t("emptyBody")}</p>
          {/*
            A way out, not just an apology. This page is reachable from the main
            navigation on every page of the site, so a reader can land here first
            — and an empty page with no link is a dead end.
          */}
          <a className={styles.emptyLink} href={localePathname({ href: "/", locale })}>
            {t("emptyBackHome")}
          </a>
        </section>
      ) : (
        <FacetFilter
          id="filtre-lieux"
          name="filtre-lieux"
          legend={t("filterLegend")}
          allLabel={t("filterAll")}
          index={facets}
          countLabel={(count) => t("filterCount", { count })}
          statusLabel={(count) => t("filterShowing", { count })}
        >
          <ul
            className={styles.list}
            /*
            `role="list"` is redundant markup that is not redundant in practice:
            `list-style: none` strips the list role in Safari with VoiceOver, and
            a list that has lost its role has also lost its item count — the one
            thing a reader entering fourteen places wants first. jsdom keeps the
            role either way, so no unit test can see this. The same note is on the
            map's marker list and on the catalogue's grids.
          */
            role="list"
          >
            {places.map((place) => {
              /**
               * **Where a row leads, and why it is a fragment here when the
               * map's country list refused one.**
               *
               * That list — removed in September 2026, its finding kept in the
               * header of `tests/e2e/dead-links.populated.spec.ts` — measured
               * `/fr/voyages#pays-xx` dangling, because the catalogue emits a
               * country section only for a country a trip *arrives* in. `#voyage-<slug>` is a different promise: the
               * catalogue puts that id on **every** entry it renders, and it
               * renders every published trip — untold ones included. So the
               * fragment cannot dangle for the same reason the other one could.
               *
               * It is also why there is no `hasStory` branch on this page. Pointing
               * at `tripPath(slug)` would have needed one — an untold trip has no
               * page — and the entry in the catalogue is the better target anyway:
               * it is where that trip's dates, countries and « Récit à venir » are
               * actually written.
               *
               * A place holding several trips points at the listing whole. The
               * pre-existing rule the country rows already pay for: a row
               * announcing "3 séjours" must not silently name one of them (2.4.4).
               */
              const identity = placeIdentity(place);
              const [onlyTrip] = place.tripSlugs;
              const href =
                place.tripSlugs.length === 1 && onlyTrip !== undefined
                  ? `${tripsPath()}#voyage-${onlyTrip}`
                  : tripsPath();

              // `null` for a place visited once, which is thirteen of the
              // fourteen: see `repeatedStayCount` for why the number is dropped
              // rather than repeated down the page.
              const stays = repeatedStayCount(place);

              return (
                /*
                The key is the row's identity and not the place's name: two
                places may share a name in two countries, and `tallyVisitedPlaces`
                keeps them apart for a reason its `identityOf` records. A key on
                the name alone would be a duplicate key React resolves silently.
              */
                <li key={identity} data-facets={facetTokens?.get(identity)}>
                  {/*
                  One link per row holding all three facts, and not a link around
                  the name with the country and the count beside it. A screen
                  reader announces the link and not its neighbours, so anything
                  left outside would be a fact the keyboard never hears — the same
                  call, and the same argument, as the country rows under the map.

                  The explicit spaces between the spans are load-bearing: whether
                  two sibling flex items contribute a separator to an accessible
                  name is up to the engine, and measured under jsdom the markup
                  without them gives "KyotoJapon1 séjour". A whitespace-only text
                  node between two flex items is not laid out as an anonymous flex
                  item, so `gap` still owns the visual spacing.
                */}
                  <a className={styles.link} href={localePathname({ href, locale })}>
                    <span className={styles.name}>{place.name}</span>{" "}
                    <span className={styles.country}>{place.countryName}</span>
                    {/*
                      **The count is printed only when it is above one**, and that
                      is a reading of what a column says rather than a saving of
                      pixels. Thirteen of the fourteen places in this journal hold
                      exactly one stay, so « 1 séjour » was set thirteen times down
                      the page: a value that never varies carries no information,
                      it only teaches the eye to skip the line it sits on. Left
                      only where it differs, the number becomes what it always
                      meant — *this* place, you went back to.

                      The plural branch of `places.placeTrips` therefore stays and
                      its singular branch stops being rendered. The key keeps both:
                      the message is what the language does with a count, and a
                      catalogue that dropped the singular would be a catalogue
                      lying about French.
                    */}
                    {stays === null ? null : (
                      <>
                        {" "}
                        <span className={styles.trips}>{t("placeTrips", { count: stays })}</span>
                      </>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </FacetFilter>
      )}
    </main>
  );
}
