import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
// `@/components/map` and not `@/components/map/world-map`: the deep specifier is
// caught by the `"**/map/*"` half of the geometry façade's guard, which compares
// strings and cannot tell `src/components/map` from a relative spelling of
// `src/map`. See the header of `src/components/map/index.ts`.
import { untoldOnlyCountryCodes, WorldMap, type TripMark } from "@/components/map";
import { panelPhotos } from "@/components/photos/collection";
import { FreshTripBanner } from "@/components/trips/fresh-trip-banner";
import { ProjectPurpose } from "@/components/site/project-purpose";
import { PAGE_MARK } from "@/components/site/site-nav";
import { LatestTrips } from "@/components/trips/latest-trips";
import { TripPanel } from "@/components/trips/trip-panel";
import { loadTrips, listWishedCountries } from "@/content/trips";
import { freshestTrip } from "@/domain/freshness";
import { hasStory, visitedPlaces } from "@/domain/trip";
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
  const trips = await loadTrips();
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
    /*
      **The wish list** (TIW-39), read here because this is the page that holds
      both façades — the content one for the codes, the geometry one for the
      shapes. `buildWorldGeometry` is what refuses a code the basemap cannot draw
      or a country a trip has already reached; the read itself is four lines of
      YAML and is not memoised, which its own note in `src/content/loader.ts`
      prices.

      Awaited on its own rather than in a `Promise.all` with the trips above: the
      two are independent, but the trips are already awaited by the line that
      needs them for `visitedCountryCodes`, so pairing them would suggest a
      waterfall that is not there.
    */
    wishedCountryCodes: await listWishedCountries(),
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
             * written. Same move the map's country list made after measuring
             * that its `#pays-xx` fragment dangled — the finding outlived the
             * list, in the header of `tests/e2e/dead-links.populated.spec.ts`.
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
   * The body of each trip's panel on the map.
   *
   * **What this used to be, and why it changed.** Until now it was one
   * `TripCard` per trip, and the map stacked *every card of a zone* into one
   * panel: clicking Paris opened « Les 6 voyages à cet endroit » with
   * Gand-Bruges at the top, because a zone was named after its most recent trip.
   * The owner's report is the specification — « quand je clique sur un voyage je
   * veux le descriptif avec les photos du voyage, pas les autres voyages du pays
   * » — so a panel now belongs to one trip and carries its description. The
   * markers a finger would cover along with it are still reachable, as a short
   * list of links `world-map.tsx` appends under « Aussi à cet endroit ».
   *
   * **Built here, and handed to the map as rendered nodes**, which is the one
   * thing that did not change. A body needs `Intl` date formatting, two message
   * namespaces and a locale-prefixed href — none of which `src/components/map/**`
   * may reach without ending its own rule that the whole layer renders under
   * jsdom from a seven-shape fixture
   * (`docs/adr/0003-carte-svg-inerte-et-balises-html.md`). This page is already
   * the one file holding both façades and both narrowed types, so it is where the
   * join belongs. The map decides *which* body goes in *which* panel; it never
   * decides what a body looks like.
   *
   * `TripCard` is not reused: a card is a *listing* row — a cover, a title and a
   * read affordance, with the title as its link — and the panel's `<h2>` already
   * carries the title, so a card here would print it twice and link the second
   * one. `TripCard` is untouched and still renders « Derniers voyages » below.
   *
   * The bodies live in the flight payload whether a panel opens or not, which is
   * the cost this ticket's report measures on a real build.
   */
  const tripPanels = new Map<string, ReactNode>(
    trips.map((trip) => [
      trip.slug,
      <TripPanel
        key={trip.slug}
        trip={trip}
        locale={locale}
        /*
          Resolved here and not inside the component, for the reason every prop
          of that file has: `visitedPlaces` is a domain function, and a component
          that called it could no longer be rendered from a literal in a unit
          test. The page holds the façades; the component holds the markup.
        */
        cityNames={visitedPlaces(trip).map((place) => place.name)}
        photos={panelPhotos(trip)}
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

      `data-page` is how the header knows which entry to underline (TIW-38). It is
      read by `site-nav.module.css` through `body:has(main[data-page="carte"])`,
      backwards, in CSS — which is what lets a nav rendered by the LAYOUT mark the
      current page without a client component, a prop threaded through every route
      or a request read. It carries nothing to assistive technology; `SiteNav`'s
      header says why `aria-current="page"` is still absent and what names this
      page instead.
    */
    <main id={MAIN_CONTENT_ID} tabIndex={-1} data-page={PAGE_MARK.map}>
      {/*
        **The title is announced and never drawn** (TIW-38, at the owner's
        request), and the introduction is gone entirely.

        The `<h1>` is HIDDEN and not deleted, and that is not the same decision
        twice. A document with no `<h1>` has no heading outline — every other page
        of this site has one, `tests/e2e` checks the outline of the four screens,
        and a search result would lose the only thing naming this page. Hiding it
        costs the composition nothing and keeps all three.

        The introduction had no such job, so it is removed rather than hidden: a
        paragraph only a screen reader receives is a paragraph nobody decided to
        write for a screen reader. The message key went with it.

        **And the `<section>` that used to wrap these is gone too**, which is what
        actually lets the map fill the screen. It was a grid row of zero height —
        its only remaining child is absolutely positioned — but a row of zero
        height still takes a `row-gap`, so the map started 24 px lower than the
        arithmetic below expected and its last degrees of latitude fell under the
        fold. A wrapper that contains nothing laid out is a wrapper that only
        costs.
      */}
      <h1 className={styles.visuallyHidden}>{t("title")}</h1>

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
        **The map, on the wide track** (TIW-38). It is a direct child of `<main>`
        so `[data-bleed]` can reach it: `grid-column` is a property of a grid
        ITEM, so a map nested one level deeper would have been laid out by the
        section and never by the page.

        It was also why the countries list below used to be a sibling rather than
        the map's neighbour inside a wrapper. That list is gone (see the note
        after this block), and the reason survives it: each block on this page
        sits on the track it belongs to, and the map is the only one on the wide
        one.

        A wrapper and not the attribute on the `<figure>` itself: `WorldMap` owns
        its own root element and takes no `className`, and widening its props so a
        page can dress it is the coupling ADR 0003 keeps out of that layer.
      */}
      <div data-bleed>
        <WorldMap
          countries={world.countries}
          visited={toldCountries}
          untold={untoldCountries}
          /*
            The wish list (TIW-39). Handed straight through: `buildWorldGeometry`
            already read `content/wishlist.yaml`, refused any code the basemap
            cannot draw or a trip has already reached, sorted the survivors by
            localised name and computed each one's anchor. This page's only job is
            the one it does for every other bucket — carrying geometry across the
            boundary `docs/adr/0003` draws, so the map layer imports no façade.
          */
          wished={world.wished}
          marks={marks}
          world={{ width: world.width, height: world.height }}
          tripPanels={tripPanels}
        />
      </div>

      {/*
          No wrapper any more: the height cap that used to live in this page's
          `.mapFrame` moved into the map's own stylesheet with TIW-14. The map now
          owns a panel and three controls as well as a drawing, so its box is its
          own business — and this page no longer computes a ratio for a stylesheet
          it does not own.
        */}
      {/*
          **« Les pays visités » was here, and it is gone at the owner's request.**
          Deleted rather than hidden, and the component with it: a block nothing
          renders is a block that rots, and this one carried enough measured
          reasoning that leaving it half-alive would have been worse than either
          keeping or removing it.

          **What replaced it, and what did not.** The inventory of "which
          countries, how many trips" is now the Pays tab (`/voyages`, grouped by
          country) and the Villes tab beside it — the site did not lose it, this
          page did. What this page loses is the *join* between the drawing and
          those names: a reader who cannot use the map now has the marker list —
          thirteen real links, each named "titre, lieu" and, for an untold trip,
          "— récit à venir" — plus the `<figcaption>`'s count. That still carries
          1.1.1 for an `aria-hidden` drawing.

          **The debt this opens, said plainly rather than discovered later.**
          `world-map.module.css` recorded this list as the channel WCAG 1.4.1
          rests on, because since TIW-38 the told/untold distinction in the
          drawing is copper against teal — a difference of hue alone. It is
          inert today: every published trip is `story: unwritten`, so the map
          paints one tint and there is no colour-only distinction to carry. It
          becomes real at the **first published récit**, and the fix then is a
          shape difference in the drawing (the dashed stroke TIW-38 replaced),
          not a list a reader must scroll to.
        */}

      <LatestTrips trips={trips} locale={locale} freshSlug={fresh?.slug} />

      {/*
        Last on the page (TIW-38), which is the whole of its placement argument:
        a reader meets the map, then the trips, and only then the person who
        writes them. Putting it above the trips would make the home page an
        introduction to someone rather than a way into a journal.
      */}
      <ProjectPurpose />
    </main>
  );
}
