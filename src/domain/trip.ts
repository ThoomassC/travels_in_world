import { daysBetween } from "./geo";
import type { CountryCode, PlainDate } from "./geo";
import { referencedPlaceSlugs } from "./schema";
import type { Budget, Photo, Place, Step, Tag, Trip } from "./schema";

/**
 * Derivations. Nothing here is ever stored: a duration, a per-person budget and
 * a country list are all functions of the trip, and the moment one of them is
 * written into a content file it starts disagreeing with the rest.
 */

export type Duration = { readonly nights: number; readonly days: number };

/**
 * `nights` is the number of calendar days between the two dates, `days` is
 * `nights + 1`. A one-day trip has 0 nights and 1 day, which is why `days`
 * cannot be counted from nights alone.
 */
export function durationOf(range: {
  readonly startDate: PlainDate;
  readonly endDate: PlainDate;
}): Duration {
  const nights = daysBetween(range.startDate, range.endDate);

  return { nights, days: nights + 1 };
}

export type PerPersonBudget = {
  readonly amountCents: number;
  readonly currency: Budget["currency"];
};

/**
 * An indicative figure, not a partition: rounded to the nearest cent with halves
 * away from zero, so 3 × 3334 is one cent more than the 10 001 that was spent.
 * Any rule has that property; this one never displays less than the average paid.
 *
 * `null`, not zero, when there is no budget — "nothing recorded" and "cost
 * nothing" are different statements and the page renders them differently.
 */
export function budgetPerPerson(trip: { readonly budget?: Budget | null }): PerPersonBudget | null {
  const budget = trip.budget;
  // `== null` covers both spellings of absence, and the domain's real source is
  // YAML: a `budget:` key left empty parses as `null`, never `undefined`. A
  // strict `=== undefined` walks straight into `null.totalCents`, and the trip
  // page — the one page that renders a budget — is the page that crashes.
  if (budget == null) {
    return null;
  }

  // Totals are non-negative (`BudgetSchema`), so `Math.round` is halves-up and
  // halves-away-from-zero at once — and never the banker's rounding that would
  // answer 2500 for 10 002 / 4.
  return {
    amountCents: Math.round(budget.totalCents / budget.travellers),
    currency: budget.currency,
  };
}

/**
 * The countries of the places the *steps* reach — including a place only a move
 * ever touches, which is how a country flown out of and back into still counts
 * as visited. Reading `places[]` instead would count a leftover declaration;
 * `TripSchema` rejects those, so the two readings can never disagree, and this
 * is the one the derivation implements.
 *
 * Ascending alphabetical on the code, not declaration order: the list is read as
 * a set ("3 pays : FR, JP, TH"), and a set rendered in file order changes every
 * time someone reorders the YAML.
 */
export function visitedCountryCodes(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): readonly CountryCode[] {
  const referenced = new Set<string>();
  for (const step of trip.steps) {
    for (const slug of referencedPlaceSlugs(step)) {
      referenced.add(slug);
    }
  }

  const codes = new Set<CountryCode>();
  for (const place of trip.places) {
    if (referenced.has(place.slug)) {
      codes.add(place.countryCode);
    }
  }

  // Default `sort` compares UTF-16 code units — deterministic everywhere, unlike
  // `localeCompare`, whose order depends on the runtime's locale data.
  return [...codes].sort();
}

/**
 * An invariant `TripSchema` guarantees was violated, which means the value never
 * went through it. Named rather than papered over with a `!` or a made-up place:
 * a derivation that invents a coordinate puts a marker somewhere on the map and
 * nobody ever learns why, whereas this message says exactly what to fix — parse
 * before deriving (`docs/adr/0001-domain-purity.md`).
 */
function notFromTheSchema(detail: string): Error {
  return new Error(
    `firstArrivalOf received a value TripSchema.parse() cannot produce: ${detail}. Parse the trip before deriving from it — see docs/adr/0001-domain-purity.md.`
  );
}

/**
 * **The place the trip's first step arrives at.** A stay arrives where it is
 * spent; a move arrives at its `toSlug`.
 *
 * Two readings are excluded, and both are real bugs rather than matters of taste
 * — this one was written wrong once in this very ticket and caught in review.
 *
 * *Not `places[0]`.* The order of `places[]` in a `trip.yaml` is declarative —
 * the order somebody happened to type the cities in — so reordering the file is a
 * legitimate edit that would move the trip's marker on the map.
 *
 * *Not the first step's departure either.* This is the reading that reads
 * plausibly and is wrong: for a trip that opens on a flight, the departure is
 * home. `TripSchema` documents Paris → Tokyo → Paris as valid — nobody declares a
 * night at home before leaving, so that is the shape of most real trips — and the
 * departure reading labels a trip to Japan with Paris. Nothing structural catches
 * it: the trip is valid, the coordinates are real, the country exists.
 *
 * Hence `.at(-1)` over {@link referencedPlaceSlugs}, which answers `[placeSlug]`
 * for a stay and `[fromSlug, toSlug]` for a move: the last entry is the arrival
 * in both cases.
 *
 * One accepted limit, documented rather than fixed: a contributor who *does*
 * declare a night at home before leaving gets home as the first arrival. That is
 * defensible — they wrote that stay — and correcting it would mean knowing where
 * "home" is, which is a concept this model does not have.
 *
 * `TripSchema` guarantees both halves this needs — at least one step, and every
 * step referencing a declared place — which is why the result is a `Place` and
 * not `Place | undefined`. The three guards below restore what
 * `noUncheckedIndexedAccess` takes away without a cast, and they are unreachable
 * for any value that came out of `TripSchema.parse()`.
 */
