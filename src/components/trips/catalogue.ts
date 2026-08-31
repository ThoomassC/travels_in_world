import type { Continent } from "@/domain/continent";
import { continentOf } from "@/domain/continent";
import type { TripEntry } from "./entry";

/**
 * The two derivations the listing pages rest on: which trips the home page shows,
 * and how the full listing is grouped and ordered.
 *
 * Plain functions over plain data — no React, no locale, no disk — so the three
 * boundary states the acceptance criteria name (zero, one, sixty trips) are
 * asserted in `tests/components/trips/catalogue.test.ts` rather than inferred
 * from a rendered page.
 *
 * **Why the names arrive as functions instead of being resolved here.** The
 * ordering key has to be the name a reader sees, or the headings come out in
 * `africa, americas, asia` order under French labels. But a localised name is
 * `Intl.DisplayNames` plus a message catalogue plus an `Intl.Collator`, and all
 * three are the page's business, not this module's — the domain rule that
 * `localeCompare`'s result depends on the runtime's locale data applies just as
 * much one layer up. Injecting them keeps every ordering rule in one place and
 * still lets the suite assert on ordering with a comparator it controls.
 */

export type CatalogueLabels = {
  /** The heading for a continent, or for the group of countries none was found for. */
  readonly continentName: (continent: Continent | null) => string;
  /** The reader-facing name of a country, already localised. */
  readonly countryName: (code: string) => string;
  /** A locale-aware comparator — `Intl.Collator#compare` in production. */
  readonly compare: (left: string, right: string) => number;
};

export type CountryGroup = {
  readonly countryCode: string;
  readonly countryName: string;
  /** In the order the content façade produced: `startDate` descending, then `slug`. */
  readonly trips: readonly TripEntry[];
};

export type ContinentGroup = {
  /** `null` for the countries this project's table cannot place. */
  readonly continent: Continent | null;
  readonly continentName: string;
  readonly countries: readonly CountryGroup[];
  /** Across every country of the group — what the heading announces. */
  readonly tripCount: number;
};

/**
 * The `n` trips the home page shows, taken from the front of a list the content
 * façade has **already** sorted by `startDate` descending with a stable `slug`
 * tiebreak.
 *
 * Deliberately not a sort. Two orderings that have to agree eventually do not,
 * and the façade's is the one every other view already uses — the map's marker
 * order, the full listing, the trip pages. A `slice` cannot drift from it.
 *
 * The copy is not defensive style: the façade memoises its projections for the
 * whole life of a build process, so handing back the array it was given would
 * let one caller's `.sort()` reorder the snapshot every later page renders from.
 */
export function latestTrips(trips: readonly TripEntry[], count: number): readonly TripEntry[] {
  return trips.slice(0, Math.max(0, count));
}

/**
 * A trip is filed under the country its **first step arrives in**, and appears
 * exactly once.
 *
 * The alternative — one entry per visited country — was considered and refused.
 * It reads well for a reader hunting a country and badly for everyone else: the
 * same title and the same link appear under three headings, a screen reader meets
 * the trip three times in one page, and sixty trips become a hundred and twenty
 * entries against a document budget. The arrival is also the anchor the map
 * already uses for a trip's marker, so the two views of the same collection agree
 * about where a trip "is".
 *
 * What that costs, stated rather than hidden: a Japan-and-Thailand trip is not
 * under the Thailand heading. The card names every country it crossed, so the
 * information is on the page — it is the *filing* that is single. The day this
 * becomes the wrong trade-off is the day filters and search arrive, which the
 * ticket puts at fifteen to twenty stories.
 */
export function buildCatalogue(
  trips: readonly TripEntry[],
  labels: CatalogueLabels
): readonly ContinentGroup[] {
  /**
   * Two levels of `Map`, and never an object indexed by the code. A country code
   * arrives from a parsed `trip.yaml`, and `CountryCodeSchema` checks its shape
   * and deliberately not its existence — so `"constructor"` is a value this
   * project accepts, and on a plain object it answers with a function rather than
   * `undefined`. Same reading as `findTrip` in `src/content/loader.ts`.
   *
   * Insertion order is the façade's order, which is what keeps the trips of one
   * country in the order every other view shows them.
   */
  const byContinent = new Map<Continent | null, Map<string, TripEntry[]>>();

  for (const trip of trips) {
    const code = trip.firstArrival.countryCode;
    const continent = continentOf(code);

    let countries = byContinent.get(continent);
    if (countries === undefined) {
      countries = new Map<string, TripEntry[]>();
      byContinent.set(continent, countries);
    }

    const existing = countries.get(code);
    if (existing === undefined) {
      countries.set(code, [trip]);
    } else {
      existing.push(trip);
    }
  }

  const groups: ContinentGroup[] = [];

  for (const [continent, countries] of byContinent) {
    const named: CountryGroup[] = [...countries].map(([countryCode, groupedTrips]) => ({
      countryCode,
      countryName: labels.countryName(countryCode),
      trips: groupedTrips,
    }));

    named.sort((left, right) => labels.compare(left.countryName, right.countryName));

    groups.push({
      continent,
      continentName: labels.continentName(continent),
      countries: named,
      tripCount: named.reduce((total, country) => total + country.trips.length, 0),
    });
  }

  /**
   * Alphabetical on the reader-facing name, with one exception that is not
   * alphabetical at all: the group of countries no continent could be found for
   * always sorts last. It is not a peer of the real continents — it is a
   * remainder — and a heading like "Ailleurs" landing first because of its
   * initial would read as a mistake in the data rather than as a deliberate
   * catch-all.
   */
  groups.sort((left, right) => {
    if (left.continent === null) return right.continent === null ? 0 : 1;
    if (right.continent === null) return -1;

    return labels.compare(left.continentName, right.continentName);
  });

  return groups;
}
