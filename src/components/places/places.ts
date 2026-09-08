/**
 * The one piece of arithmetic behind `/villes`: which cities and places the
 * published trips reach, and how many stays each one holds.
 *
 * **The twin of `tallyVisitedCountries`** (`src/components/map/countries.ts`),
 * deliberately down to the shape of its contract — same injected labels, same
 * "slugs rather than a count" field, same ordering rule — because the two answer
 * the same question at two grains and a reader who has read one should not have
 * to learn the other. What differs is stated at each field below.
 *
 * **Why the journal owes a place listing at all.** The catalogue on `/voyages`
 * files a trip under the country its first step arrives in, so a place a trip
 * merely passes through has no heading anywhere: Kyoto is on the site, inside a
 * trip page, and no page of the journal lets a reader find it by name. Countries
 * do not stand in for it either — five countries over fourteen places is a
 * grouping so coarse that "where has he actually been" has no answer on the site.
 *
 * **Why it is derived from the trips and from nothing else.** The same reason the
 * country tally gives: the content is the only channel that survives the map's
 * geometry failing, and a listing built from the drawing's own input would be
 * empty in exactly the states where the drawing is missing.
 *
 * Pure, and free of React, of Next and of both façades — no locale, no `Intl`, no
 * URL assembled here. `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives
 * the argument for `frame.ts` and it holds here: the degenerate cases are worth a
 * dozen cheap assertions rather than a dozen renders.
 */

/**
 * What the tally reads of a trip, and nothing more. Structurally a subset of the
 * content façade's `TripDetail`, so its value is assignable without a line of
 * adaptation — and narrower than it, so `src/app/[locale]/villes/page.tsx`, the
 * one place holding both, is where a rename upstream fails `npm run typecheck`.
 *
 * **`places` and not `countryCodes`, which is why the page calls `loadTrips()`
 * and not `listTripSummaries()`.** `TripSummary` carries the countries and the
 * single `firstArrival`; the full list of places lives on the detail alone.
 * Widening the summary to carry it would put a field on every listing in the
 * project — the map's markers, the cards, the feed — to serve one page.
 */
export type VisitingTrip = {
  /** The content façade's primary key, and the fragment this listing links to. */
  readonly slug: string;
  /**
   * Every place the trip declares, in the order the itinerary visits them.
   *
   * The `slug` and the `coordinates` a real `Place` also carries are deliberately
   * absent: neither is read, and the identity note on {@link VisitedPlaceTally}
   * says why the slug in particular must not be.
   */
  readonly places: readonly {
    readonly name: string;
    /** ISO 3166-1 alpha-2, uppercase by schema. */
    readonly countryCode: string;
  }[];
};

export type VisitedPlaceTally = {
  /**
   * The place's name as the content spells it — "Kyoto", "Corse", "Les
   * Sables-d'Olonne". Not localised, and it cannot be: a `trip.yaml` holds one
   * spelling, and there is no table of place names to translate it through. Same
   * shape as the récits themselves, which `src/i18n/routing.ts` records staying
   * French under every locale prefix.
   */
  readonly name: string;
  /** ISO 3166-1 alpha-2 — half of this row's identity; see below. */
  readonly countryCode: string;
  /** Localised, resolved by the caller — this module knows no locale. */
  readonly countryName: string;
  /**
   * The trips that visit this place, in the order they arrived.
   *
   * The count is `tripSlugs.length` and is deliberately not a second field, for
   * the reason the country tally gives: two numbers that have to agree are two
   * numbers that eventually do not. The slugs are what let a place holding
   * exactly one trip address that trip's own entry in the catalogue instead of
   * dropping the reader at the top of a listing they then have to search.
   *
   * **There is no `toldTripSlugs` twin here, and that absence is a decision.**
   * The country tally needs one because its precise branch links to a trip's own
   * *page*, which an untold trip has none of. This listing links to
   * `/voyages#voyage-<slug>`, an id `TripCatalogue` emits for every published
   * trip, told or not — so the distinction has no branch to inform, and a field
   * nobody reads is a field that drifts.
   */
  readonly tripSlugs: readonly string[];
};

/**
 * How the caller names a country and orders the rows. The same shape
 * `CountryLabels` takes in `src/components/map/countries.ts` and `CatalogueLabels`
 * in `src/components/trips/catalogue.ts`, and for the same reason: the arranging
 * is worth a hundred test cases, an `Intl` lookup is not, and a pure module that
 * took a locale would have to know about `Intl.DisplayNames` and about collation.
 *
 * Declared here rather than imported from either neighbour: the three are
 * structurally identical today and answer to three different callers, and sharing
 * one type would make a widening for one of them a change to all three.
 */
