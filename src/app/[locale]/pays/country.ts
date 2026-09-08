import type { TilePoint } from "@/map";

/**
 * The arithmetic behind the country pages (TIW-39): which trips a country holds,
 * which places, and where those places land on its silhouette.
 *
 * **Colocated with the segment that reads it**, like
 * `src/app/[locale]/a-propos/identity.ts` and
 * `src/app/[locale]/voyages/[slug]/withdrawn-notice.tsx`. Three callers reach it
 * and all three live under this folder — the index, one country's page, and no
 * one else. `src/app/sitemap.ts` deliberately does not: it needs the *addresses*
 * and nothing else, and those come from `@/i18n/paths`, which is where every URL
 * of this project is assembled.
 *
 * Pure, and free of React, of Next and of both façades — the same shape as
 * `src/components/trips/catalogue.ts`, `src/components/places/places.ts` and
 * `src/components/search/entries.ts`, and for the reason those three record: the
 * arranging is worth a hundred cheap assertions, an `Intl` lookup is not, and a
 * page module cannot be loaded by Vitest at all, since it reaches `@/content/trips`
 * and `@/map` — both of which resolve only under Next's bundler.
 *
 * The one import is `import type`, which TypeScript erases before any module
 * resolution: nothing of `@/map` enters this module's runtime graph, and the
 * `map-entry-point` ESLint rule is satisfied by going through the façade. See
 * AGENTS.md, "src/map/** s'atteint par sa façade".
 */

/**
 * What these derivations read of a trip, and nothing more.
 *
 * Structurally a subset of the content façade's `TripDetail`, so its value is
 * assignable without a line of adaptation — and narrower than it, so the two
 * pages, the only places holding both, are where a rename upstream fails
 * `npm run typecheck`. The same posture as `TripEntry`, `VisitingTrip` and
 * `SearchableTrip`; this is the fifth time this repository makes the call.
 *
 * **`places` with their coordinates, hence `loadTrips()` and not
 * `listTripSummaries()`.** The summary carries `countryCodes` and the single
 * `firstArrival`; the full list of places lives on the detail alone, and the
 * silhouette needs a latitude and a longitude per place. The façade memoises its
 * parse for the whole build, so the extra cost is a projection and never a second
 * read of the disk — the note `/villes` already carries.
 */
export type CountryVisit = {
  /** The content façade's primary key. */
  readonly slug: string;
  /** Every country the itinerary touches, ascending by code. */
  readonly countryCodes: readonly string[];
  /** Where the first step arrives — what the catalogue files the trip under. */
  readonly firstArrival: { readonly countryCode: string };
  readonly places: readonly {
    readonly name: string;
    /** ISO 3166-1 alpha-2, uppercase by schema. */
    readonly countryCode: string;
    readonly coordinates: { readonly lat: number; readonly lon: number };
  }[];
};

/**
 * One place of one country, and the trips that reached it.
 *
 * There is no `countryCode` on it: every row of a list built here belongs to the
 * country that was asked for, so carrying the code would be a field whose only
 * possible value is the argument. `src/components/places/places.ts` keeps it
 * because its rows span countries and the pair name-and-country is their
 * identity; here the country is fixed and the name alone identifies a row.
 *
 * The count is `tripSlugs.length` and deliberately not a second field, for the
 * reason the two tallies beside it give: two numbers that have to agree are two
 * numbers that eventually do not.
 */
export type CountryPlace = {
  /** As the content spells it. Not localised, and it cannot be — see `places.ts`. */
  readonly name: string;
  /** The first declaration wins; a place is one point whichever trip reached it. */
  readonly coordinates: { readonly lat: number; readonly lon: number };
  /** The trips that visit this place, in the order they arrived. */
  readonly tripSlugs: readonly string[];
};

/** A place placed inside its country's 40-unit tile — see `src/map/country-tile.ts`. */
export type PlaceMark = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
};

/** One line of the countries index. */
export type CountryRow = {
  /** ISO 3166-1 alpha-2, uppercase — the React key, and what the tile is drawn from. */
  readonly code: string;
  /** Localised, resolved by the caller — this module knows no locale. */
  readonly name: string;
  readonly tripCount: number;
  readonly placeCount: number;
};

/**
 * How the caller names a country and orders the rows. The same shape
 * `CatalogueLabels`, `PlaceLabels` and `SearchLabels` take, and declared here
 * rather than imported from one of them for the reason `places.ts` gives: the
 * four are structurally identical today and answer to four different callers, so
 * sharing one type would make a widening for one of them a change to all four.
 */
export type CountryLabels = {
  /** `Intl.DisplayNames`, supplied by the caller. */
  readonly countryName: (code: string) => string;
  /** The reader's collation — `Intl.Collator.prototype.compare`. */
  readonly compare: (left: string, right: string) => number;
};

