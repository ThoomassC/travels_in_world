import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Continent } from "@/domain/continent";
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
  /**
   * The slug of the journal's newest récit, when there is a fresh one (TIW-19) —
   * the same value the home page's listing receives, resolved once by the content
   * façade so the two pages cannot disagree about which trip is new.
   *
   * The badged card is wherever its country falls in the grouping, which is the
   * right answer: this page is a catalogue, and hoisting one trip out of its
   * continent to make the badge easier to find would break the one ordering the
   * reader is promised.
   */
  readonly freshSlug?: string;
};

export function TripCatalogue({ trips, locale, freshSlug }: TripCatalogueProps): ReactElement {
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
              <section key={country.countryCode} className={styles.country}>
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
                      <TripCard
                        trip={trip}
                        locale={locale}
                        headingLevel={4}
                        isNew={trip.slug === freshSlug}
                      />
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
