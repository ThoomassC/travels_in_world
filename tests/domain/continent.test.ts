import { describe, expect, it } from "vitest";
import { NUMERIC_BY_ALPHA2 } from "@/iso-3166";
import {
  CODES_OUTSIDE_ISO_3166,
  CONTINENTS,
  POLAR_TERRITORY_CODES,
  continentOf,
  placedCountryCodes,
} from "@/domain/continent";

/**
 * The coverage guard `src/domain/continent.ts` promises in its header, and the
 * only thing that keeps a country registry in the domain honest.
 *
 * **It imports `@/map/iso-3166` on purpose**, which no file under `src/**` may
 * do — `travels-in-world/map-entry-point` forbids the deep specifier, and
 * `domain-purity` forbids the domain any `@/` import at all. Neither rule matches
 * `tests/**`, and that is the point: the two lists have to be compared *somewhere*
 * without either module importing the other. `src/map/iso-3166.ts` already
 * documents that its own 249 keys were checked twice against the dataset and
 * against ICU, so comparing to it is comparing to something that was itself
 * verified.
 *
 * What goes red, and what it means:
 *
 * - a code in ISO and not here → a real country the listing would file under
 *   "not placed" instead of its continent;
 * - a code here and not in ISO → a typo, unless it is a deliberate addition
 *   listed in `CODES_OUTSIDE_ISO_3166`;
 * - a continent value outside `CONTINENTS` → a typo the `satisfies` clause
 *   already refuses at compile time, asserted again because the table is data.
 */
describe("the continent table covers the country codes the project knows", () => {
  // A `ReadonlyMap`, not a record — `Object.keys` on it answers `[]`, which is
  // exactly the silent nothing the "compares against a list that is really
  // there" case below refuses.
  const iso = [...NUMERIC_BY_ALPHA2.keys()];
  const placed = placedCountryCodes();

  it("compares against a list that is really there", () => {
    // Guards the guard: an empty or renamed ISO table would make every
    // assertion below pass by iterating nothing.
    expect(iso.length).toBe(249);
  });

  it("places every officially assigned alpha-2 code", () => {
    const unplaced = iso.filter((code) => continentOf(code) === null);

    expect(unplaced).toEqual([]);
  });

  it("adds nothing to the official list but the codes it declares", () => {
    const officiallyAssigned = new Set(iso);
    const extras = placed.filter((code) => !officiallyAssigned.has(code));

    expect(extras).toEqual([...CODES_OUTSIDE_ISO_3166]);
  });

  it("names a continent from the declared vocabulary for every code it places", () => {
    const continents = new Set(CONTINENTS);
    const strays = placed.filter((code) => {
      const continent = continentOf(code);

      return continent === null || !continents.has(continent);
    });

    expect(strays).toEqual([]);
  });

  it("declares each code exactly once", () => {
    expect(new Set(placed).size).toBe(placed.length);
  });
});

describe("continentOf", () => {
  /**
   * The four rows a reviewer is most likely to "correct". Each follows UN M49
   * rather than intuition, and pinning them here is what turns a comment into a
   * decision: changing one of them now costs a red test and a conversation.
   */
  it.each([
    ["FR", "europe"],
    ["JP", "asia"],
    ["PE", "americas"],
    ["MA", "africa"],
    ["NZ", "oceania"],
    // M49 puts Turkey and Cyprus in Western Asia, not in Europe.
    ["TR", "asia"],
    ["CY", "asia"],
    // Russia is Eastern Europe; Kazakhstan, its neighbour, is Central Asia.
    ["RU", "europe"],
    ["KZ", "asia"],
    // The three South Caucasus states are Western Asia.
    ["GE", "asia"],
    ["AM", "asia"],
    ["AZ", "asia"],
    // Danish, and filed with Northern America all the same.
    ["GL", "americas"],
    // Mexico is Central America, which M49 folds into the single Americas region.
    ["MX", "americas"],
    // Kosovo's code is user-assigned, so `src/map/iso-3166.ts` does not carry it
    // and this table does. That is a continent answer and not a publishable
    // trip: `buildWorldGeometry` throws on `XK`, so a trip declaring it fails
    // `next build` — measured, and quoted in `src/domain/continent.ts`.
    ["XK", "europe"],
  ])("places %s in %s", (code, continent) => {
    expect(continentOf(code)).toBe(continent);
  });

  it("gathers the polar and sub-antarctic territories under one heading", () => {
    // The one deliberate departure from M49, asserted rather than only written
    // down: M49 scatters these five across South America, Australia/New Zealand
    // and Sub-Saharan Africa.
    for (const code of POLAR_TERRITORY_CODES) {
      expect(continentOf(code), code).toBe("antarctica");
    }
  });

  it("answers null for a code it has never heard of, rather than throwing", () => {
    /**
     * `CountryCodeSchema` validates the shape of a code and deliberately not its
     * existence, so `npm run validate:content` accepts a `trip.yaml` declaring
     * `ZZ`. Totality is what a pure function owes its callers for every input of
     * its type, and that is what is asserted.
     *
     * The earlier comment added "a throw here would take the whole listing down
     * for one typo", which is not what happens: the map throws on such a code
     * first, at build time, so there is no listing to take down. See
     * `src/domain/continent.ts` for the measurement.
     */
    expect(continentOf("ZZ")).toBeNull();
    expect(continentOf("QQ")).toBeNull();
  });

  it("is case-sensitive, because an uppercase code is the only one that parsed", () => {
    expect(continentOf("fr")).toBeNull();
  });

  it("reads through a Map, so an inherited property name is not a country", () => {
    // The `findTrip` lesson, applied: on a plain object these three answer with a
    // function instead of `undefined`, and a page would be handed `Object` to
    // render under a continent heading.
    expect(continentOf("constructor")).toBeNull();
    expect(continentOf("__proto__")).toBeNull();
    expect(continentOf("toString")).toBeNull();
  });
});