export function firstArrivalOf(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): Place {
  const first = trip.steps[0];
  if (first === undefined) {
    throw notFromTheSchema("steps[] is empty, which TripSchema rejects");
  }

  const arrivalSlug = referencedPlaceSlugs(first).at(-1);
  if (arrivalSlug === undefined) {
    throw notFromTheSchema("the first step references no place at all");
  }

  const arrival = trip.places.find((place) => place.slug === arrivalSlug);
  if (arrival === undefined) {
    throw notFromTheSchema(
      `the first step arrives at "${arrivalSlug}", which is absent from places[]`
    );
  }

  return arrival;
}

/**
 * The two projections the pages consume: the list page never needs `steps`, the
 * trip page needs everything. Both are built from a parsed trip plus the
 * derivations above, and every field type is taken from the schema rather than
 * written a second time.
 *
 * **Neither of them carries `draft`**, and that is deliberate. In production the
 * flag is `false` for every trip a page can see, so the only thing a consumer
 * could do with it is draw a conclusion that is always wrong on the one
 * environment where it is not: somebody writes `if (trip.draft)`, it works on
 * localhost, it never runs once online, and nothing says so. Whether a draft is
 * published is the loader's decision, taken before a projection exists.
 */
export type TripSummary = {
  readonly slug: Trip["slug"];
  readonly title: Trip["title"];
  readonly startDate: Trip["startDate"];
  readonly endDate: Trip["endDate"];
  readonly duration: Duration;
  readonly countryCodes: readonly CountryCode[];
  /**
   * Where the first step arrives, which is where the itinerary begins. Stated as
   * the fact and not as a use: naming a rendering — a marker, a pin — is what got
   * `anchorPlace` refused, and the domain does not know that a map exists.
   */
  readonly firstArrival: Place;
  readonly coverPhotoSrc: Trip["coverPhotoSrc"];
  readonly tags: readonly Tag[];
};

export type TripDetail = TripSummary & {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
  readonly photos: readonly Photo[];
  readonly budget: Trip["budget"];
  readonly budgetPerPerson: PerPersonBudget | null;
};

/**
 * Field by field, never a spread of the parsed trip: the projection is the list
 * of fields the list page may see, and `{ ...trip }` would hand it `steps`,
 * `budget` and `draft` the day one of them is added to the schema. Every derived
 * value is taken from the derivation above rather than recomputed, so fixing a
 * rounding or an ordering rule fixes the card too.
 *
 * **Every array is copied, and that is not defensive style.** The caller of these
 * projections memoises the parsed `Trip`s for the whole life of a build process
 * and hands the same objects to every page, so a field returned by reference is
 * *shared*. `readonly` is compile-time only: a consumer writing
 * `detail.steps.sort(byDate)` or `detail.photos.reverse()` would reorder the
 * snapshot for every page rendered afterwards, with no error anywhere. A copy per
 * projection is one small array per page, which is nothing next to a corrupted
 * build.
 *
 * The limit, so nobody reads more into it than it gives: this protects against
 * `sort`, `reverse`, `push` and their kin, **not** against mutating an object
 * *inside* an array — `detail.places[0].coordinates.lat = 0` still reaches the
 * memoised trip, and so does `summary.firstArrival`, which is a `Place` and not an
 * array. A deep freeze would close that, and would be paid on every page for a
 * risk no consumer in this repository presents; the shallow copy closes the one
 * that reads as ordinary code.
 *
 * `countryCodes` and `duration` need no copy: the derivations above build a fresh
 * value on every call.
 */
export function summaryOf(trip: Trip): TripSummary {
  return {
    slug: trip.slug,
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    duration: durationOf(trip),
    countryCodes: visitedCountryCodes(trip),
    firstArrival: firstArrivalOf(trip),
    coverPhotoSrc: trip.coverPhotoSrc,
    tags: [...trip.tags],
  };
}

/**
 * The detail is a superset of the summary — the trip page renders both halves —
 * so it is built *on* `summaryOf` rather than beside it. Two field lists that
 * have to agree are two field lists that eventually do not.
 */
export function detailOf(trip: Trip): TripDetail {
  return {
    ...summaryOf(trip),
    // Copied, for the reason written on `summaryOf`: these three are the arrays a
    // page is most likely to sort, and the trip they come from is memoised.
    places: [...trip.places],
    steps: [...trip.steps],
    photos: [...trip.photos],
    budget: trip.budget,
    budgetPerPerson: budgetPerPerson(trip),
  };
}
