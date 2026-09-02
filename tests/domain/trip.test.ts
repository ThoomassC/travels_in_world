import { describe, expect, it } from "vitest";
import { PlaceSchema, StepSchema, STORY_STATES, TripSchema } from "@/domain/schema";
import type { TripDetail, TripSummary } from "@/domain/trip";
import {
  budgetPerPerson,
  detailOf,
  durationOf,
  firstArrivalOf,
  hasStory,
  summaryOf,
  visitedCountryCodes,
} from "@/domain/trip";
import {
  BANGKOK,
  KYOTO,
  layoverTripInput,
  LYON,
  minimalTripInput,
  multiCountryTripInput,
  openEndedTripInput,
  PARIS,
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
      publishedAt: trip.publishedAt,
      duration: durationOf(trip),
      countryCodes: visitedCountryCodes(trip),
      firstArrival: firstArrivalOf(trip),
      coverPhotoSrc: trip.coverPhotoSrc,
      tags: trip.tags,
      story: trip.story,
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

describe("firstArrivalOf", () => {
  /**
   * **The place the trip's first step arrives at.** A stay arrives where it is
   * spent; a move arrives at its `toSlug`.
   *
   * Two readings are excluded, and each one is a real bug rather than a matter of
   * taste.
   *
   * *Not `places[0]`.* The order of `places[]` in a `trip.yaml` is declarative —
   * the order somebody happened to type the cities in — and reordering it is a
   * legitimate edit that must not move a single pixel of the page.
   *
   * *Not the first step's departure either.* This is the reading that reads
   * plausibly and is wrong: for a trip that opens on a flight, the departure is
   * home. `openEndedTripInput` is Paris → Tokyo → Paris, a shape `TripSchema`
   * documents as valid and very likely the majority of real trips — nobody
   * declares a night at home before leaving — and the departure reading labels a
   * trip to Japan with Paris. Nothing structural catches it: the trip is valid,
   * the coordinates are real, the country exists. It is an error of meaning, so
   * the test for it has to be the one below.
   *
   * `TripSchema` guarantees both halves this needs — at least one step, every step
   * referencing a declared place — which is why the result is a `Place` and not
   * `Place | undefined`.
   *
   * One accepted limit, documented rather than fixed: a contributor who *does*
   * declare a night at home before leaving gets home as the first arrival. That is
   * defensible — they wrote that stay — and correcting it would mean knowing where
   * "home" is, which is a concept the model does not have.
   */
  it("returns the place of the first step when that step is a stay", () => {
    const trip = TripSchema.parse(minimalTripInput());

    expect(firstArrivalOf(trip)).toEqual(PlaceSchema.parse(LYON));
  });

  /**
   * The decisive case. Paris → Tokyo → Paris: the answer is Tokyo, the place the
   * first flight lands in, and explicitly not Paris, the place it left. Reading
   * `referencedPlaceSlugs(steps[0])[0]` — the obvious spelling — answers Paris
   * here, and every other test in this file stays green.
   */
  it("returns the destination of the first step when that step is a move, not its origin", () => {
    const trip = TripSchema.parse(openEndedTripInput());

    expect(firstArrivalOf(trip)).toEqual(PlaceSchema.parse(TOKYO));
    expect(firstArrivalOf(trip).slug).not.toBe("paris");
  });

  /**
   * `places[0]` is Kyoto and the first step is a stay in Tokyo. Any fixture where
   * the two happen to coincide is satisfied by a `places[0]` implementation, so it
   * proves nothing at all.
   */
  it("ignores places[0] when the first step does not arrive there", () => {
    const trip = TripSchema.parse(tripInput({ places: [KYOTO, TOKYO, BANGKOK] }));

    expect(trip.places[0]?.slug).toBe("kyoto");
    expect(firstArrivalOf(trip).slug).toBe("tokyo");
  });

  /**
   * A layover counts. `layoverTripInput` flies Paris → Bangkok → Tokyo with no
   * stay in Bangkok, and the answer is **Bangkok**: the traveller did arrive
   * there first, and this projection reports the itinerary rather than guessing at
   * the trip's "real" destination. Deliberate, not an accident of the rule — the
   * assertion is here to freeze the choice, and `places[0]` is Tokyo so a
   * `places[0]` reading fails it too.
   */
  it("returns the layover when the trip opens on a flight that stops on the way", () => {
    const trip = TripSchema.parse(layoverTripInput({ places: [TOKYO, BANGKOK, PARIS] }));

    expect(trip.places[0]?.slug).toBe("tokyo");
    expect(firstArrivalOf(trip).slug).toBe("bangkok");
    expect(firstArrivalOf(trip).slug).not.toBe("paris");
  });
});

/**
 * `hasStory` — one predicate, named once, read by everything that has to decide
 * whether a trip has a page (TIW-18).
 *
 * **Why a function for a string comparison.** Five call sites need the answer —
 * the loader's two publication doors, the sitemap, the feed and the freshness
 * derivation — and a `trip.story === "written"` written five times is five places
 * to miss the day a third state arrives. It is also the direction that fails
 * *closed*: a new state is "no story" until someone decides otherwise, rather
 * than "has a story" because it is not the one value somebody remembered to
 * exclude.
 */
describe("hasStory", () => {
  it.each([
    { story: "written", expected: true },
    { story: "unwritten", expected: false },
  ] as const)("answers $expected for a $story récit", ({ story, expected }) => {
    expect(hasStory({ story })).toBe(expected);
  });

  /**
   * Tested against the schema's own list rather than against two literals: the
   * day `STORY_STATES` gains a member, this case fails and somebody has to decide
   * what a page means for it — instead of the new state silently inheriting
   * whichever branch the `!==` happened to put it in.
   */
  it("has an answer for every state the schema accepts", () => {
    for (const story of STORY_STATES) {
      expect(typeof hasStory({ story })).toBe("boolean");
    }

    expect(STORY_STATES.filter((story) => hasStory({ story }))).toEqual(["written"]);
  });

  it("reads a parsed trip, whose story key is always present", () => {
    expect(hasStory(TripSchema.parse(minimalTripInput()))).toBe(true);
    expect(hasStory(TripSchema.parse(minimalTripInput({ story: "unwritten" })))).toBe(false);
  });
});

describe("summaryOf", () => {
  it("carries the fields the list page renders", () => {
    const trip = TripSchema.parse(tripInput());

    expect(summaryOf(trip)).toEqual({
      slug: "japon-2024",
      title: "Japon, printemps 2024",
      startDate: "2024-04-12",
      endDate: "2024-04-22",
      // A different day from `endDate` in the fixture, on purpose: the freshness
      // derivation reads this one, and a summary copying the wrong date would be
      // indistinguishable here if the two agreed.
      publishedAt: "2024-05-02",
      duration: { nights: 10, days: 11 },
      countryCodes: ["JP", "TH"],
      firstArrival: PlaceSchema.parse(TOKYO),
      coverPhotoSrc: "/photos/japon-2024/tokyo.jpg",
      tags: ["asie", "train"],
      /**
       * On the summary and not only on the detail, and that is the whole point of
       * the field being here (TIW-18): the three views that need it are all
       * *listings* — a card decides whether its title is a link at all, the map's
       * marker decides where it points, and the sitemap and the feed decide
       * whether to advertise an address. The detail page never reads it, because a
       * page that renders at all is a page whose story is written.
       */
      story: "written",
    });
  });

  /**
   * The derivations are not recomputed by hand here: the summary must *be* the
   * derivation, so that fixing a rounding or an ordering rule in one place fixes
   * the card too.
   */
  it("takes its duration, its countries and its first arrival from the derivations", () => {
    const trip = TripSchema.parse(multiCountryTripInput());
    const summary = summaryOf(trip);

    expect(summary.duration).toEqual(durationOf(trip));
    expect(summary.countryCodes).toEqual(visitedCountryCodes(trip));
    expect(summary.firstArrival).toEqual(firstArrivalOf(trip));
  });

  /**
   * The list page never needs the itinerary, the photos or the money — and it
   * must not receive `draft` either. In production that flag is `false` for every
   * trip the page can see, so the only thing a consumer could do with it is draw
   * a conclusion that is always wrong on the one environment where it is not.
   */
  it.each(["steps", "photos", "budget", "budgetPerPerson", "places", "draft"])(
    "leaves %s off the summary",
    (field) => {
      const trip = TripSchema.parse(tripInput());

      expect(summaryOf(trip)).not.toHaveProperty(field);
    }
  );

  it("leaves draft off the summary of a draft trip too", () => {
    const trip = TripSchema.parse(tripInput({ draft: true }));

    expect(trip.draft).toBe(true);
    expect(summaryOf(trip)).not.toHaveProperty("draft");
  });

  /** A trip with no cover and no tag still projects — both are optional content. */
  it("projects a minimal trip, cover and tags included as they are", () => {
    const trip = TripSchema.parse(minimalTripInput());
    const summary = summaryOf(trip);

    expect(summary.coverPhotoSrc).toBeUndefined();
    expect(summary.tags).toEqual([]);
  });
});

describe("detailOf", () => {
  it("carries every summary field plus the itinerary, the photos and the budget", () => {
    const trip = TripSchema.parse(tripInput());
    const detail = detailOf(trip);

    expect(detail).toMatchObject(summaryOf(trip));
    expect(detail.places).toEqual(trip.places);
    expect(detail.steps).toEqual(trip.steps);
    expect(detail.photos).toEqual(trip.photos);
    expect(detail.budget).toEqual({ totalCents: 420000, currency: "EUR", travellers: 2 });
  });

  it("computes the per-person budget when the trip records one", () => {
    const trip = TripSchema.parse(
      tripInput({ budget: { totalCents: 10001, currency: "EUR", travellers: 3 } })
    );

    expect(detailOf(trip).budgetPerPerson).toEqual({ amountCents: 3334, currency: "EUR" });
  });

  /**
   * `null`, not zero and not an absent key. "No budget recorded" and "this trip
   * cost nothing" are different statements, and the trip page renders them
   * differently — one hides the line, the other prints 0 €.
   */
  it("reports a null per-person budget when the trip records none", () => {
    const trip = TripSchema.parse(minimalTripInput());
    const detail = detailOf(trip);

    expect(detail.budget).toBeUndefined();
    expect(detail.budgetPerPerson).toBeNull();
    expect(detail.photos).toEqual([]);
  });

  /**
   * The detail is what the trip page consumes, and the page decides on 404 before
   * it renders — so `draft` is the loader's business, not the projection's. Kept
   * off both projections rather than only off the summary: one shape to reason
   * about, and no field that means something different per environment.
   */
  it("leaves draft off the detail as well", () => {
    const trip = TripSchema.parse(tripInput({ draft: true }));

    expect(detailOf(trip)).not.toHaveProperty("draft");
  });
});
