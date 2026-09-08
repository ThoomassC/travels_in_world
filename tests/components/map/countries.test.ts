import { describe, expect, it } from "vitest";
import { untoldOnlyCountryCodes, type CountingTrip } from "@/components/map/countries";

/**
 * The arithmetic behind the map's third tint, and the reason it is a pure module
 * rather than a few lines inside the component: "is every trip here unwritten" is
 * a question about the *content*, and answering it from the geometry would have
 * meant projecting the world twice per build.
 *
 * **This file used to be twice as long.** Its other half covered
 * `tallyVisitedCountries`, which fed « Les pays visités » under the map. The
 * owner removed that block on 7 September 2026 and the function went with it;
 * `src/components/map/countries.ts` records what replaced it and what it costs.
 * The fixtures below outlived it because they are the interesting shapes — a
 * country holding two trips, a trip crossing two countries — and both matter
 * just as much to the survivor.
 */

/**
 * `story` defaults to `"written"`, which keeps every case that predates TIW-18
 * reading as it did. The untold state is spelled out by {@link untoldTrip}, so no
 * fixture in this file is untold without saying so at the call site.
 */
const trip = (slug: string, ...countryCodes: string[]): CountingTrip => ({
  slug,
  countryCodes,
  story: "written",
});

/** The same, for a trip whose récit is not written. */
const untoldTrip = (slug: string, ...countryCodes: string[]): CountingTrip => ({
  slug,
  countryCodes,
  story: "unwritten",
});

/**
 * Japan holds two trips and one trip crosses Peru and Bolivia — the two shapes
 * that make "every trip here is unwritten" a real question rather than a
 * restatement of the trip list. In the content façade's order: `startDate`
 * descending.
 */
const TRIPS: readonly CountingTrip[] = [
  trip("japon-2025", "JP"),
  trip("japon-2024", "JP"),
  trip("perou-bolivie-2023", "PE", "BO"),
  trip("islande-2022", "IS"),
];

/**
 * **Which countries the map must tint differently** (TIW-18) — the countries
 * every one of whose trips is untold.
 *
 * The condition is "every", not "any", and that is the whole rule. A country
 * holding one written récit and one untold journey has a story to read: tinting
 * it as "à venir" would tell the reader there is nothing there while a récit sits
 * one click away. The distinct state means *nothing here is written yet*, so a
 * single told trip is enough to take a country out of it.
 *
 * Pure and code-only, with no locale and no geometry: the map component receives
 * a set of codes and partitions its own tinted shapes with it, which is what
 * keeps `@/map` untouched — no second projection, and no third bucket to thread
 * through the geometry façade.
 */
describe("untoldOnlyCountryCodes", () => {
  it("answers nothing at all for a journal whose every récit is written", () => {
    expect(untoldOnlyCountryCodes(TRIPS)).toEqual(new Set());
  });

  it("answers nothing for an empty journal, rather than throwing", () => {
    // Today's production state: `content/trips` is empty until TIW-24.
    expect(untoldOnlyCountryCodes([])).toEqual(new Set());
  });

  it("names a country whose only trip is untold", () => {
    const trips = [...TRIPS, untoldTrip("maroc-2026", "MA")];

    expect(untoldOnlyCountryCodes(trips)).toEqual(new Set(["MA"]));
  });

  /**
   * The case the "every" rule exists for, and the one an "any" implementation
   * gets wrong: Japan holds two written récits in `TRIPS`, so an untold third
   * journey there must not take the whole country out of the read state.
   */
  it("leaves a country alone when one of its trips is written", () => {
    const trips = [...TRIPS, untoldTrip("japon-2026", "JP")];

    expect(untoldOnlyCountryCodes(trips)).toEqual(new Set());
  });

  /**
   * A trip crossing two countries carries its state into both — the same reading
   * the deleted tally took of a multi-country trip, and the reason
   * `visitedCountryCodes` counts a country reached only by a move as visited.
   */
  it("carries an untold trip's state into every country it crosses", () => {
    const trips = [untoldTrip("sahara-2026", "MA", "MR", "DZ")];

    expect(untoldOnlyCountryCodes(trips)).toEqual(new Set(["MA", "MR", "DZ"]));
  });

  /**
   * The mixed case, spelled out on one collection rather than assembled from the
   * two above: a country can be told, untold, or told-by-one-of-two, and the
   * answer has to hold all three at once.
   */
  it("partitions a mixed journal country by country", () => {
    const trips = [
      trip("japon-2025", "JP"),
      untoldTrip("japon-2026", "JP"), // JP still told
      untoldTrip("maroc-2026", "MA"), // MA untold
      untoldTrip("perou-2026", "PE", "BO"), // both untold
      trip("bolivie-2024", "BO"), // …except BO, which is told
    ];

    expect(untoldOnlyCountryCodes(trips)).toEqual(new Set(["MA", "PE"]));
  });

  it("counts a country listed twice by one untold trip once", () => {
    // `visitedCountryCodes` de-duplicates upstream; this refuses to depend on it,
    // which is the posture the whole module keeps.
    const trips = [untoldTrip("maroc-2026", "MA", "MA")];

    expect(untoldOnlyCountryCodes(trips)).toEqual(new Set(["MA"]));
  });
});
