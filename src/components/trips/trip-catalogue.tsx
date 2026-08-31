import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Continent } from "@/domain/continent";
import { countryAnchor } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import { buildCatalogue } from "./catalogue";
import type { TripEntry } from "./entry";
import { collatorFor, countryNameOf } from "./format";
import cardStyles from "./trip-card.module.css";
import { TripCard } from "./trip-card";
import styles from "./trip-catalogue.module.css";

/**
 * Every published trip, grouped by continent and then by country, each group in
 * the reader's own alphabetical order and each trip in the content façade's —
 * `startDate` descending, ties broken by `slug`.
 *
 * All of the arranging is `buildCatalogue`, which is a pure function tested
 * against the three states the acceptance criteria name (zero, one, sixty
 * trips). This component supplies the three things that function refuses to
 * know — the localised name of a continent, the localised name of a country and
 * the locale's collation — and turns the result into headings.
 *
 * **Structure by headings, not by landmarks.** Sixty trips over twelve countries
 * and five continents would be seventeen labelled `<section>` regions, and a
 * screen reader's landmark list would then be less useful than no list at all.
 * The heading outline — `h1` page, `h2` continent, `h3` country, `h4` trip — is
 * complete and is what a reader actually walks a long listing with. The one
 * landmark is `<main>`, which the page owns.
 */

/**
 * Continent to message key. A `Record` over the union rather than a template
 * string: `t(\`continent${continent}\`)` compiles, ships, and renders the raw key
 * the day a continent is added — where this stops compiling.
 */
const CONTINENT_MESSAGE_KEY: Record<Continent, string> = {
  africa: "continentAfrica",
  americas: "continentAmericas",
  antarctica: "continentAntarctica",
  asia: "continentAsia",
  europe: "continentEurope",
  oceania: "continentOceania",
};

export type TripCatalogueProps = {
  readonly trips: readonly TripEntry[];
  readonly locale: Locale;
};

export function TripCatalogue({ trips, locale }: TripCatalogueProps): ReactElement {
  const t = useTranslations("trips");
  const collator = collatorFor(locale);

  const groups = buildCatalogue(trips, {
    /** `null` is the group of countries the table could not place — see `continentOf`. */
    continentName: (continent) =>
      t(continent === null ? "continentUnplaced" : CONTINENT_MESSAGE_KEY[continent]),
    countryName: (code) => countryNameOf(locale, code),
    compare: collator.compare,
  });

  return (
    <div className={styles.catalogue}>
      {groups.map((group) => (
        <section key={group.continent ?? "unplaced"} className={styles.continent}>
          <div className={styles.continentHeader}>
            <h2 className={styles.continentHeading}>{group.continentName}</h2>
            {/*
              The count is beside the heading and not inside it: in the heading
              it becomes part of the accessible name, so a reader navigating by
              heading hears "Asie 12 voyages" twelve times over instead of the
              chapter titles they are scanning for.
            */}
            <p className={styles.count}>{t("continentCount", { count: group.tripCount })}</p>
          </div>

          <div className={styles.countries}>
            {group.countries.map((country) => (
              /*
                `id` is the landing point of the map's textual equivalent
                (TIW-15): a country under the map links to the group of trips
                that country holds, which is this section. The spelling comes
                from `countryAnchor` rather than being written here, so the two
                sides cannot drift — a fragment that matches nothing does not
                fail, it silently leaves the reader at the top of the page.

                `tabIndex={-1}` for the same reason `<main>` carries it: without
                it Safari moves the scroll position and not the focus, so the
                next Tab resumes from the top of the document instead of from
                the country the reader asked for.
              */
              <section
                key={country.countryCode}
                id={countryAnchor(country.countryCode)}
                tabIndex={-1}
                className={styles.country}
              >
                <h3 className={styles.countryHeading}>{country.countryName}</h3>

                {/*
                  A list, so the number of trips under a country is announced on
                  entering rather than discovered by scrolling. `role="list"` for
                  the Safari / VoiceOver reason recorded on the map's marker list:
                  `list-style: none` strips the role, and jsdom cannot see it.
                */}
                <ul className={cardStyles.grid} role="list">
                  {country.trips.map((trip) => (
                    <li key={trip.slug}>
                      <TripCard trip={trip} locale={locale} headingLevel={4} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
