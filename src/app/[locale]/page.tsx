import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
// `@/components/map` and not `@/components/map/world-map`: the deep specifier is
// caught by the `"**/map/*"` half of the geometry façade's guard, which compares
// strings and cannot tell `src/components/map` from a relative spelling of
// `src/map`. See the header of `src/components/map/index.ts`.
import {
  untoldOnlyCountryCodes,
  VisitedCountries,
  WorldMap,
  type TripMark,
} from "@/components/map";
import { FreshTripBanner } from "@/components/trips/fresh-trip-banner";
import { collatorFor, countryNameOf } from "@/components/trips/format";
import { LatestTrips } from "@/components/trips/latest-trips";
import { TripCard } from "@/components/trips/trip-card";
import { listTripSummaries } from "@/content/trips";
import { freshestTrip } from "@/domain/freshness";
import { hasStory } from "@/domain/trip";
import { buildWorldGeometry, projectPoint } from "@/map";
import { localePathname } from "@/i18n/pathname";
import { tripPath, tripsPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { buildDay } from "../build-day";
import { MAIN_CONTENT_ID } from "./main-content";
import styles from "./page.module.css";

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * The home page: one sentence saying what this is, the world map, and the start
 * of the latest-trips block.
 *
 * **This is the one file holding both façades**, by design rather than by
 * accumulation. `docs/adr/0003-carte-svg-inerte-et-balises-html.md` requires that
 * nothing under `src/components/map/**` import `@/map` or `@/content/trips` as a
 * *value*, so the whole map layer renders under jsdom from a seven-shape fixture;
 * `src/components/trips/**` follows the same rule for the same reason. The
 * joining therefore happens here — which is also the only place holding a real
 * `TripSummary` next to the narrowed `TripEntry` and a real `CountryShape` next
 * to the narrowed `MapCountry`, so a rename in either façade fails
 * `npm run typecheck` here and nowhere else.
 *
 * **The three states this page must be right in**, all reachable today: no
 * published trip — the production state until the first `trip.yaml` lands, since
 * `content/trips` is empty — one trip, and sixty. `frameAround` owns the first
 * two for the map; `LatestTrips` owns all three for the listing.
 */
export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  /**
   * One read of the content, used twice, and deliberately not a `Promise.all`:
   * `buildWorldGeometry` needs the country codes this very list produces, so the
   * two are genuinely sequential rather than a waterfall someone forgot to
   * flatten. The façade memoises its parse for the whole build, so a second call
   * would cost no second disk read — only a second projection of the same trips.
   */
  const trips = await listTripSummaries();
  const t = await getTranslations("home");

  /**
   * **Which récit is new, resolved once for the whole page** (TIW-19). The three
   * placements — the banner below, the map's marker and the card in "Derniers
   * voyages" — all compare against this one answer, which is what makes "le
   * voyage le plus récent le porte, et seulement lui" a property of the data
   * rather than a discipline three components have to keep.
   *
   * `buildDay()` is the only clock reading on this page's path, and
   * `freshestTrip` is a pure function of the collection and that day: the domain
   * may not read a clock, and a rule that read one would have no boundary test.
   *
   * **`undefined` is an ordinary answer, not an error state**: no trip at all,
   * or a newest publication older than the window. The page renders no banner and
   * no badge then, which is the third acceptance criterion.
   *
   * What this cannot do, said plainly: the day is the *build's*, so the badge
   * expires at the first build after its sixtieth day.
   * `docs/fraicheur-au-prerendu.md` argues that trade against the two
   * alternatives and says what `.github/workflows/refresh.yml` buys back.
   */
  const fresh = freshestTrip(trips, buildDay());

  const world = buildWorldGeometry({
    // Duplicates are the normal case — several trips share a country — and
    // `buildWorldGeometry` de-duplicates on its side. Flattening is all this owes.
    visitedCountryCodes: trips.flatMap((trip) => [...trip.countryCodes]),
    locale,
  });

  /**
   * **The third tint** (TIW-18): the countries every one of whose trips is untold.
   *
   * Partitioned here, from a set of *codes*, and never asked of `@/map`. The
   * geometry façade projects the world once per build and returns one tinted
   * subset; a third bucket would have meant either widening its signature or
   * projecting twice, for a distinction that is entirely a property of the
   * content. This page already holds both façades, so it is where the join
   * belongs — and the arithmetic itself is `untoldOnlyCountryCodes`, a pure
   * function the map suite covers case by case.
   *
   * `visited` and `untold` are handed over **disjoint**. The tidier-looking
   * alternative — `visited` keeping every tinted country, `untold` painted over a
   * subset of it — does not work: the dashed stroke's gaps would show the solid
   * stroke underneath and the two states would render identically.
   */
  const untoldCodes = untoldOnlyCountryCodes(trips);
  const isUntold = (country: { readonly code: string | null }): boolean =>
    country.code !== null && untoldCodes.has(country.code);

  const toldCountries = world.visited.filter((country) => !isUntold(country));
  const untoldCountries = world.visited.filter(isUntold);

  /**
   * One marker per trip, anchored where its first step arrives — the same
   * anchoring `buildCatalogue` files a trip under, so the map and the listing
   * agree about where a trip "is".
   *
   * `flatMap` rather than `map`: `projectPoint` answers `null` for a coordinate
   * the projection declines, and a marker built from it would carry `NaN`
   * percentages — an attribute the browser ignores, so an invisible link with
   * nothing in the console to say so. Dropping it costs one marker on a map that
   * still works, and the `<figcaption>` counts `marks`, so the figure a reader is
   * told stays true to what was drawn.
   */
  const marks: readonly TripMark[] = trips.flatMap((trip) => {
    const point = projectPoint(trip.firstArrival.coordinates);

    return point === null
      ? []
      : [
          {
            slug: trip.slug,
            title: trip.title,
            // Read only by `zonesOf`, which sorts a zone's panel by date
            // descending rather than trusting the order this list arrives in.
            startDate: trip.startDate,
            placeName: trip.firstArrival.name,
            /**
             * **Where this marker leads, and the one decision the map layer does
             * not take** (ADR 0003: the component renders `mark.href` as-is).
             *
             * A trip whose récit is written gets its own page. A trip whose récit
             * is not has none — `tripStaticParams` never built one — so pointing
             * at `tripPath(slug)` would render a 404 into sixty markers' worth of
             * HTML with a green build. The destination is chosen from what
             * certainly exists: the trip's own entry in the listing, which is
             * exactly where « Récit à venir », its dates and its countries are
             * written. Same move `visited-countries.tsx` records making after
             * measuring that its `#pays-xx` fragment dangled.
             *
             * The fragment is `#voyage-<slug>`, the id `TripCatalogue` puts on
             * each entry — the same scheme the trip page uses to point back at a
             * marker on this page, so one spelling identifies a trip's entry on
             * whichever page holds one. `tests/e2e/dead-links.populated.spec.ts`
             * follows every href of both pages and checks the fragment resolves.
             *
             * **Why the marker stays a link at all**, since it can no longer be
             * "the trip's page": the three alternatives each break something. No
             * marker leaves the country tinted with nothing to explain it and no
             * panel to open; an `<a>` with no `href` has no link role, so the
             * panel would open under a mouse and be unreachable by keyboard
             * (2.1.1); a `<button>` is dead without JavaScript, on a map whose
             * whole point is working without any.
             */
            href: hasStory(trip)
              ? localePathname({ href: tripPath(trip.slug), locale })
              : localePathname({ href: `${tripsPath()}#voyage-${trip.slug}`, locale }),
            point,
            // Read by the marker's accessible name and by its dot's shape, never
            // by its `href` — see above.
            story: trip.story,
            // The halo and the "— nouveau récit" suffix on this marker's
            // accessible name. Compared against the one answer resolved above,
            // never recomputed per marker.
            isNew: trip.slug === fresh?.slug,
          },
        ];
  });

  /**
   * The body of each trip's row in the map's selection panel (TIW-14).
   *
   * **Built here, and handed to the map as rendered nodes.** A card needs `Intl`
   * date formatting, the `trips` namespace and a locale-prefixed href — none of
   * which `src/components/map/**` may reach without ending its own rule that the
   * whole layer renders under jsdom from a seven-shape fixture
   * (`docs/adr/0003-carte-svg-inerte-et-balises-html.md`). This page is already
   * the one file holding both façades and both narrowed types, so it is the
   * right place for the join. The map decides *which* card goes in *which*
   * panel; it never decides what a card looks like.
   *
   * `TripCard` and not a second card written for the panel: it is exactly the
   * criterion's list — cover, title, dates, duration and a read affordance — and
   * a copy would be a second place for the date format to drift. `headingLevel:
   * 3` sits under the panel's own `<h2>`.
   *
   * The cards live in the flight payload whether a panel opens or not. Measured
   * on the four-trip fixture, that is the cost recorded in this ticket's report;
   * the alternative — serialising trip data and building the card in the browser
   * — would have put the formatting, the namespace and the markup in the client
   * bundle, which is the budget this ticket must not spend.
   */
  const tripCards = new Map(
    trips.map((trip) => [
      trip.slug,
      <TripCard
        key={trip.slug}
        trip={trip}
        locale={locale}
        headingLevel={3}
        isNew={trip.slug === fresh?.slug}
      />,
    ])
  );

  return (
    /*
      The landing point of the layout's skip link. `tabIndex={-1}` is what makes
      Safari move the focus and not merely the scroll position — without it the
      next Tab continues from the top of the page and the reader has skipped
      nothing. The `id` comes from `./main-content` because the link lives in the
      layout and the `<main>` lives here, one per document.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      <section className={styles.hero}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.intro}>{t("intro")}</p>

        {/*
          The banner (TIW-19), and it is here — above the map, below the
          introduction — for the acceptance criterion's reason: a returning
          reader must see what is new *before* deciding where to look. It is
          three short lines with no image and no button, so the first screen
          still carries the sentence, the map and the start of "Derniers
          voyages" that TIW-13's criterion asks for.

          Rendered only when there is one. `FreshTripBanner` takes a `TripEntry`
          and not an optional, so the empty state is this branch and cannot be a
          component quietly returning `null`.
        */}
        {fresh === undefined ? null : <FreshTripBanner trip={fresh} locale={locale} />}

        {/*
          No wrapper any more: the height cap that used to live in this page's
          `.mapFrame` moved into the map's own stylesheet with TIW-14. The map now
          owns a panel and three controls as well as a drawing, so its box is its
          own business — and this page no longer computes a ratio for a stylesheet
          it does not own.
        */}
        <WorldMap
          countries={world.countries}
          visited={toldCountries}
          untold={untoldCountries}
          marks={marks}
          world={{ width: world.width, height: world.height }}
          tripCards={tripCards}
        />

        {/*
          The map's textual equivalent (TIW-15), and it sits *outside* the map's
          own box on purpose. The map caps itself at `45vh × aspect` — about
          691 px on a 1152 px desktop — so a list rendered inside it would be a
          centred column two thirds of the page wide, with its `h2` out of line
          with the "Derniers voyages" `h2` right below. The reading order is what
          the acceptance criterion asks for ("sous la carte"), and DOM order gives
          it. (Until TIW-14 the cap was this page's `.mapFrame`; the wrapper is
          gone and the sibling relation is unchanged.)

          **`trips` and not `world.visited`.** The equivalent is derived from the
          content, never from the geometry beside it: `buildWorldGeometry` throws
          for a declared code it cannot draw, so a state with no country shape is
          a state with no declared code, and a list fed from the tinted subset
          would have been empty in exactly the states where the drawing is
          missing. One failure, both channels — which is the opposite of what the
          "map failed" criterion asks for. The two counts still agree: the
          caption counts the tinted subset, which `@/map` selects from these very
          codes.

          The naming and the collation come from the listing's own helpers, so a
          country reads the same here and on `/fr/voyages`, and this page stays
          the one place that holds both façades.
        */}
        <VisitedCountries
          trips={trips}
          labels={{
            countryName: (code) => countryNameOf(locale, code),
            compare: collatorFor(locale).compare,
          }}
          tripHref={(slug) => localePathname({ href: tripPath(slug), locale })}
          allTripsHref={localePathname({ href: tripsPath(), locale })}
        />
      </section>

      <LatestTrips trips={trips} locale={locale} freshSlug={fresh?.slug} />
    </main>
  );
}
