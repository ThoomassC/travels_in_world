/**
 * The map's textual equivalent, reduced to its one piece of arithmetic: which
 * countries the published trips reach, and how many trips reach each.
 *
 * **Why this number.** An accessibility audit of the delivered map (TIW-20) found
 * the drawing correctly removed from the accessibility tree and three text
 * channels standing in for it — a counted `<figcaption>`, a hidden enumeration of
 * the visited countries, and one link per trip named `{title}, {place}`. What no
 * channel carried was the *relation* between the two lists: five countries on one
 * side, four cities on the other, and nothing joining them. A trip crossing three
 * countries tints three and names one.
 *
 * **Why it is derived from the trips and not from the geometry.** The first
 * version read `@/map`'s `visited` — the tinted subset — which made the textual
 * equivalent a second rendering of the drawing's own input. That is exactly wrong
 * for the acceptance criterion it serves: "map failed → a fallback block shows the
 * list of countries". `buildWorldGeometry` throws when a declared code has no
 * geometry (`src/map/world.ts`), so the only reachable state with no country shape
 * is one with no declared code either — and the equivalent would have been empty
 * in every state where the drawing was missing. One failure, both channels gone.
 * Reading the trips instead means the list survives the geometry entirely.
 *
 * The count still agrees with the `<figcaption>`'s "N pays": the caption counts
 * the tinted subset, which is selected *from these very codes*, and a code the
 * dataset cannot draw fails the build rather than quietly dropping a row.
 *
 * Pure, and free of React, of Next and of both façades, for the reason
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives for `frame.ts`: the
 * degenerate cases are worth a dozen cheap cases rather than a dozen renders.
 */

/**
 * What the tally reads of a trip, and nothing more. Structurally a subset of
 * `TripSummary`, so the content façade's value is assignable without a line of
 * adaptation — and narrower than it, so `src/app/[locale]/page.tsx`, the one place
 * holding both, is where a rename upstream fails `npm run typecheck`.
 */
export type CountingTrip = {
  /** The content façade's primary key, and the address of the trip's own page. */
  readonly slug: string;
  /** Every country the trip reaches, not just the one its marker names. */
  readonly countryCodes: readonly string[];
};

export type VisitedCountryTally = {
  /** ISO 3166-1 alpha-2, uppercase by schema. */
  readonly code: string;
  /** Localised, resolved by the caller — this module knows no locale. */
  readonly name: string;
  /**
   * The trips reaching this country, in the order they arrived.
   *
   * The count is `tripSlugs.length` and is deliberately not a second field: two
   * numbers that have to agree are two numbers that eventually do not. The slugs
   * are what let a country holding exactly one trip link straight to that trip's
   * page instead of to a listing the reader then has to search.
   */
  readonly tripSlugs: readonly string[];
};

/**
 * How the caller names and orders countries. The same shape `buildCatalogue`
 * takes in `src/components/trips/catalogue.ts`, and for the same reason: the
 * arranging is worth a hundred test cases, an `Intl` lookup is not, and a pure
 * module that took a locale would have to know about `Intl.DisplayNames` and
 * about collation.
 */
export type CountryLabels = {
  /** `Intl.DisplayNames`, supplied by the caller. */
  readonly countryName: (code: string) => string;
  /** The reader's collation — `Intl.Collator.prototype.compare`. */
  readonly compare: (left: string, right: string) => number;
};

/**
 * One row per country the trips reach, ordered by localised name.
 *
 * **Ordered by name, not by count.** "Where has he been most" is the tempting
 * reading and it is refused: the `<figcaption>` beside this list counts the same
 * countries, `buildWorldGeometry` collates them by name, and a reader scanning for
 * one country needs the alphabet they are scanning with. Collated rather than
 * compared with `<`, because `"Éthiopie" < "Zambie"` is false in code-unit order.
 *
 * **A country reached twice by one trip counts once.** `visitedCountryCodes`
 * de-duplicates upstream today, so this is the tally refusing to *depend* on
 * that: a two-city trip inside one country is one trip, whatever shape its code
 * list arrives in.
 *
 * **Codes are compared exactly.** `CountryCodeSchema` refuses anything but
 * `/^[A-Z]{2}$/`, so a `toUpperCase()` here would guard a case no input can
 * present — `frameAround` records the discipline: a guard that cannot be observed
 * is not a safety net, it is a claim nobody can check. And since the codes now
 * come from the content alone, there is no second spelling to reconcile.
 */
export function tallyVisitedCountries(
  trips: readonly CountingTrip[],
  labels: CountryLabels
): readonly VisitedCountryTally[] {
  const slugsByCode = new Map<string, string[]>();

  for (const trip of trips) {
    // Per *trip* de-duplication, not global: the unit being counted is the trip,
    // so the same code twice in one entry must not count twice.
    for (const code of new Set(trip.countryCodes)) {
      const slugs = slugsByCode.get(code);

      if (slugs === undefined) {
        slugsByCode.set(code, [trip.slug]);
      } else {
        slugs.push(trip.slug);
      }
    }
  }

  return [...slugsByCode]
    .map(([code, tripSlugs]) => ({
      code,
      name: labels.countryName(code),
      tripSlugs: [...tripSlugs],
    }))
    .sort((left, right) => labels.compare(left.name, right.name));
}
