import { countryNameOf, collatorFor } from "@/components/trips/format";
import type { CountryListEntry } from "@/components/countries/country-list";
import type { Locale } from "@/i18n/routing";
import { countrySlugsByCode } from "@/i18n/paths";
import { countryTile } from "@/map";
import { countryRows, type CountryVisit } from "./country";

/**
 * The countries a set of trips reaches, as the rows `CountryList` renders.
 *
 * **Extracted because there are two callers, and they must not drift.** The
 * countries index at `./page.tsx` is one; the home page is the other, where the
 * same list sits under the map on a phone — the map there is 170 px tall with
 * every marker inside 130 × 98 px, so below 768 px the markers are hidden and
 * this list is the navigation. Two hand-copies of the assembly would eventually
 * order or count the same countries two ways on two pages of one site.
 *
 * It lives here rather than in `./country.ts` on purpose: that module is pure and
 * is unit-tested from literals, and `@/map` carries `import "server-only"`. The
 * arithmetic stays there; only the joining is here, and the joining is what both
 * pages need.
 */
export function countryEntries(
  trips: readonly CountryVisit[],
  locale: Locale
): readonly CountryListEntry[] {
  const rows = countryRows(trips, {
    countryName: (code) => countryNameOf(locale, code),
    compare: collatorFor(locale).compare,
  });

  /**
   * **The slugs come from the FRENCH names in every locale**, which is why this
   * resolver is pinned to `"fr"` while the row's label above is the reader's. One
   * address per page, like every other segment of this site — see `countrySlug`
   * in `@/i18n/paths` for the ICU register that keeps it from moving on its own.
   */
  const slugs = countrySlugsByCode(
    rows.map((row) => row.code),
    (code) => countryNameOf("fr", code)
  );

  return rows.map((row) => {
    const slug = slugs.get(row.code);

    /**
     * Unreachable: the map was built from these very codes. It throws rather than
     * dropping the row, because a country silently missing from the list is
     * exactly the failure nobody notices — and this runs at build time, where an
     * exception is a red build and not a broken page.
     */
    if (slug === undefined) {
      throw new Error(`Le pays ${row.code} n'a pas d'adresse : countrySlugsByCode ne l'a pas vu.`);
    }

    return {
      code: row.code,
      name: row.name,
      slug,
      tripCount: row.tripCount,
      placeCount: row.placeCount,
      /**
       * `undefined` for a country the 50m vintage cannot draw — 75 of the 249
       * assigned codes are in that case, Singapore and Hong Kong included (see
       * `src/basemap-coverage.ts`). The row keeps its words; only the ornament is
       * missing.
       */
      outline: countryTile(row.code)?.path,
    };
  });
}
