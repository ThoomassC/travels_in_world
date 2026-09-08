import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { collatorFor, countryNameOf } from "@/components/trips/format";
import { TripCard } from "@/components/trips/trip-card";
import cardStyles from "@/components/trips/trip-card.module.css";
import { listTripSummaries, loadTrips } from "@/content/trips";
import type { TripDetail } from "@/content/trips";
import { freshestTrip } from "@/domain/freshness";
import { localePathname } from "@/i18n/pathname";
import { countriesPath, countryPath, countrySlugsByCode, tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { countryTile, TILE_BOX } from "@/map";
import { buildDay } from "../../../build-day";
import { shareMetadata } from "../../../share";
import { PAGE_MARK } from "@/components/site/site-nav";
import { MAIN_CONTENT_ID } from "../../main-content";
import { countryPlaces, countryTrips, isFiledUnder, placeMarks } from "../country";
import type { CountryPlace, PlaceMark } from "../country";
import styles from "./page.module.css";

/**
 * One country's page: what the carnet holds of it — its trips, its cities, and
 * its own silhouette with those cities placed on it.
 *
 * **THIS PAGE EXISTS FOR COUNTRIES WHOSE EVERY TRIP IS UNTOLD, AND THAT IS NOT AN
 * EXCEPTION TO TIW-18.** All five countries are in that state today: thirteen
 * journeys, not one récit written. TIW-18's rule is that a *récit* which is not
 * written has no page — `tripStaticParams` leaves it out of the build so
 * `/voyages/<slug>` is an immediate 404, and nothing links to an address that
 * does not exist. A country page is not a récit: it is a **list**, exactly like
 * `/voyages` and `/villes`, both of which render untold trips today and always
 * have. What TIW-18 refuses is a page that promises a story and has none; what
 * this page promises is an inventory, and the inventory is real — seven journeys
 * in France, seven towns, drawn where they are. The day a récit is written, this
 * page gains a link to it and changes in no other way.
 *
 * **No planisphere, and that is the ticket's own measurement.** The world's paths
 * weigh 30.1 KB brotli in a document (budgeted at 34 in `tests/map/world.test.ts`)
 * and 186 KB uncompressed; five more pages in three languages is fifteen
 * documents carrying a drawing of the whole earth to show one country. The map
 * here is the country fitted to its own 40-unit frame by `@/map`'s `countryTile`
 * — 3.3 KB of `d` for all five, France at 658 bytes — with a dot per city placed
 * by that same projection. It is the drawing the search's suggestions already
 * carry, at a size a reader can actually read: the geometry is vectorial, so
 * "bigger" costs nothing but CSS.
 *
 * **`dynamicParams = false`, like the trip page**, and it closes the same door:
 * being absent from `generateStaticParams` is not by itself a 404 under the App
 * Router's defaults — an unknown slug would be rendered on demand, which turns a
 * typo into a server function reading the disk. With this line
 * `/fr/pays/patagonie` answers 404 immediately, creates no ISR entry and reads no
 * file.
 */
export const dynamicParams = false;

/** The radius of a city's dot, in tile units — see the note at {@link CountrySilhouette}. */
const PLACE_DOT_RADIUS = 1.15;

type CountryPageParams = { locale: string; slug: string };

type CountryPageProps = { params: Promise<CountryPageParams> };

/**
 * The French name of a country, which is what every country slug is folded from
 * — in every locale. `@/i18n/paths` carries the argument and the ICU register
 * that keeps a published address from moving on its own.
 */
const frenchNameOf = (code: string): string => countryNameOf("fr", code);

/**
 * Only `{ slug }`: the parent `[locale]` layout already generates the locales,
 * and Next runs a child's `generateStaticParams` once per set of params the
 * parent produced. Returning the locale here as well would multiply the routes by
 * the number of locales twice over.
 *
 * Built from `listTripSummaries()` and not `loadTrips()`: the summary carries
 * `countryCodes`, which is the whole of the question here, and the façade
 * memoises the parse either way.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const trips = await listTripSummaries();
  const slugs = countrySlugsByCode(
    trips.flatMap((trip) => trip.countryCodes),
    frenchNameOf
  );

  return [...slugs.values()].sort().map((slug) => ({ slug }));
}

/**
 * Everything this route reads, resolved once — the country, its trips, its
 * cities — so that `generateMetadata` and the component cannot disagree about a
 * count.
 */
type CountryPageState = {
  readonly locale: Locale;
  readonly code: string;
  readonly name: string;
  readonly slug: string;
  readonly trips: readonly TripDetail[];
  readonly places: readonly CountryPlace[];
  readonly allTrips: readonly TripDetail[];
};

async function loadCountry(params: Promise<CountryPageParams>): Promise<CountryPageState> {
  const { locale, slug } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const allTrips = await loadTrips();
  const slugs = countrySlugsByCode(
    allTrips.flatMap((trip) => trip.countryCodes),
    frenchNameOf
  );

  /**
   * The slug is resolved against the countries the carnet actually reaches, and
   * never parsed back into a code. A reverse fold would accept `/pays/japon`
   * before Japan is visited — a page with an empty list at an address that reads
   * as real. `dynamicParams = false` already refuses the request; this is what
   * makes the same answer true when the route is reached any other way.
   */
  const found = [...slugs].find(([, candidate]) => candidate === slug);
  if (found === undefined) {
    notFound();
  }

  const [code, canonicalSlug] = found;

  return {
    locale,
    code,
    name: countryNameOf(locale, code),
    slug: canonicalSlug,
    trips: countryTrips(allTrips, code),
    places: countryPlaces(allTrips, code, collatorFor(locale).compare),
    allTrips,
  };
}

export async function generateMetadata({ params }: CountryPageProps): Promise<Metadata> {
  const { locale, name, slug, trips, places } = await loadCountry(params);
  const t = await getTranslations({ locale, namespace: "country" });
  const site = await getTranslations({ locale, namespace: "metadata" });

  /**
   * The title is the country's name and nothing else, which is what the three
   * index pages already do — « Villes », « Voyages par pays », « À propos ». This
   * project declares no title template, and `og:site_name` is the field that says
   * which site a shared card belongs to; repeating it in the title would put
   * "Travels in World" twice in one unfurl.
   *
   * No share image, for the reason the three indexes give: this page is a list,
   * and promoting one trip's photograph onto the card of a whole country would
   * put a single journey's picture on it.
   */
  return shareMetadata({
    locale,
    /**
     * Built from the resolved slug and never from the one in the URL. They are the
     * same string today, and that is the point of stating it: the day the two can
     * differ, this line is what keeps one address canonical instead of two.
     */
    href: countryPath(slug),
    title: name,
    description: t("pageMetaDescription", {
      country: name,
      trips: trips.length,
      places: places.length,
    }),
    siteName: site("title"),
    type: "website",
  });
}

/**
 * The country, drawn on its own, with a dot on every city the carnet reaches.
 *
 * **`aria-hidden`, and the list under it is the equivalent** — not a concession:
 * the drawing says "these seven towns, roughly there", and the seven names are
 * written out in full below it, in the reader's own alphabetical order. A `<title>`
 * on the SVG would announce "carte de la France" and add nothing a reader has not
 * already been told. The same call, for the same reason, as the trip page's
 * mini-map and the search's vignette.
 *
 * The dot's radius is in tile units, so it scales with the drawing: 1.15 of 40 is
 * just under 6 % of the frame — about 8 px across at the 15 rem this renders at,
 * which is a dot a reader can see and not a blob that swallows Belgium. The white
 * ring around it is `stroke` in the stylesheet, and it is what separates two towns
 * that nearly touch.
 */
function CountrySilhouette({
  outline,
  marks,
}: {
  readonly outline: string;
  readonly marks: readonly PlaceMark[];
}) {
  return (
    <svg
      className={styles.silhouette}
      viewBox={`0 0 ${TILE_BOX} ${TILE_BOX}`}
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.land} d={outline} />
      {marks.map((mark) => (
        <circle
          key={mark.name}
          className={styles.dot}
          cx={mark.x}
          cy={mark.y}
          r={PLACE_DOT_RADIUS}
        />
      ))}
    </svg>
  );
}

