import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { tallyVisitedCountries, type CountingTrip, type CountryLabels } from "./countries";
import styles from "./visited-countries.module.css";

/**
 * The map's textual equivalent: every country the published trips reach, how many
 * trips reach it, and a way into them.
 *
 * **It is not a spare wheel**, and that framing decided the whole shape below. It
 * serves a reader on a slow connection, a visitor who wants to scan rather than
 * aim a pointer at a 44 px target, an indexer, and — incidentally — anyone for
 * whom the drawing is unavailable. So it is visible text in the page's normal flow
 * with a real heading, not a hidden block behind the `<svg>`.
 *
 * **It reads the trips, never the geometry.** That is what makes the "map failed"
 * acceptance criterion reachable at all: `buildWorldGeometry` throws for a
 * declared code it cannot draw, so a state with no country shapes is a state with
 * no declared codes, and an equivalent derived from the tinted subset would have
 * been empty in exactly the states where the drawing was missing — one failure,
 * both channels. See the header of `./countries.ts`.
 *
 * **It links, it does not duplicate.** `/fr/voyages` already is the complete
 * inventory of "which trips, where"; repeating it under the map would give the
 * site two inventories to keep in agreement, and the ticket is explicit that the
 * map is a tool of discovery and not the table of contents. What was missing was
 * the *join* between the two channels the map already had — five countries on one
 * side, four cities on the other — plus a number that existed nowhere: the count
 * of trips per country.
 *
 * **Zero client JavaScript**, like the drawing beside it: a heading, a list, and
 * anchors. There is no `'use client'` in this file and there must not be — the
 * milestone's two sanctioned client boundaries belong to TIW-14 and TIW-17. Which
 * is also why the "JavaScript unavailable" half of the acceptance criterion needs
 * no fallback: there is no script to fail.
 *
 * **No URL is assembled here**, for the reason
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives for `mark.href`: the
 * locale prefix belongs to `src/i18n/**`, and a component that concatenates a path
 * is a component that loses the `/fr` segment. Every href arrives as a prop from
 * the page, which is the one place holding the content façade.
 */

/**
 * The `<section>` takes its accessible name from the heading it already renders,
 * so the label lives once in the catalogue and once in the DOM. A constant rather
 * than a literal because the two occurrences must not drift, and one instance per
 * page — this is the home page's map equivalent, not a reusable widget.
 */
const HEADING_ID = "pays-visites";

export type VisitedCountriesProps = {
  /**
   * The published trips, in the content façade's order. Only `slug` and
   * `countryCodes` are read.
   */
  readonly trips: readonly CountingTrip[];
  /**
   * How to name and order a country. Passed in rather than derived, so this
   * component knows no locale and no `Intl` — the same contract `buildCatalogue`
   * takes in `src/components/trips/catalogue.ts`.
   */
  readonly labels: CountryLabels;
  /** One trip's own page, by slug — `tripPath` localised by the page. */
  readonly tripHref: (slug: string) => string;
  /** The whole listing, grouped by continent then country. */
  readonly allTripsHref: string;
};

