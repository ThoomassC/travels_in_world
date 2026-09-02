import { describe, expect, it } from "vitest";
import {
  tallyVisitedCountries,
  untoldOnlyCountryCodes,
  type CountingTrip,
  type CountryLabels,
  type VisitedCountryTally,
} from "@/components/map/countries";

/**
 * The one arithmetic this ticket adds, and the reason it is a pure module rather
 * than a few lines inside the component: "how many trips reach this country" is
 * the fact the map had in **no** channel — the caption gives a number of
 * countries, a marker names a trip and its first arrival, and nothing joined the
 * two.
 *
 * Names are the codes themselves in most cases here, so the assertions are about
 * the arranging and never about ICU's French collation. The two tests that care
 * about real names build their own labels and say so.
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

/** Labels that do not localise: the name is the code. */
const CODE_LABELS: CountryLabels = {
  countryName: (code) => code,
  compare: (left, right) => left.localeCompare(right, "fr"),
};

/**
 * Japan holds two trips and one trip crosses Peru and Bolivia — the two shapes
 * that make a per-country count differ both from a count of trips and from a
 * count of countries. In the content façade's order: `startDate` descending.
 */
const TRIPS: readonly CountingTrip[] = [
  trip("japon-2025", "JP"),
  trip("japon-2024", "JP"),
  trip("perou-bolivie-2023", "PE", "BO"),
  trip("islande-2022", "IS"),
];

const readable = (tally: readonly VisitedCountryTally[]): readonly string[] =>
  tally.map((entry) => `${entry.name} ${entry.tripSlugs.length}`);