export default async function CountryPage({ params }: CountryPageProps) {
  const state = await loadCountry(params);
  const { locale, code, name, trips, places, allTrips } = state;
  const t = await getTranslations("country");

  /**
   * The tile is `undefined` for a country the 50m vintage cannot draw — 75 of the
   * 249 assigned codes, Singapore and Hong Kong included. The page then has no
   * drawing and every word of it, which is `countryTile`'s own asymmetry: failing
   * a build over an ornament would be the wrong trade.
   */
  const tile = countryTile(code);
  const marks = tile === undefined ? [] : placeMarks(places, tile.place);

  /**
   * The same question the home page and the catalogue ask, answered by the same
   * pure function over the **whole** collection and the same build day — so the
   * badge is on the same trip here as it is there, and appears once and not once
   * per country. `freshestTrip` skips untold récits before comparing, so with
   * thirteen unwritten journeys it answers `undefined` and no card is badged.
   */
  const fresh = freshestTrip(allTrips, buildDay());

  return (
    /*
      The landing point of the layout's skip link — the same `id` and the same
      `tabIndex={-1}` as every other page, from the same constant.

      No `data-page`: the header underlines the entry a reader clicked, and the
      entry that leads here is the index one level up. `../page.tsx` carries the
      mark; a second page claiming it would underline « Pays » from two different
      places, which is exactly what the mark is for — this is a leaf, not a tab.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1} data-page={PAGE_MARK.countries}>
      <header className={styles.header}>
        <h1 className={styles.title}>{name}</h1>
        <p className={styles.counts}>
          {t("counts", { trips: trips.length, places: places.length })}
        </p>
      </header>

      {tile === undefined ? null : (
        <div className={styles.figure}>
          <CountrySilhouette outline={tile.path} marks={marks} />
        </div>
      )}

      <section className={styles.section} aria-labelledby="voyages-du-pays">
        <h2 className={styles.sectionHeading} id="voyages-du-pays">
          {t("tripsHeading")}
        </h2>
        {/*
          A list, so the number of trips is announced on entering rather than
          discovered by scrolling. `role="list"` for the Safari / VoiceOver reason
          recorded on the map's marker list: `list-style: none` strips the role,
          and jsdom cannot see it.

          The same grid the catalogue and the home page lay their cards out on,
          from the card's own stylesheet — a fourth copy of
          `repeat(auto-fill, minmax(…))` would be a fourth place for the card's
          width to drift.
        */}
        <ul className={cardStyles.grid} role="list">
          {trips.map((trip) => (
            <li key={trip.slug}>
              {/*
                `headingLevel={3}` under this page's single `h2`. No `id` on the
                `<li>`: `voyage-<slug>` belongs to the catalogue, which is the one
                page the map's markers address, and two elements sharing an `id`
                in one document is invalid HTML — the note `TripCatalogue` carries
                about `LatestTrips` applies here word for word.
              */}
              <TripCard
                trip={trip}
                locale={locale}
                headingLevel={3}
                isNew={trip.slug === fresh?.slug}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="villes-du-pays">
        <h2 className={styles.sectionHeading} id="villes-du-pays">
          {t("placesHeading")}
        </h2>
        {/*
          The textual equivalent of the drawing above, and the reason it carries
          no link: `/villes` is the page that addresses a place, with its stays and
          its filter, and a second set of rows leading somewhere else would be two
          answers to one question. Here the names are the map's legend.
        */}
        <ul className={styles.places} role="list">
          {places.map((place) => (
            <li key={place.name}>{place.name}</li>
          ))}
        </ul>
      </section>

      <nav className={styles.ways} aria-label={t("allCountries")}>
        {/*
          Two ways out, and today they are the only links on this page: every one
          of the thirteen journeys is untold, so no card carries a link of its own
          (`TripCard` renders « Récit à venir » instead of an address that would
          404). A page whose whole content is inert is a dead end, which is what
          these two refuse.
        */}
        {isFiledUnder(trips, code) ? (
          /*
            `#pays-<CODE>` — the id `TripCatalogue` puts on a country's section,
            UPPERCASE because that is the schema's spelling and HTML fragments are
            case-sensitive. Rendered only when the catalogue really has that
            section: it files a trip under its FIRST ARRIVAL, so the fragment
            dangles for a country a trip merely crosses. This repository has paid
            for that once already — `#pays-bo`, measured, recorded in the header of
            `tests/e2e/dead-links.populated.spec.ts` — and `isFiledUnder` is the
            question that guard taught us to ask.
          */
          <a
            className={styles.way}
            href={localePathname({ href: `${tripsPath()}#pays-${code}`, locale })}
          >
            {t("inCatalogue", { country: name })}
          </a>
        ) : null}
        <a className={styles.way} href={localePathname({ href: countriesPath(), locale })}>
          {t("allCountries")}
        </a>
      </nav>
    </main>
  );
}
