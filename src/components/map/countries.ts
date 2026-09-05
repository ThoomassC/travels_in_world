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

import type { StoryState } from "@/domain/schema";
import { hasStory } from "@/domain/trip";

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
  /**
   * Whether the récit is written (TIW-18).
   *
   * Read by both functions here, for two different questions. The tally uses it
   * to decide whether a country's single trip may be linked *to its own page* —
   * an untold trip has none — and {@link untoldOnlyCountryCodes} uses it to
   * decide which countries the drawing tints in the distinct state.
   *
   * Required, like everywhere this field appears: a caller that could omit it
   * would inherit "has a page" by default, which is the fail-open direction
   * `hasStory` exists to refuse.
   */
  readonly story: StoryState;
};

/**
 * **A place the journal has been to with no journey attached** (TIW-36), reduced
 * to what the tally reads of one.
 *
 * Structurally a subset of the content façade's `Place`, so the parsed value is
 * assignable without a line of adaptation — and narrower than it, so
 * `src/app/[locale]/page.tsx`, the one file holding both, is where a rename
 * upstream fails `npm run typecheck`.
 *
 * No `story` field, and that is not an omission to fill in later: a place has no
 * récit to be in one state or another about. It is *always* something the reader
 * cannot yet read, which is why {@link untoldOnlyCountryCodes} needs no predicate
 * for it.
 */
export type CountingPlace = {
  /** The tail of the `#lieu-<slug>` fragment the map's marker points at. */
  readonly slug: string;
  /** « Rouen », as it is displayed. */
  readonly name: string;
  /** ISO 3166-1 alpha-2, uppercase by schema. */
  readonly countryCode: string;
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
  /**
   * The subset of {@link tripSlugs} that has a page to link to (TIW-18).
   *
   * **A second list and not a filter at the call site**, because the row that
   * reads it has to answer two different questions from it and neither is
   * `tripSlugs.length`: *is there a story here at all* (empty means no, and the
   * row then says « récit à venir » rather than relying on the drawing's tint),
   * and *may this row link to one trip's own page* (exactly one, and it is the
   * country's only trip).
   *
   * A subset rather than a count, for the reason the field above gives about two
   * numbers — and because the row needs the slug itself to build the href.
   */
  readonly toldTripSlugs: readonly string[];
  /**
   * The dateless visited places this country holds (TIW-36), in the order they
   * arrived — which the content façade has already made alphabetical by name.
   *
   * **Whole places and not a count**, for the reason `tripSlugs` gives about two
   * numbers, plus one that is its own: the row *renders* them. Each place is the
   * anchor `#lieu-<slug>` that its own marker on the map points at, so this list
   * is what turns « no link to a page that does not exist » into a destination
   * that certainly exists rather than a promise.
   *
   * Empty for a country reached only by trips, which is the ordinary case of a
   * journal whose récits are written.
   */
  readonly places: readonly CountingPlace[];
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
  places: readonly CountingPlace[],
  labels: CountryLabels
): readonly VisitedCountryTally[] {
  const slugsByCode = new Map<string, string[]>();
  const placesByCode = new Map<string, CountingPlace[]>();

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

  /**
   * **The visited places are folded in here, and that is not optional** (TIW-36).
   * The drawing tints a country as soon as *anything* reaches it, places
   * included; a tally built from the trips alone would render « Aucun pays sur la
   * carte pour l'instant » under a map showing five tinted countries and fourteen
   * markers. That is the same single-channel defect the audit of TIW-20 found on
   * the first tint, and it is why this argument is required rather than
   * defaulted.
   */
  for (const place of places) {
    const known = placesByCode.get(place.countryCode);
    if (known === undefined) {
      placesByCode.set(place.countryCode, [place]);
    } else {
      known.push(place);
    }
  }

  const told = new Set(trips.filter(hasStory).map((trip) => trip.slug));
  const codes = new Set([...slugsByCode.keys(), ...placesByCode.keys()]);

  return [...codes]
    .map((code) => {
      const tripSlugs = slugsByCode.get(code) ?? [];

      return {
        code,
        name: labels.countryName(code),
        tripSlugs: [...tripSlugs],
        toldTripSlugs: tripSlugs.filter((slug) => told.has(slug)),
        places: [...(placesByCode.get(code) ?? [])],
      };
    })
    .sort((left, right) => labels.compare(left.name, right.name));
}

/**
 * **The countries the drawing tints in the distinct "récit à venir" state**
 * (TIW-18): those every one of whose trips is untold.
 *
 * **"Every", not "any", and that is the whole rule.** A country holding one
 * written récit and one untold journey has something to read, so marking it as
 * forthcoming would tell the reader there is nothing there while a récit sits one
 * click away. The distinct state means *nothing here is written yet*, which one
 * told trip is enough to falsify.
 *
 * **Codes and not shapes, which is what keeps `@/map` out of this.** The map
 * component already receives its tinted subset from the geometry façade; handed
 * this set, it partitions that subset itself. The alternative — a third bucket
 * returned by `buildWorldGeometry` — would have meant either changing the
 * façade's signature or projecting the world twice per build, for a distinction
 * that is entirely a property of the content.
 *
 * A trip's state reaches **every** country it crosses, the same reading
 * `tallyVisitedCountries` takes of a multi-country trip: a journey through
 * Morocco and Mauritania is unwritten in both.
 */
export function untoldOnlyCountryCodes(
  trips: readonly CountingTrip[],
  places: readonly CountingPlace[]
): ReadonlySet<string> {
  const untold = new Set<string>();
  const told = new Set<string>();

  /**
   * **A visited place is untold by definition** (TIW-36) — there is no récit to
   * read and no page to read it on — so its country joins the set unconditionally
   * and needs no predicate. The subtraction below still applies: a country
   * holding one written récit *and* a dateless place has something to read, and
   * the distinct tint would tell the reader it has not.
   */
  for (const place of places) {
    untold.add(place.countryCode);
  }

  for (const trip of trips) {
    // The target set is chosen once per trip rather than per code, so a trip
    // cannot land in both for two of its own countries.
    const destination = hasStory(trip) ? told : untold;
    for (const code of trip.countryCodes) {
      destination.add(code);
    }
  }

  // Subtracted afterwards, and not skipped during the walk: the told trip of a
  // country may arrive *after* its untold one — the façade orders by `startDate`,
  // which has nothing to do with either.
  for (const code of told) {
    untold.delete(code);
  }

  return untold;
}
