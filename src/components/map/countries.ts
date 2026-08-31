/**
 * The map's textual equivalent, reduced to its one piece of arithmetic: for each
 * country the map tints, how many published trips reach it.
 *
 * **Why this number and not another.** An accessibility audit of the delivered
 * map (TIW-20) found the drawing correctly removed from the accessibility tree
 * and three text channels standing in for it — a counted `<figcaption>`, a hidden
 * enumeration of the visited countries, and one link per trip named
 * `{title}, {place}`. What no channel carried was the *relation* between the two
 * lists: five countries on one side, four cities on the other, and nothing
 * joining them. A trip crossing three countries tints three and names one.
 *
 * This module answers the missing half. It does not rebuild the inventory of
 * "which trips, where" — `/fr/voyages` already is that inventory, grouped
 * continent → country → trip, and duplicating it under the map would give a
 * reader two lists to keep in agreement. The count is what links the two: it is
 * the size of the group the country's link lands on.
 *
 * Pure, and free of React, of Next and of both façades, for the reason
 * `docs/adr/0003-carte-svg-inerte-et-balises-html.md` gives for `frame.ts`: the
 * degenerate cases are worth a dozen cheap cases rather than a dozen renders.
 */

/**
 * What the tally reads of a country, and nothing more. Structurally a subset of
 * both `MapCountry` and `@/map`'s `CountryShape`, so either is assignable without
 * a line of adaptation — and, like `MapCountry`, narrower than the thing it
 * receives so that a rename upstream fails the typecheck at the joining page.
 */
export type NamedCountry = {
  /** ISO 3166-1 alpha-2, or `null` for the 3 territories the 110m set leaves unidentified. */
  readonly code: string | null;
  /** Localised name, already resolved upstream by `Intl.DisplayNames`. */
  readonly name: string;
};

export type VisitedCountryTally = {
  /** Non-null by construction: a shape without a code is dropped, see below. */
  readonly code: string;
  readonly name: string;
  /** Published trips reaching this country. Zero is possible, and is kept. */
  readonly trips: number;
};

/**
 * One row per visited country, in the order it was given, each carrying the
 * number of trips that reach it.
 *
 * **The order is the caller's and is never re-derived.** `buildWorldGeometry`
 * hands `visited` sorted by localised name through an `Intl.Collator`, and the
 * `<figcaption>` enumerates it in that same order. Sorting by count here — the
 * tempting "where has he been most" reading — would put the two channels of the
 * same figure in two different orders, and would cost the reader scanning for one
 * country the alphabet they were scanning with.
 *
 * **A country no trip reaches keeps its row, and says zero.** It cannot happen
 * through the sanctioned path, since `visited` is selected *from* the trips' own
 * codes. It is kept rather than filtered because the caption announces
 * `visited.length` countries and this list is what a reader checks that number
 * against: a visible "0 voyage" leads someone to the wiring fault, a silently
 * missing row leads nowhere.
 *
 * **Codes are compared exactly.** `CountryCodeSchema` refuses anything but
 * `/^[A-Z]{2}$/` on the content side and `src/map/iso-3166.ts` is written with
 * 249 uppercase keys, so a `toUpperCase()` here would guard a case no input can
 * present. `frameAround` records the discipline: a guard that cannot be observed
 * is not a safety net, it is a claim nobody can check. The absence is pinned by a
 * test, so a lowercase code fails there rather than turning every count into a
 * silent zero.
 *
 * @param visited The tinted subset of the map, in the order the caption reads it.
 * @param tripCountryCodes One entry per published trip: the codes it reaches.
 *   Repetitions inside one entry are counted once, so a two-city trip inside one
 *   country is one trip whatever shape the façade hands over.
 */
export function tallyVisitedCountries(
  visited: readonly NamedCountry[],
  tripCountryCodes: readonly (readonly string[])[]
): readonly VisitedCountryTally[] {
  const counts = new Map<string, number>();

  for (const codes of tripCountryCodes) {
    // Per *trip* de-duplication, not global: the unit being counted is the trip,
    // so the same code twice in one entry must not count twice.
    for (const code of new Set(codes)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  const tally: VisitedCountryTally[] = [];

  for (const country of visited) {
    /**
     * A shape with no code is dropped. This is totality rather than a reachable
     * case — the tinted subset is selected by code, so a null-coded geometry
     * never enters it — and dropping is the only honest outcome: a row with no
     * code can be counted by nothing and linked to nowhere.
     */
    if (country.code === null) {
      continue;
    }

    tally.push({
      code: country.code,
      name: country.name,
      trips: counts.get(country.code) ?? 0,
    });
  }

  return tally;
}
