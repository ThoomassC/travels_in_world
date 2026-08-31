import { describe, expect, it } from "vitest";
import { buildCatalogue, latestTrips } from "@/components/trips/catalogue";
import { CODE_LABELS, SIXTY_TRIPS, tripEntry, tripIn } from "./fixtures";

/**
 * The two derivations behind the listing pages: which three trips the home page
 * shows, and how the full listing is grouped and ordered.
 *
 * Both are plain functions over plain data — no React, no disk, no locale — so
 * the three boundary states the acceptance criteria name (zero trips, one trip,
 * sixty trips) are asserted here rather than inferred from a rendered page.
 */

const codes = (trips: readonly { readonly slug: string }[]): readonly string[] =>
  trips.map((trip) => trip.slug);

describe("latestTrips", () => {
  it("answers an empty list for no trip at all", () => {
    // The production state until the first trip is written: `content/trips` is
    // empty, so this is what the home page renders today.
    expect(latestTrips([], 3)).toEqual([]);
  });

  it("answers the single trip when there is only one", () => {
    const only = tripEntry();

    expect(latestTrips([only], 3)).toEqual([only]);
  });

  it("takes the first three of sixty, and no more", () => {
    const latest = latestTrips(SIXTY_TRIPS, 3);

    expect(latest).toHaveLength(3);
    expect(codes(latest)).toEqual(codes(SIXTY_TRIPS.slice(0, 3)));
  });

  it("does not re-sort what the content façade already ordered", () => {
    /**
     * The façade sorts by `startDate` descending with a stable `slug` tiebreak,
     * and re-sorting here would be a second ordering rule to keep in agreement
     * with the first. So the guard is that the input order is preserved verbatim
     * — including an order this function would never have produced itself.
     */
    const scrambled = [
      tripEntry({ slug: "b", startDate: "2020-01-01" }),
      tripEntry({ slug: "a", startDate: "2024-01-01" }),
      tripEntry({ slug: "c", startDate: "2022-01-01" }),
    ];

    expect(codes(latestTrips(scrambled, 3))).toEqual(["b", "a", "c"]);
  });

  it("never hands back the array it was given", () => {
    // The façade memoises its projections for the whole build; a returned
    // reference is a shared array a caller could sort in place.
    const trips = [tripEntry()];

    expect(latestTrips(trips, 3)).not.toBe(trips);
  });
});