describe("tallyVisitedCountries", () => {
  it("counts the trips that reach each country", () => {
    expect(readable(tallyVisitedCountries(TRIPS, CODE_LABELS))).toEqual([
      "BO 1",
      "IS 1",
      "JP 2",
      "PE 1",
    ]);
  });

  it("names the trips of each country, so a single one can be linked directly", () => {
    // The count alone would leave a country holding one trip pointing at a
    // listing the reader then has to search. The slugs make the link precise.
    const byCode = new Map(
      tallyVisitedCountries(TRIPS, CODE_LABELS).map((entry) => [entry.code, entry.tripSlugs])
    );

    expect(byCode.get("JP")).toEqual(["japon-2025", "japon-2024"]);
    expect(byCode.get("BO")).toEqual(["perou-bolivie-2023"]);
    expect(byCode.get("PE")).toEqual(["perou-bolivie-2023"]);
  });

  it("orders by localised name and not by count", () => {
    /**
     * Japan holds the most trips and still comes third. Sorting by count is the
     * tempting "where has he been most" reading and it is refused: the caption
     * beside this list collates the same countries by name, and a reader
     * scanning for one country needs the alphabet they are scanning with.
     */
    const tally = tallyVisitedCountries(TRIPS, {
      countryName: (code) =>
        ({ BO: "Bolivie", IS: "Islande", JP: "Japon", PE: "Pérou" })[code] ?? code,
      compare: new Intl.Collator("fr").compare,
    });

    expect(readable(tally)).toEqual(["Bolivie 1", "Islande 1", "Japon 2", "Pérou 1"]);
  });

  it("collates rather than comparing code units", () => {
    // `"Éthiopie" < "Zambie"` is false in code-unit order — every accented
    // letter sorts after `Z`. The same trap `buildWorldGeometry` records.
    const tally = tallyVisitedCountries([trip("a", "ZM"), trip("b", "ET")], {
      countryName: (code) => (code === "ET" ? "Éthiopie" : "Zambie"),
      compare: new Intl.Collator("fr").compare,
    });

    expect(tally.map((entry) => entry.name)).toEqual(["Éthiopie", "Zambie"]);
  });

  it("counts a country once for a trip that names it twice", () => {
    // `visitedCountryCodes` de-duplicates upstream today, so this is the tally
    // refusing to *depend* on that.
    const tally = tallyVisitedCountries([trip("japon-2024", "JP", "JP", "JP")], CODE_LABELS);

    expect(tally[0]?.tripSlugs).toEqual(["japon-2024"]);
  });

  it("counts one trip for every country it crosses", () => {
    // The audit's gap, stated as arithmetic: a trip crossing three countries
    // tints three and its marker names one.
    expect(readable(tallyVisitedCountries([trip("tour", "PE", "BO", "CL")], CODE_LABELS))).toEqual([
      "BO 1",
      "CL 1",
      "PE 1",
    ]);
  });

  it("answers nothing at all when no trip is published", () => {
    // Today's production state — `content/trips` is empty. The component turns
    // this into a fallback block with a way out, never an empty list.
    expect(tallyVisitedCountries([], CODE_LABELS)).toEqual([]);
  });

  it("never invents a row: every country comes from a trip", () => {
    /**
     * The property that removed a whole class of defect. While this tally read
     * `@/map`'s tinted subset, it was a second rendering of the drawing's own
     * input — so the list died with the geometry it exists to stand in for, and
     * a row could name a country whose trips lived under another country's
     * heading. Derived from the trips, a row without a trip is unrepresentable.
     */
    const tally = tallyVisitedCountries(TRIPS, CODE_LABELS);

    expect(tally.every((entry) => entry.tripSlugs.length > 0)).toBe(true);
  });

  it("has one row per distinct country, so the caption's count cannot disagree", () => {
    // The figcaption says "N pays" from the tinted subset, which `@/map` selects
    // from these very codes — and it fails the build for a code it cannot draw,
    // rather than quietly dropping one. So the two counts are the same count.
    const distinct = new Set(TRIPS.flatMap((entry) => entry.countryCodes));

    expect(tallyVisitedCountries(TRIPS, CODE_LABELS)).toHaveLength(distinct.size);
  });

  it("compares codes exactly, both sides being uppercase by schema", () => {
    /**
     * No `toUpperCase()`, and that is a decision rather than an omission.
     * `CountryCodeSchema` refuses anything but `/^[A-Z]{2}$/`, so a
     * normalisation here would guard a case no input can present — the
     * discipline `frameAround` records after a mutation run killed a floor that
     * guarded nothing. This pins the *absence*: a lowercase code shows up as a
     * second row here rather than silently splitting a count in production.
     */
    expect(tallyVisitedCountries([trip("a", "JP"), trip("b", "jp")], CODE_LABELS)).toHaveLength(2);
  });

  it("scales to sixty trips over twenty-three countries", () => {
    const codes = Array.from({ length: 23 }, (_, index) => `C${String(index).padStart(2, "0")}`);
    // Trip n reaches country n % 23, so the first eleven hold three trips.
    const trips = Array.from({ length: 60 }, (_, index) =>
      trip(`voyage-${index}`, codes[index % 23] ?? "ZZ")
    );

    const tally = tallyVisitedCountries(trips, CODE_LABELS);

    expect(tally).toHaveLength(23);
    expect(tally.reduce((total, entry) => total + entry.tripSlugs.length, 0)).toBe(60);
    expect(tally[0]?.tripSlugs).toHaveLength(3);
    expect(tally[22]?.tripSlugs).toHaveLength(2);
  });

  it("hands back copies, so a caller reordering a row cannot corrupt the next page", () => {
    /**
     * The content façade memoises its parsed trips for the whole build and hands
     * the same objects to every page — the reason `summaryOf` copies every array
     * in `src/domain/trip.ts`. `readonly` is compile-time only.
     */
    const tally = tallyVisitedCountries(TRIPS, CODE_LABELS);
    (tally[2]?.tripSlugs as string[]).reverse();

    expect(tallyVisitedCountries(TRIPS, CODE_LABELS)[2]?.tripSlugs).toEqual([
      "japon-2025",
      "japon-2024",
    ]);
  });
});

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
   * `tallyVisitedCountries` takes of a multi-country trip, and the reason
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
    // the same posture `tallyVisitedCountries` records.
    const trips = [untoldTrip("maroc-2026", "MA", "MA")];

    expect(untoldOnlyCountryCodes(trips)).toEqual(new Set(["MA"]));
  });
});