export type PlaceLabels = {
  /** `Intl.DisplayNames`, supplied by the caller. */
  readonly countryName: (code: string) => string;
  /** The reader's collation — `Intl.Collator.prototype.compare`. */
  readonly compare: (left: string, right: string) => number;
};

/**
 * The identity of a row: **the pair name-and-country, never the place's slug.**
 *
 * A slug is local to its own `trip.yaml` — `PlaceSchema` only requires it to be
 * unique inside one trip, and `checkTrip` enforces exactly that much — so two
 * files may legitimately spell the same city `valence` and `valencia`. Keyed on
 * the slug, the listing would print one name twice, which is the defect a reader
 * sees. Keyed on the name alone, the French Valence and the Spanish one would
 * merge into a single row whose count is the sum of two different places, which
 * is a wrong number rather than a coarse one.
 *
 * `\u0000` as the separator because it cannot occur in either half:
 * `NonBlankStringSchema` accepts any printable name, so a plain `-` or `/` would
 * let two different pairs collide.
 *
 * **Exported since the filter arrived**, and not as a convenience: `/villes`
 * needs this string twice — as the React key of a row, and as the key that row's
 * filter tokens are stored under — and the two have to be the same string, or a
 * row would be filtered by another row's country. Spelled out at the call site
 * it was a third copy of a rule this module owns.
 */
/**
 * The number a place's row prints, or `null` when it prints none.
 *
 * **A column whose every cell says the same thing is not a column.** Thirteen of
 * the fourteen places in this journal hold exactly one stay, so the listing set
 * « 1 séjour » thirteen times down the page — a value that never varies teaches
 * the eye to skip the line it sits on, and it took the one place worth noticing
 * down with it. Printed only above one, the number recovers the meaning it always
 * had: *this* is a place the journal went back to.
 *
 * A function here rather than a `length > 1` in the page, for one reason: the
 * content of this repository — and of the end-to-end fixture, checked — holds no
 * place visited twice, so a test driven through the rendered page could only ever
 * exercise the branch that hides the number. Both branches are reachable from
 * here.
 *
 * The plural message keeps its singular branch. What is dropped is the *rendering*
 * of a count of one, never the language's ability to say it.
 */
export function repeatedStayCount(place: { readonly tripSlugs: readonly string[] }): number | null {
  return place.tripSlugs.length > 1 ? place.tripSlugs.length : null;
}

export function placeIdentity(place: {
  readonly name: string;
  readonly countryCode: string;
}): string {
  return `${place.countryCode}\u0000${place.name}`;
}

/**
 * One row per place the trips reach, ordered by name in the reader's collation.
 *
 * **Ordered by name, not by count.** "Where has he been most" is the tempting
 * reading and it is refused here for the reason the country tally refuses it: a
 * reader scanning fourteen names for one of them needs the alphabet they are
 * scanning with. Collated rather than compared with `<`, because
 * `"Évian" < "Zurich"` is false in code-unit order and this journal is full of
 * French place names.
 *
 * **Ties break on the country's localised name**, which only two places sharing a
 * name can reach — the Valence case above. Breaking on the raw code instead would
 * order those two rows by `ES` and `FR` under a French heading, which is an order
 * with no visible cause.
 *
 * **A place declared twice by one trip counts once.** `PlaceSchema` de-duplicates
 * by slug upstream, not by name, so a trip that declares "Tokyo" as two split
 * stays would otherwise count as two visits to one city.
 *
 * **Codes are compared exactly.** `CountryCodeSchema` refuses anything but
 * `/^[A-Z]{2}$/`, so a `toUpperCase()` here would guard a case no input can
 * present — the discipline `frameAround` records: a guard that cannot be observed
 * is not a safety net, it is a claim nobody can check.
 */
export function tallyVisitedPlaces(
  trips: readonly VisitingTrip[],
  labels: PlaceLabels
): readonly VisitedPlaceTally[] {
  const rows = new Map<
    string,
    { readonly place: VisitingTrip["places"][number]; slugs: string[] }
  >();

  for (const trip of trips) {
    // Per *trip* de-duplication, not global: the unit being counted is the stay,
    // so the same place twice in one itinerary must not count twice.
    const seen = new Set<string>();

    for (const place of trip.places) {
      const key = placeIdentity(place);

      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const row = rows.get(key);

      if (row === undefined) {
        rows.set(key, { place, slugs: [trip.slug] });
      } else {
        row.slugs.push(trip.slug);
      }
    }
  }

  return [...rows.values()]
    .map(({ place, slugs }) => ({
      name: place.name,
      countryCode: place.countryCode,
      countryName: labels.countryName(place.countryCode),
      tripSlugs: [...slugs],
    }))
    .sort(
      (left, right) =>
        labels.compare(left.name, right.name) || labels.compare(left.countryName, right.countryName)
    );
}
