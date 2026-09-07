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
 * **Unless there is only one continent**, in which case its heading is dropped and
 * the countries move up a level. The long note is at the branch itself.
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
 * The heading outline — `h1` page, `h2` continent, `h3` country, `h4` trip, and
 * `h1`, `h2` country, `h3` trip when there is a single continent — is complete
 * either way and is what a reader actually walks a long listing with. The one
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

  /**
   * **One continent means no continent heading**, and the levels below it move up
   * with it.
   *
   * A journal whose every trip is European renders "Europe" once, at the top of
   * the page, over the whole of it — a chapter title for a book with one chapter.
   * It is not a grouping a reader can use, because there is nothing to tell it
   * apart from; it is a word between the introduction and the first country.
   *
   * **The promotion is not cosmetic: without it the outline breaks.** Dropping the
   * `h2` while leaving the countries at `h3` takes the document from `h1` straight
   * to `h3`, which is the skipped level `tests/e2e/heading-order.populated.spec.ts`
   * exists to refuse. So the countries become the `h2` chapters they now are, and
   * the cards under them follow to `h3`.
   *
   * `TripCard` types `headingLevel` as `3 | 4`, which is what makes this pair a
   * typecheck rather than a convention — a third level here would not compile.
   *
   * The count that rode beside the continent heading goes with it. Nothing is
   * lost: with one group its number is the page's own total, which the intro above
   * the listing already states.
   */
  const singleGroup = groups.length === 1;
  const tripHeadingLevel = singleGroup ? 3 : 4;

  return (
    <div className={styles.catalogue}>
      {groups.map((group) => (
        <section key={group.continent ?? "unplaced"} className={styles.continent}>
          {singleGroup ? null : (
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
          )}

          <div className={styles.countries}>
            {group.countries.map((country) => (
              /*
                `id="pays-<CODE>"` — what makes a country's section addressable by
                a fragment.

                **The code is the schema's, so it is UPPERCASE**, and HTML
                fragments are case-sensitive: the address is `#pays-FR`, never
                `#pays-fr`. Worth saying out loud because this project has already
                paid for a dangling `#pays-bo` once — `visited-countries.tsx`
                records the measurement — and because the two spellings look
                interchangeable in a diff.

                **What still does NOT link here, and why the id is emitted
                anyway.** The map's textual equivalent points at a trip's page or
                at this listing whole, because the catalogue files a trip under
                its *first arrival* only: a country a trip merely crosses has no
                section, so a fragment built from the tally would dangle for
                exactly the countries the tally added. That reasoning is about
                which countries have a section — not about whether the ones that
                do should be addressable. `tests/e2e/dead-links.populated.spec.ts`
                resolves every fragment of every rendered link, so a future
                linker is caught by a guard rather than by a reader.
              */
              <section
                key={country.countryCode}
                id={`pays-${country.countryCode}`}
                className={styles.country}
              >
                {singleGroup ? (
                  <h2 className={`${styles.countryHeading} ${styles.countryHeadingTop}`}>
                    {country.countryName}
                  </h2>
                ) : (
                  <h3 className={styles.countryHeading}>{country.countryName}</h3>
                )}

                {/*
                  A list, so the number of trips under a country is announced on
                  entering rather than discovered by scrolling. `role="list"` for
                  the Safari / VoiceOver reason recorded on the map's marker list:
                  `list-style: none` strips the role, and jsdom cannot see it.
                */}
                <ul className={cardStyles.grid} role="list">
                  {country.trips.map((trip) => (
                    /*
                      `id="voyage-<slug>"` — what makes every entry of this
                      listing addressable by a fragment (TIW-18).

                      **What needs it:** a trip whose récit is not written has no
                      page, so the map's marker for it points here, at this
                      entry, which is where its dates, its countries and « Récit à
                      venir » are actually written. Its card carries no link of
                      its own, so this fragment is the whole of its address. A
                      fragment naming nothing leaves the reader silently at the
                      top of a sixty-entry page — measured, on `#pays-bo`, and
                      recorded in `visited-countries.tsx`.

                      **Why `LatestTrips` does not get one**, though it renders
                      the same cards: the home page also renders the map, whose
                      markers already carry `id="voyage-<slug>"` on their own
                      `<li>`. Two elements sharing an `id` in one document is
                      invalid HTML and resolves to whichever comes first, so the
                      scheme belongs to this page and to no other.

                      On the `<li>` and not inside the card, so the fragment lands
                      on the entry's own top edge rather than scrolling past it.
                      Uniqueness comes from `trip.slug` — the content façade's
                      primary key, and `buildCatalogue` files each trip exactly
                      once.
                    */
                    <li key={trip.slug} id={`voyage-${trip.slug}`}>
                      <TripCard
                        trip={trip}
                        locale={locale}
                        headingLevel={tripHeadingLevel}
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
