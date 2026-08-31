import { describe, expect, it } from "vitest";
import {
  tallyVisitedCountries,
  type NamedCountry,
  type VisitedCountryTally,
} from "@/components/map/countries";

/**
 * The one arithmetic this ticket adds, and the reason it is a pure module rather
 * than a few lines inside the component: "how many trips reach this country" is
 * the fact the map had in **no** channel — the caption gives a number of
 * countries, a marker names a trip and its first arrival, and nothing joined the
 * two. It is worth the cases below rather than a render assertion.
 */

const country = (code: string | null, name: string): NamedCountry => ({ code, name });

/** The order `buildWorldGeometry` hands `visited` in: localised name, collated. */
const VISITED: readonly NamedCountry[] = [
  country("BO", "Bolivie"),
  country("IS", "Islande"),
  country("JP", "Japon"),
  country("PE", "Pérou"),
];

/**
 * One entry per published trip, in the content façade's order. Japan holds two
 * trips and one trip crosses Peru and Bolivia — the two shapes that make a
 * per-country count differ from a count of trips and from a count of countries.
 */
const TRIPS: readonly (readonly string[])[] = [
  ["JP"], // japon-2025
  ["JP"], // japon-2024
  ["PE", "BO"], // perou-bolivie-2023
  ["IS"], // islande-2022
];

const readable = (tally: readonly VisitedCountryTally[]): readonly string[] =>
  tally.map((entry) => `${entry.name} ${entry.trips}`);

describe("tallyVisitedCountries", () => {
  it("counts the trips that reach each country", () => {
    expect(readable(tallyVisitedCountries(VISITED, TRIPS))).toEqual([
      "Bolivie 1",
      "Islande 1",
      "Japon 2",
      "Pérou 1",
    ]);
  });

  it("keeps the order it was given, which is the reader's alphabet and not the count", () => {
    // `visited` arrives sorted by localised name through a `Intl.Collator`, and
    // re-sorting here would make the list disagree with the order the caption
    // enumerates. Sorting by count descending is the tempting alternative and it
    // is refused: a reader scanning for one country needs the alphabet.
    const tally = tallyVisitedCountries(VISITED, TRIPS);

    expect(tally.map((entry) => entry.code)).toEqual(["BO", "IS", "JP", "PE"]);
  });

  it("has exactly one entry per visited country, so the caption's count cannot disagree", () => {
    // The figcaption says "N pays" from `visited.length`; this list is what a
    // reader checks that number against. One row per country, always.
    expect(tallyVisitedCountries(VISITED, TRIPS)).toHaveLength(VISITED.length);
  });

  it("counts a country once for a trip that names it twice", () => {
    // `visitedCountryCodes` de-duplicates upstream today, so this is the tally
    // refusing to *depend* on that: a two-city trip inside one country is one
    // trip, whatever shape its code list arrives in.
    const tally = tallyVisitedCountries([country("JP", "Japon")], [["JP", "JP", "JP"]]);

    expect(tally[0]?.trips).toBe(1);
  });

  it("counts one trip for every country it crosses", () => {
    // The audit's gap, stated as arithmetic: a trip crossing three countries
    // tints three and its marker names one.
    const tally = tallyVisitedCountries(
      [country("BO", "Bolivie"), country("PE", "Pérou")],
      [["PE", "BO"]]
    );

    expect(readable(tally)).toEqual(["Bolivie 1", "Pérou 1"]);
  });

  it("answers nothing at all when no country is visited", () => {
    // Today's production state — `content/trips` is empty. The component turns
    // this into a fallback block with a way out, never an empty list.
    expect(tallyVisitedCountries([], [])).toEqual([]);
  });

  it("keeps a country no trip reaches, and says zero", () => {
    /**
     * Unreachable through the sanctioned path: `visited` is selected *from* the
     * trips' own codes, so a country in it always holds at least one trip.
     *
     * Kept rather than dropped, deliberately. Dropping it would let the list
     * hold fewer rows than the "N pays" the caption announces, and the two
     * channels disagreeing is the failure a reader can actually catch — a
     * visible "0 voyage" leads someone to the wiring bug, a silently missing row
     * leads nowhere.
     */
    const tally = tallyVisitedCountries(
      [country("JP", "Japon"), country("FR", "France")],
      [["JP"]]
    );

    expect(readable(tally)).toEqual(["Japon 1", "France 0"]);
  });

  it("drops the shapes the dataset leaves unidentified", () => {
    /**
     * Three geometries of the 110m set carry no alpha-2 code, which is why
     * `MapCountry.code` is nullable at all. They can never be *visited* —
     * `buildWorldGeometry` selects the tinted subset by code — so this is
     * totality, not a reachable case: a row with no code could be counted by
     * nothing and linked to nowhere.
     */
    const tally = tallyVisitedCountries(
      [country("JP", "Japon"), country(null, "Territoire non identifié")],
      [["JP"]]
    );

    expect(readable(tally)).toEqual(["Japon 1"]);
  });

  it("ignores a code no country on the map carries", () => {
    // A trip in a country the 110m dataset has no geometry for. It counts
    // towards nothing rather than inventing a row the map cannot draw.
    const tally = tallyVisitedCountries([country("JP", "Japon")], [["JP"], ["VA"]]);

    expect(readable(tally)).toEqual(["Japon 1"]);
  });

  it("compares codes exactly, both sides being uppercase by schema", () => {
    /**
     * No `toUpperCase()` here, and that is a decision rather than an omission.
     * `CountryCodeSchema` refuses anything but `/^[A-Z]{2}$/` on the content
     * side, and `src/map/iso-3166.ts` is written with 249 uppercase keys, so a
     * normalisation on this side would guard a case no input can present — the
     * discipline `frameAround` records after a mutation run killed a floor that
     * guarded nothing.
     *
     * This test therefore pins the *absence* of the normalisation, so that a
     * future lowercase code fails loudly here instead of turning every count
     * into a silent zero.
     */
    const tally = tallyVisitedCountries([country("JP", "Japon")], [["jp"]]);

    expect(tally[0]?.trips).toBe(0);
  });

  it("scales to sixty trips over twenty-three countries", () => {
    const codes = Array.from({ length: 23 }, (_, index) =>
      String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26))
    );
    const visited = codes.map((code, index) => country(code, `Pays ${index}`));
    // Trip n reaches country n % 23, so the first eleven countries hold three
    // trips and the rest hold two.
    const trips = Array.from({ length: 60 }, (_, index) => [codes[index % 23] ?? "ZZ"]);

    const tally = tallyVisitedCountries(visited, trips);

    expect(tally).toHaveLength(23);
    expect(tally.reduce((total, entry) => total + entry.trips, 0)).toBe(60);
    expect(tally[0]?.trips).toBe(3);
    expect(tally[22]?.trips).toBe(2);
  });
});
