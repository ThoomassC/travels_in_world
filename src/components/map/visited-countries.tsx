import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { tallyVisitedCountries, type NamedCountry } from "./countries";
import styles from "./visited-countries.module.css";

/**
 * The map's textual equivalent: every country the drawing tints, how many trips
 * reach it, and a way into them.
 *
 * **It is not a spare wheel**, and that framing decided the whole shape below.
 * It serves a reader on a slow connection, a visitor who wants to scan rather
 * than aim a pointer at a 44 px target, an indexer, and — incidentally — anyone
 * for whom the drawing is unavailable. So it is visible text in the page's normal
 * flow with a real heading, not a hidden block behind the `<svg>`.
 *
 * **It links, it does not duplicate.** `/fr/voyages` already is the complete
 * inventory of "which trips, where", laid out `h2` continent → `h3` country →
 * `h4` trip, and an audit of the delivered map confirmed it. Repeating that under
 * the map would give the site two inventories to keep in agreement, and the
 * ticket is explicit that the map is a tool of discovery and not the table of
 * contents. What was missing was the *join* between the two channels the map
 * already had — five countries on one side, four cities on the other, nothing
 * saying which trip is in which country — plus a number that existed nowhere: the
 * count of trips per country. Each row here is that number, and the link lands on
 * the group it counts.
 *
 * **Zero client JavaScript**, like the drawing beside it: a heading, a list, and
 * anchors. There is no `'use client'` in this file and there must not be — the
 * milestone's two sanctioned client boundaries belong to TIW-14 and TIW-17.
 * Which is also why the "JavaScript unavailable" half of the acceptance criterion
 * needs no fallback: there is no script to fail.
 *
 * **No URL is assembled here**, for the reason
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives for `mark.href`: the
 * locale prefix belongs to `src/i18n/**`, and a component that concatenates a
 * path is a component that loses the `/fr` segment. Both hrefs arrive as props
 * from the page, which is the one place holding the content façade.
 */

export type VisitedCountriesProps = {
  /**
   * The tinted subset of the map, in the order the `<figcaption>` counts it —
   * localised name, collated, as `buildWorldGeometry` hands it over. Never
   * re-sorted here: the two channels of one figure must read in one order.
   */
  readonly visited: readonly NamedCountry[];
  /** One entry per published trip: the ISO 3166-1 alpha-2 codes it reaches. */
  readonly tripCountryCodes: readonly (readonly string[])[];
  /**
   * The listing, addressed at one country's own section — `tripsCountryPath`
   * localised by the page.
   *
   * A function rather than a prepared list, so that this component and the
   * `<figcaption>` beside it derive their rows from the *same* `visited` array.
   * Handing over a ready-made list of rows instead would be a second array able
   * to disagree with the count the caption announces, which is the one
   * inconsistency a reader can actually catch.
   */
  readonly countryHref: (code: string) => string;
  /** The whole listing, for the state in which there is no country to link. */
  readonly allTripsHref: string;
};

export function VisitedCountries({
  visited,
  tripCountryCodes,
  countryHref,
  allTripsHref,
}: VisitedCountriesProps): ReactElement {
  const t = useTranslations("map");

  const tally = tallyVisitedCountries(visited, tripCountryCodes);

  return (
    /*
      A `<div>` with a heading, deliberately not a named `<section>`. A named
      section is a `region` landmark, and `src/components/trips/trip-catalogue.tsx`
      records the reasoning this follows: the heading outline is what a reader
      walks a page with, and landmarks are worth having only while the list of
      them stays short enough to read. `<main>` is this page's one landmark.
    */
    <div className={styles.countries}>
      <h2 className={styles.heading}>{t("countriesHeading")}</h2>

      {tally.length > 0 ? (
        <ul
          className={styles.list}
          /*
            `role="list"` is redundant markup that is not redundant in practice:
            `list-style: none` strips the list role in Safari with VoiceOver, and
            a list that has lost its role has also lost its item count — the one
            thing a reader entering forty countries wants first. jsdom keeps the
            role either way, so no unit test can see this. Same note on the
            marker list in `./world-map.tsx`.
          */
          role="list"
        >
          {tally.map((country) => (
            <li key={country.code}>
              {/*
                One link per row, holding both the name and the count, and not a
                link around the name with the count beside it. A screen reader
                announces the link and not its neighbours, so a count left
                outside would be a number the keyboard never hears — and the
                acceptance criterion asks for the list of countries *with their
                number of trips* to be navigable by keyboard.

                The opposite call from `trip-catalogue.tsx`, which keeps the
                count out of its `<h3>`: there the number would join the
                accessible name of a *heading*, and a reader navigating by
                heading wants chapter titles, not chapter sizes.
              */}
              <a className={styles.link} href={countryHref(country.code)}>
                <span className={styles.name}>{country.name}</span>
                {/*
                  An explicit space, and it is load-bearing. The accessible name
                  of this link is the concatenation of its descendants' text, and
                  whether a separator appears between two sibling elements is up
                  to the engine: the accname algorithm's separator rules depend on
                  computed display, so a flex item may or may not contribute one.
                  Measured under jsdom with no space in the markup: the name came
                  out "Japon2 voyages", and at two digits "Pays 102 voyages" is
                  ambiguous to a reader and to a parser alike.

                  A whitespace-only text node between two flex items is not laid
                  out as an anonymous flex item, so `gap` still owns the visual
                  spacing and nothing shifts.
                */}{" "}
                <span className={styles.trips}>{t("countryTrips", { count: country.trips })}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        /*
          No country to list — today's production state, `content/trips` being
          empty until TIW-24, and also what a reader gets if the drawing failed
          on an empty journal. An empty `<ul>` announces "list, 0 items" and a
          bare heading over nothing is the empty block the acceptance criteria
          refuse, so this branch says what is going on and offers the one action
          that leads somewhere.
        */
        <>
          <p className={styles.empty}>{t("countriesEmpty")}</p>
          {/*
            The way out, and the only state that needs it. With countries in the
            list every row is already a link into `/fr/voyages`, and a fourth
            link to that same page — the main navigation and the latest-trips
            block each carry one — would be noise between the rows and the
            reader's next heading.
          */}
          <a className={styles.allTrips} href={allTripsHref}>
            {t("allTrips")}
          </a>
        </>
      )}
    </div>
  );
}