describe("buildCatalogue", () => {
  it("answers an empty list for no trip at all, rather than empty headings", () => {
    // "No empty block" is an acceptance criterion: a continent heading with
    // nothing under it is exactly what the page must never render.
    expect(buildCatalogue([], CODE_LABELS)).toEqual([]);
  });

  it("builds one continent, one country and one trip from a single trip", () => {
    const only = tripEntry();
    const catalogue = buildCatalogue([only], CODE_LABELS);

    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.continent).toBe("asia");
    expect(catalogue[0]?.tripCount).toBe(1);
    expect(catalogue[0]?.countries).toHaveLength(1);
    expect(catalogue[0]?.countries[0]?.countryCode).toBe("JP");
    expect(catalogue[0]?.countries[0]?.trips).toEqual([only]);
  });

  it("groups by continent, then by country", () => {
    const catalogue = buildCatalogue(
      [tripIn("FR", 0), tripIn("JP", 1), tripIn("IT", 2), tripIn("TH", 3)],
      CODE_LABELS
    );

    expect(
      catalogue.map((group) => [group.continent, group.countries.map((c) => c.countryCode)])
    ).toEqual([
      ["asia", ["JP", "TH"]],
      ["europe", ["FR", "IT"]],
    ]);
  });

  it("orders continents and countries by the name the reader sees", () => {
    /**
     * The ordering key is the *localised* name, not the code — otherwise the
     * headings read "africa, americas, asia" in French and "Afrique, Amériques,
     * Asie" only by luck. Proved with names whose alphabetical order is the
     * reverse of their codes': on codes this would answer FR then JP.
     */
    const reversedLabels = {
      ...CODE_LABELS,
      continentName: (continent: string | null): string =>
        continent === "asia" ? "Aaa" : continent === "europe" ? "Zzz" : "unplaced",
      countryName: (code: string): string => (code === "JP" ? "Aaa" : "Zzz"),
    };
    const catalogue = buildCatalogue([tripIn("FR", 0), tripIn("JP", 1)], reversedLabels);

    expect(catalogue.map((group) => group.continent)).toEqual(["asia", "europe"]);
    expect(catalogue[0]?.countries[0]?.countryName).toBe("Aaa");
  });

  it("keeps the façade's order among the trips of one country", () => {
    const first = tripIn("FR", 0);
    const second = tripIn("FR", 1);
    const third = tripIn("FR", 2);
    const catalogue = buildCatalogue([first, second, third], CODE_LABELS);

    expect(catalogue[0]?.countries[0]?.trips).toEqual([first, second, third]);
  });

  it("files a trip under the country it arrives in, once, not under every country it crosses", () => {
    /**
     * The decision this pins: an entry is a trip, and a trip appears exactly
     * once — filed where its first step arrives, which is also where the map
     * anchors its marker. Listing it under each visited country would put the
     * same title and the same link under three headings, and turn "sixty trips"
     * into a hundred and twenty entries.
     *
     * Nothing is lost: the card names every country the trip crossed.
     */
    const crossing = tripEntry({
      slug: "tour-du-monde",
      countryCodes: ["FR", "JP", "TH"],
      firstArrival: { name: "Tokyo", countryCode: "JP" },
    });
    const catalogue = buildCatalogue([crossing], CODE_LABELS);

    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.continent).toBe("asia");
    expect(catalogue[0]?.countries.map((country) => country.countryCode)).toEqual(["JP"]);
  });

  it("counts the trips of a continent across all of its countries", () => {
    const catalogue = buildCatalogue([tripIn("FR", 0), tripIn("IT", 1), tripIn("ES", 2)], {
      ...CODE_LABELS,
    });

    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.tripCount).toBe(3);
  });

  it("places sixty trips exactly once each", () => {
    const catalogue = buildCatalogue(SIXTY_TRIPS, CODE_LABELS);
    const listed = catalogue.flatMap((group) => group.countries.flatMap((c) => c.trips));

    expect(listed).toHaveLength(60);
    expect(new Set(codes(listed)).size).toBe(60);
    expect(catalogue.reduce((total, group) => total + group.tripCount, 0)).toBe(60);
  });

  it("gives a trip whose country it cannot place its own group, at the end", () => {
    /**
     * `CountryCodeSchema` checks the shape of a code and deliberately not its
     * existence, so `"ZZ"` is a trip this project accepts and stores. It must
     * appear in the listing — under an honest heading, and after the continents
     * that are real, whatever that heading sorts to alphabetically.
     */
    const unplaceable = tripEntry({
      slug: "quelque-part",
      firstArrival: { name: "Quelque part", countryCode: "ZZ" },
    });
    const catalogue = buildCatalogue([tripIn("FR", 0), unplaceable], CODE_LABELS);

    expect(catalogue.map((group) => group.continent)).toEqual(["europe", null]);
    expect(catalogue[1]?.countries[0]?.trips.map((trip) => trip.slug)).toEqual(["quelque-part"]);
  });

  it("keeps the unplaced group last even when its name sorts first", () => {
    const unplaceable = tripEntry({
      slug: "quelque-part",
      firstArrival: { name: "Quelque part", countryCode: "ZZ" },
    });
    const catalogue = buildCatalogue([tripIn("FR", 0), unplaceable], {
      ...CODE_LABELS,
      continentName: (continent: string | null): string => (continent === null ? "Aaa" : "Zzz"),
    });

    expect(catalogue.map((group) => group.continent)).toEqual(["europe", null]);
  });

  it("does not read a country code as a property of an object", () => {
    // The `findTrip` lesson again, at the grouping layer this time: a code
    // arriving from content must never index a plain object.
    const suspicious = tripEntry({
      slug: "prototype",
      firstArrival: { name: "Nulle part", countryCode: "constructor" },
    });
    const catalogue = buildCatalogue([suspicious], CODE_LABELS);

    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.continent).toBeNull();
    expect(catalogue[0]?.countries[0]?.trips).toEqual([suspicious]);
  });
});
