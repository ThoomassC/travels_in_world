import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { TILE_VIEWBOX } from "@/components/search/search-art";
import { localePathname } from "@/i18n/pathname";
import { countryPath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import styles from "./country-list.module.css";

/**
 * The countries this carnet has been to, one row each: the country's own
 * silhouette, its name, and how much of it the journal holds.
 *
 * **A component and not markup inside a page, because two pages want it.**
 * `/{locale}/pays` is the index this renders today; the home page's map is to
 * carry the same list on a narrow screen, where a planisphere says least. Two
 * spellings of one row is how a count ends up phrased differently on two pages of
 * one site — the defect `countryListOf` in `src/components/trips/format.ts`
 * records having actually shipped.
 *
 * **It takes rows that are already resolved, and reaches no façade.** The name is
 * localised by the caller, the counts are `countryRows`', and the outline is a
 * `d` string the caller got from `@/map`'s `countryTile`. Both façades are
 * server-only, so a component that reached either would be unrenderable under
 * jsdom and would pin this list to the pages that can afford them. The same
 * arrangement, for the same reason, as `SearchIndex` and its `countries` prop.
 *
 * **The address is the one thing it does assemble**, from the slug. Invariant 2
 * of AGENTS.md: no internal URL is built outside `src/i18n/**`, and a ready-made
 * `href` prop would move that assembly into every caller — `localePathname` and
 * never `getPathname` from `@/i18n/navigation`, which would ship next-intl's
 * client `Link` to a list made entirely of plain anchors.
 */

export type CountryListEntry = {
  /** ISO 3166-1 alpha-2, uppercase — the React key. */
  readonly code: string;
  /** Localised, resolved by the caller: this component knows no `Intl`. */
  readonly name: string;
  /** `countrySlug`'s, from `@/i18n/paths` — the last segment of the row's URL. */
  readonly slug: string;
  readonly tripCount: number;
  readonly placeCount: number;
  /**
   * The country's outline in a `0 0 40 40` box — `@/map`'s `countryTile(code)?.path`.
   *
   * Optional, and that is `countryTile`'s own asymmetry rather than caution: a
   * country the 50m vintage cannot draw costs its row a drawing and nothing else,
   * because the row says where the carnet went in words. Failing a build over an
   * ornament would be the wrong trade.
   */
  readonly outline?: string;
};

export type CountryListProps = {
  /**
   * In the order they are to be read — `countryRows` collates on the reader's own
   * alphabet, and a second sort here would be a second rule to disagree with it.
   */
  readonly countries: readonly CountryListEntry[];
  readonly locale: Locale;
};

export function CountryList({ countries, locale }: CountryListProps): ReactElement | null {
  const t = useTranslations("country");

  /**
   * Nothing at all rather than an empty list. A page with no country to show says
   * so in its own words — a sentence and a way out — and an empty `<ul>` above
   * that sentence is exactly the empty block this project's listings refuse.
   */
  if (countries.length === 0) {
    return null;
  }

  return (
    /*
      `role="list"` is redundant markup that is not redundant in practice:
      `list-style: none` strips the list role in Safari with VoiceOver, and a list
      that has lost its role has also lost its item count — the first thing a
      reader entering five countries wants. jsdom keeps the role either way, so no
      unit test can see this. The same note is on `/villes`, on the catalogue's
      grids and on the map's marker list.
    */
    <ul className={styles.list} role="list">
      {countries.map((country) => (
        <li key={country.code}>
          {/*
            One link per row holding every fact, and not a link around the name
            with the counts beside it: a screen reader announces the link and not
            its neighbours, so anything left outside would be a fact the keyboard
            never hears. The same call as the rows of `/villes`.

            The explicit space between the two spans is load-bearing — whether two
            sibling flex items contribute a separator to an accessible name is up
            to the engine, and measured under jsdom the markup without it gives
            "France7 voyages, 7 villes". A whitespace-only text node between two
            flex items is not laid out as an anonymous flex item, so `gap` still
            owns the visual spacing.
          */}
          <a
            className={styles.link}
            href={localePathname({ href: countryPath(country.slug), locale })}
          >
            {country.outline === undefined ? null : (
              /*
                The country's own outline, fitted to its own frame by
                `src/map/country-tile.ts` — not a crop of the planisphere, which
                at this size would be four pixels of coastline.

                `aria-hidden`: it repeats what the row says in words, and a
                drawing that repeats does not inform. The 186 KB of world paths
                stay off this page for the reason the ticket gives; these are 658
                bytes for France.
              */
              <svg
                className={styles.tile}
                viewBox={TILE_VIEWBOX}
                aria-hidden="true"
                focusable="false"
              >
                <path d={country.outline} />
              </svg>
            )}
            <span className={styles.name}>{country.name}</span>{" "}
            <span className={styles.counts}>
              {t("counts", { trips: country.tripCount, places: country.placeCount })}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
