import { describe, expect, it } from "vitest";
import { PlaceSchema, StepSchema, TripSchema } from "@/domain/schema";
import type { TripDetail, TripSummary } from "@/domain/trip";
import { budgetPerPerson, durationOf, visitedCountryCodes } from "@/domain/trip";
import {
  LYON,
  minimalTripInput,
  multiCountryTripInput,
  openEndedTripInput,
  stay,
  TOKYO,
  tripInput,
} from "./fixtures";

/**
 * Derivations. Nothing asserted here is ever stored: a duration, a per-person
 * budget and a country list are all functions of the trip, and the moment one
 * of them gets written into a content file it starts disagreeing with the rest.
 */

describe("durationOf", () => {
  /**
   * The rule, once: `nights` is the number of calendar days between the two
   * dates, `days` is `nights + 1`. A trip of one day has 0 nights and 1 day —
   * which is why `days` cannot be derived by counting nights alone.
   *
   * The last four rows exist for one reason: the dates are civil strings, so
   * *no* row may depend on the machine's timezone. An implementation building
   * local `Date` objects and dividing by 86 400 000 returns 4.958 for the
   * European spring row — `Math.floor` then answers 4 instead of 5. Run the
   * suite with `TZ=Pacific/Auckland` or `TZ=America/Santiago` and these rows
   * must not move.
   */
  it.each([
    {
      label: "the reference trip",
      startDate: "2024-04-12",
      endDate: "2024-04-22",
      nights: 10,
      days: 11,
    },
    { label: "a single day", startDate: "2024-06-01", endDate: "2024-06-01", nights: 0, days: 1 },
    {
      label: "a month boundary",
      startDate: "2024-01-28",
      endDate: "2024-02-03",
      nights: 6,
      days: 7,
    },
    {
      label: "a leap February",
      startDate: "2024-02-27",
      endDate: "2024-03-01",
      nights: 3,
      days: 4,
    },
    {
      label: "a common February",
      startDate: "2023-02-27",
      endDate: "2023-03-01",
      nights: 2,
      days: 3,
    },
    {
      label: "a year boundary",
      startDate: "2024-12-30",
      endDate: "2025-01-02",
      nights: 3,
      days: 4,
    },
    {
      label: "the European spring clock change",
      startDate: "2024-03-28",
      endDate: "2024-04-02",
      nights: 5,
      days: 6,
    },
    {
      label: "the European autumn clock change",
      startDate: "2024-10-24",
      endDate: "2024-10-29",
      nights: 5,
      days: 6,
    },
    {
      label: "the American spring clock change",
      startDate: "2024-03-09",
      endDate: "2024-03-11",
      nights: 2,
      days: 3,
    },
    {
      label: "a full year",
      startDate: "2024-04-12",
      endDate: "2025-04-12",
      nights: 365,
      days: 366,
    },
  ])(
    "counts $nights nights and $days days across $label",
    ({ startDate, endDate, nights, days }) => {
      expect(durationOf({ startDate, endDate })).toEqual({ nights, days });
    }
  );

  it("reads the dates off a parsed trip", () => {
    const trip = TripSchema.parse(tripInput());

    expect(durationOf(trip)).toEqual({ nights: 10, days: 11 });
  });
});

describe("budgetPerPerson", () => {
  /**
   * The rounding rule, stated so it can be argued with: the per-person amount
   * is the total divided by the number of travellers, **rounded to the nearest
   * cent, halves away from zero**. It is an indicative figure, not a partition —
   * 3 × 3334 is 10 002, one cent more than the 10 001 that was spent. Any rule
   * has that property; this one at least never displays less than was paid on
   * average, and it is not the banker's rounding that would answer 2500 for the
   * 10 002 / 4 row.
   */
  it.each([
    {
      label: "a total that does not divide evenly",
      totalCents: 10001,
      travellers: 3,
      expected: 3334,
    },
    { label: "a total that rounds down", totalCents: 10000, travellers: 3, expected: 3333 },
    { label: "a total that divides evenly", totalCents: 9000, travellers: 3, expected: 3000 },
    { label: "an exact half cent", totalCents: 10002, travellers: 4, expected: 2501 },
    { label: "another exact half cent", totalCents: 7, travellers: 2, expected: 4 },
    { label: "a single traveller", totalCents: 42350, travellers: 1, expected: 42350 },
    { label: "a free trip", totalCents: 0, travellers: 4, expected: 0 },
  ])(
    "divides $totalCents cents by $travellers into $expected for $label",
    ({ totalCents, travellers, expected }) => {
      const trip = TripSchema.parse(
        tripInput({ budget: { totalCents, currency: "EUR", travellers } })
      );

      expect(budgetPerPerson(trip)).toEqual({ amountCents: expected, currency: "EUR" });
    }
  );

  it("keeps the currency of the budget it divides", () => {
    const trip = TripSchema.parse(
      tripInput({ budget: { totalCents: 900000, currency: "JPY", travellers: 2 } })
    );

    expect(budgetPerPerson(trip)).toEqual({ amountCents: 450000, currency: "JPY" });
  });

  /**
   * Null, not zero. "No budget recorded" and "this trip cost nothing" are
   * different statements, and the page renders them differently: one hides the
   * line, the other prints 0 €.
   */
  it("returns null when the trip records no budget", () => {
    const trip = TripSchema.parse(minimalTripInput());

    expect(budgetPerPerson(trip)).toBeNull();
  });

  it("returns zero, not null, for a budget of zero", () => {
    const trip = TripSchema.parse(
      tripInput({ budget: { totalCents: 0, currency: "EUR", travellers: 2 } })
    );

    expect(budgetPerPerson(trip)).toEqual({ amountCents: 0, currency: "EUR" });
  });
});

