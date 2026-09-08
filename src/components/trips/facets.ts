import type { FacetedEntry } from "@/components/filters/facets";
import type { TripEntry } from "./entry";

/**
 * Which choices a trip answers to on `/voyages`: every country its itinerary
 * touches, and the year it began.
 *
 * **Why these two axes and no others**, decided against the journal's own
 * content rather than against what a filter usually offers. `continentOf` puts
 * every published trip in one continent today, so a continent filter would be a
 * single button that changes nothing — `buildFacetIndex` would drop it anyway,
 * which is the mechanism doing what this paragraph promises. `story` is in the
 * same state: every trip is `unwritten`, so "récit écrit" is not a choice either.
 * Tags exist in the schema and no `trip.yaml` carries one. Countries and years
 * are the two fields that hold more than one value, which is the whole test.
 *
 * The rules are here and not in the page because both have a boundary worth
 * asserting, and a page that reads the disk cannot be asked a question cheaply.
 * Pure, and locale-free: the country's name arrives from the caller, the way
 * `CatalogueLabels` and `PlaceLabels` take theirs.
 */

export type TripFacetLabels = {
  /** Localised, resolved by the caller — this module knows no locale. */
  readonly countryName: (code: string) => string;
};

/**
 * `YYYY-MM-DD`, the shape `PlainDateSchema` guarantees and `TripEntry` — a
 * structural type over a bare `string` — does not. A day outside it yields no
 * year rather than four characters sliced out of nonsense.
 */
const CALENDAR_DAY = /^(\d{4})-\d{2}-\d{2}$/;

export function tripFacetEntries(
  trips: readonly TripEntry[],
  labels: TripFacetLabels
): readonly FacetedEntry[] {
  return trips.map((trip) => {
    /**
     * **Every country crossed, and not only the one the trip is filed under.**
     *
     * `buildCatalogue` files a trip under its first arrival and records the cost
     * in the same breath: a country a trip merely passes through has no heading
     * anywhere on the site, and "the day this becomes the wrong trade-off is the
     * day filters and search arrive". This is that day, and the answer is to
     * widen the filter rather than the filing — picking Bolivie keeps a
     * Peru-and-Bolivia trip, which stays under the Pérou chapter it has always
     * been under, with both countries named on its own card.
     *
     * The consequence, stated rather than hidden: a chapter heading may name a
     * country other than the one chosen. The alternative was a filter that cannot
     * find a country the journal has visited, which is worse.
     */
    const countries = trip.countryCodes.map((code) => ({
      group: "country",
      value: code,
      label: labels.countryName(code),
    }));

    const year = CALENDAR_DAY.exec(trip.startDate)?.[1];

    /**
     * The year the trip *began*, and not the day it was published. `publishedAt`
     * is when a récit went online — the same day for the nine provisional trips
     * of `content/DATES-FICTIVES.md` — so filtering on it would offer one choice
     * holding everything. A reader looking for "l'été dernier" means the journey.
     */
    return {
      key: trip.slug,
      facets:
        year === undefined
          ? countries
          : [...countries, { group: "year", value: year, label: year }],
    };
  });
}