export function VisitedCountries({
  trips,
  labels,
  tripHref,
  allTripsHref,
}: VisitedCountriesProps): ReactElement {
  const t = useTranslations("map");

  const tally = tallyVisitedCountries(trips, labels);

  return (
    /*
      A named `<section>`, so this is a `region` landmark — matching `LatestTrips`,
      its `h2` sibling on this page, which is also one. The first version was a
      bare `<div>`, on the reasoning that `<main>` is this page's only landmark;
      that was simply false in the rendered DOM (`header`, `nav`, `main`, and
      `LatestTrips`' own labelled section), and the result was that "Derniers
      voyages" appeared in a screen reader's landmark rotor while "Les pays
      visités" did not. Two `h2` chapters of one page should be reachable the
      same way.
    */
    <section className={styles.countries} aria-labelledby={HEADING_ID}>
      <h2 className={styles.heading} id={HEADING_ID}>
        {t("countriesHeading")}
      </h2>

      {tally.length > 0 ? (
        <ul
          className={styles.list}
          /*
            `role="list"` is redundant markup that is not redundant in practice:
            `list-style: none` strips the list role in Safari with VoiceOver, and
            a list that has lost its role has also lost its item count — the one
            thing a reader entering forty countries wants first. jsdom keeps the
            role either way, so no unit test can see this. Same note on the marker
            list in `./world-map.tsx`.
          */
          role="list"
        >
          {tally.map((country) => {
            /**
             * **Where the link goes, and why it is not a fragment.**
             *
             * The first version pointed at `/fr/voyages#pays-xx`, a section
             * `TripCatalogue` renders. Measured on a production build: it
             * dangled. The catalogue files a trip under its *first arrival*
             * country only, so a country a trip merely crosses has no section —
             * `#pays-bo` was emitted by the home page and matched nothing on
             * `/fr/voyages`, which leaves the reader silently at the top of the
             * listing. Worse, Bolivia does not appear on that page at all: its
             * trip is filed under Peru.
             *
             * So the target is chosen from what certainly exists. One trip: its
             * own page, which is more precise than any listing section could be.
             * Several: the whole listing. Neither can dangle, because both are
             * routes rather than fragments.
             */
            const [onlyTold] = country.toldTripSlugs;
            /**
             * **`toldTripSlugs` and not `tripSlugs`** (TIW-18), and this one word
             * is where the "no dead link" criterion is won or lost on this
             * component. The precise branch links to a trip's *own page*; the
             * moment a trip can exist without one, reading the wider list points
             * at an address `tripStaticParams` never built. One untold trip in
             * one country was enough.
             *
             * The two conditions are both needed and say different things.
             * `tripSlugs.length === 1` is the pre-existing rule — a row announcing
             * "2 voyages" must not name one of them, which is the 2.4.4 defect the
             * `#pays-xx` note above already paid for. `onlyTold !== undefined` is
             * the new one: that single trip must have a page.
             */
            const href =
              country.tripSlugs.length === 1 && onlyTold !== undefined
                ? tripHref(onlyTold)
                : allTripsHref;
            /**
             * Whether **nothing** in this country is written yet — the same
             * "every, not any" rule `untoldOnlyCountryCodes` applies to the tint,
             * so the row and the drawing cannot disagree about one country.
             *
             * This is what carries the distinct tint in words. The `<svg>` is
             * `aria-hidden` and a dashed stroke says nothing to a screen reader,
             * so without this line the third state would be a colour-and-pattern
             * distinction with no textual channel at all — WCAG 1.4.1, and the
             * exact gap the audit of TIW-20 found in the *first* tint.
             */
            const nothingWritten = country.toldTripSlugs.length === 0;

            return (
              <li key={country.code}>
                {/*
                  One link per row, holding both the name and the count, and not a
                  link around the name with the count beside it. A screen reader
                  announces the link and not its neighbours, so a count left
                  outside would be a number the keyboard never hears — and the
                  acceptance criterion asks for the countries *with their number
                  of trips* to be navigable by keyboard.

                  The opposite call from `trip-catalogue.tsx`, which keeps the
                  count out of its `<h3>`: there the number would join the
                  accessible name of a *heading*, and a reader navigating by
                  heading wants chapter titles, not chapter sizes.
                */}
                <a className={styles.link} href={href}>
                  <span className={styles.name}>{country.name}</span>
                  {/*
                    An explicit space, and it is load-bearing. The accessible name
                    of this link is the concatenation of its descendants' text, and
                    whether a separator appears between two sibling elements is up
                    to the engine: the accname algorithm's separator rules depend
                    on computed display, so a flex item may or may not contribute
                    one. Measured under jsdom with no space in the markup: the name
                    came out "Japon2 voyages", and at two digits "Pays 102
                    voyages" is ambiguous to a reader and to a parser alike.

                    A whitespace-only text node between two flex items is not laid
                    out as an anonymous flex item, so `gap` still owns the visual
                    spacing and nothing shifts.
                  */}{" "}
                  <span className={styles.trips}>
                    {t("countryTrips", { count: country.tripSlugs.length })}
                  </span>
                  {/*
                    Inside the link's accessible name, like the count beside it and
                    for the same reason: a screen reader announces the link and not
                    its neighbours, so a note left outside would be a fact the
                    keyboard never hears.

                    The explicit space is load-bearing for the reason recorded
                    above — whether two sibling flex items contribute a separator
                    to an accessible name is up to the engine, and « 1 voyagerécit
                    à venir » is what the markup gives without it.
                  */}
                  {nothingWritten ? (
                    <>
                      {" "}
                      <span className={styles.pending}>{t("countryStoryToCome")}</span>
                    </>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        /*
          No trip published — today's production state, `content/trips` being
          empty until TIW-24, and also what a reader gets if the drawing failed on
          an empty journal. An empty `<ul>` announces "liste, 0 élément" and a bare
          heading over nothing is the empty block the acceptance criteria refuse,
          so this branch says what is going on and offers the one action that leads
          somewhere.
        */
        <>
          <p className={styles.empty}>{t("countriesEmpty")}</p>
          {/*
            The way out, and the only state that needs it. With countries in the
            list every row is already a link into the journal, and a further link
            to the listing — the main navigation and the latest-trips block each
            carry one — would be noise between the rows and the reader's next
            heading.
          */}
          <a className={styles.allTrips} href={allTripsHref}>
            {t("allTrips")}
          </a>
        </>
      )}
    </section>
  );
}