describe("visitedCountryCodes", () => {
  /**
   * Order is ascending alphabetical on the code, not the order the places are
   * declared in. The two disagree in this fixture on purpose: declaration order
   * would answer `["JP", "TH", "FR"]`. Alphabetical is the choice because the
   * list is read as a set ("3 pays : FR, JP, TH"), and a set rendered in file
   * order changes every time someone reorders the YAML.
   */
  it("lists each country once, in ascending alphabetical order", () => {
    const trip = TripSchema.parse(multiCountryTripInput());

    expect(visitedCountryCodes(trip)).toEqual(["FR", "JP", "TH"]);
  });

  it("returns the single country of a single-country trip", () => {
    const trip = TripSchema.parse(minimalTripInput());

    expect(visitedCountryCodes(trip)).toEqual(["FR"]);
  });

  /**
   * Derived from the places the *steps* reference, not from `places[]`. The pair
   * below cannot come out of `TripSchema` — it rejects an unreferenced place —
   * which is precisely the point: the schema closes the gap so the two readings
   * can never disagree, and this test pins which reading the function
   * implements. Built by parsing the primitives, so nothing here is cast.
   */
  it("derives the countries from the places the steps reference, not from places[]", () => {
    const referenced = PlaceSchema.parse(LYON);
    const orphan = PlaceSchema.parse(TOKYO);
    const step = StepSchema.parse(stay("lyon", "2024-06-01", "2024-06-02"));

    expect(visitedCountryCodes({ places: [referenced, orphan], steps: [step] })).toEqual(["FR"]);
  });

  /**
   * A place reached only by a move counts too. `openEndedTripInput` never
   * *stays* in Paris — it flies out of it and back into it — and France is still
   * a visited country. A version reading `placeSlug` alone answers `["JP"]`.
   */
  it("counts a place that only a move references", () => {
    const trip = TripSchema.parse(openEndedTripInput());

    expect(visitedCountryCodes(trip)).toEqual(["FR", "JP"]);
  });
});

describe("TripSummary and TripDetail", () => {
  /**
   * A compile-time contract with a runtime witness. The two projections are the
   * shapes the pages consume — the list page never needs `steps`, the trip page
   * needs everything — and both are built from a parsed trip plus derivations,
   * never from a second hand-written type. `npm run typecheck` is what actually
   * enforces the field lists; the assertions below only keep the file honest at
   * runtime.
   */
  it("projects a parsed trip into a summary and a detail without redeclaring a type", () => {
    const trip = TripSchema.parse(tripInput());

    const summary: TripSummary = {
      slug: trip.slug,
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      duration: durationOf(trip),
      countryCodes: visitedCountryCodes(trip),
      coverPhotoSrc: trip.coverPhotoSrc,
      tags: trip.tags,
    };

    const detail: TripDetail = {
      ...summary,
      places: trip.places,
      steps: trip.steps,
      photos: trip.photos,
      budget: trip.budget,
      budgetPerPerson: budgetPerPerson(trip),
    };

    expect(summary.duration).toEqual({ nights: 10, days: 11 });
    expect(summary.countryCodes).toEqual(["JP", "TH"]);
    expect(detail.steps).toHaveLength(5);
    expect(detail.budgetPerPerson).toEqual({ amountCents: 210000, currency: "EUR" });
  });
});
