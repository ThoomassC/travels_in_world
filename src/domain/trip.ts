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
 * The two projections the pages consume: the list page never needs `steps`, the
 * trip page needs everything. Both are built from a parsed trip plus the
 * derivations above, and every field type is taken from the schema rather than
 * written a second time.
 */
export type TripSummary = {
  readonly slug: Trip["slug"];
  readonly title: Trip["title"];
  readonly startDate: Trip["startDate"];
  readonly endDate: Trip["endDate"];
  readonly duration: Duration;
  readonly countryCodes: readonly CountryCode[];
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