/**
 * The trips that reach a country, in the content façade's own order.
 *
 * **Every country the itinerary touches, and not the one the trip is filed
 * under.** `buildCatalogue` files a trip under its *first arrival* because a
 * grouping must show each trip exactly once; a page whose whole subject is one
 * country would be lying to leave out a journey that crossed it. `/villes` reads
 * a place the same way, and `countryRows` below has to agree with this one or the
 * index would count a trip the country's own page does not list.
 *
 * Generic over the trip, so the page can hand its `TripEntry`s straight to
 * `TripCard` without a second projection: what is read is `countryCodes` and the
 * caller keeps whatever else it needs.
 *
 * Codes are compared exactly. `CountryCodeSchema` refuses anything but
 * `/^[A-Z]{2}$/`, so a `toUpperCase()` here would guard a case no input can
 * present.
 */
export function countryTrips<T extends { readonly countryCodes: readonly string[] }>(
  trips: readonly T[],
  code: string
): readonly T[] {
  return trips.filter((trip) => trip.countryCodes.includes(code));
}

/**
 * The places of one country, ordered by name in the reader's collation.
 *
 * **Ordered by name and not by number of stays**, for the reason `/villes`
 * refuses it: a reader scanning seven names for one of them needs the alphabet
 * they are scanning with. Collated rather than compared with `<`, because
 * `"Évian" < "Zurich"` is false in code-unit order and this carnet is full of
 * French place names.
 *
 * **A place declared twice by one trip counts once.** `PlaceSchema`
 * de-duplicates by slug upstream and not by name, so a trip that declares one
 * city as two split stays would otherwise be two visits to it.
 */
export function countryPlaces(
  trips: readonly CountryVisit[],
  code: string,
  compare: (left: string, right: string) => number
): readonly CountryPlace[] {
  const rows = new Map<
    string,
    { readonly place: CountryVisit["places"][number]; readonly slugs: string[] }
  >();

  for (const trip of trips) {
    // Per *trip* de-duplication, not global: the unit being counted is the stay,
    // so the same place twice in one itinerary must not count twice.
    const seen = new Set<string>();

    for (const place of trip.places) {
      if (place.countryCode !== code || seen.has(place.name)) {
        continue;
      }
      seen.add(place.name);

      const row = rows.get(place.name);
      if (row === undefined) {
        rows.set(place.name, { place, slugs: [trip.slug] });
      } else {
        row.slugs.push(trip.slug);
      }
    }
  }

  return [...rows.values()]
    .map(({ place, slugs }) => ({
      name: place.name,
      coordinates: place.coordinates,
      tripSlugs: [...slugs],
    }))
    .sort((left, right) => compare(left.name, right.name));
}

/**
 * The dots of the silhouette: one per place, where the country's own projection
 * puts it.
 *
 * The projection arrives as a function because it comes from `@/map`, which is
 * server-only, and this module is pure — the same seam
 * `src/app/[locale]/layout.tsx` uses to hand `countryTile(...).place` to the
 * search's index.
 *
 * **A place the projection has no answer for is dropped, never defaulted.** The
 * trip page takes the same branch and states the reason: a marker invented for a
 * coordinate that does not project is a confident dot in the wrong country. The
 * place keeps its line in the list below the drawing either way, which is where
 * the information actually lives.
 */
export function placeMarks(
  places: readonly CountryPlace[],
  project: (coordinates: { readonly lat: number; readonly lon: number }) => TilePoint | undefined
): readonly PlaceMark[] {
  return places.flatMap((place) => {
    const point = project(place.coordinates);

    return point === undefined ? [] : [{ name: place.name, x: point.x, y: point.y }];
  });
}

/**
 * Whether `TripCatalogue` renders a section for this country — i.e. whether
 * `/voyages#pays-<CODE>` resolves.
 *
 * **This is a dangling-fragment guard and nothing else.** The catalogue emits
 * `id="pays-<CODE>"` only for a country a trip *arrives* in, because that is how
 * it files a trip; a link built from the set of *visited* countries would dangle
 * for exactly the ones a trip merely crosses. This repository has already paid
 * for that once — `#pays-bo`, measured, recorded in the header of
 * `tests/e2e/dead-links.populated.spec.ts` — and a fragment that names nothing
 * drops the reader at the top of the listing without a word.
 */
export function isFiledUnder(
  trips: readonly { readonly firstArrival: { readonly countryCode: string } }[],
  code: string
): boolean {
  return trips.some((trip) => trip.firstArrival.countryCode === code);
}

/**
 * One row per country the carnet has been to, ordered by the name a reader sees.
 *
 * Ordered on the localised name and not on the code, for the reason
 * `buildCatalogue` gives about its own headings: under French labels, `BE, CH,
 * ES, FR, GR` is an order with no visible cause.
 *
 * The two counts are `countryTrips` and `countryPlaces` asked once per country,
 * so the index and a country's own page cannot disagree about either number —
 * which is the whole reason this is one function and not two lines in a page.
 */
export function countryRows(
  trips: readonly CountryVisit[],
  labels: CountryLabels
): readonly CountryRow[] {
  const codes = new Set(trips.flatMap((trip) => trip.countryCodes));

  return [...codes]
    .map((code) => ({
      code,
      name: labels.countryName(code),
      tripCount: countryTrips(trips, code).length,
      placeCount: countryPlaces(trips, code, labels.compare).length,
    }))
    .sort((left, right) => labels.compare(left.name, right.name));
}
