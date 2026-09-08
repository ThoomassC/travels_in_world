import { describe, expect, it } from "vitest";
import { tripFacetEntries } from "@/components/trips/facets";
import { tripEntry } from "./fixtures";

/**
 * Which choices a trip answers to: every country its itinerary touches, and the
 * year it began.
 *
 * The two derivations are here rather than in the page because both have a
 * boundary worth asserting — a trip crossing two countries, and a `startDate`
 * that is not a calendar day — and a page that reads the disk cannot be asked
 * either question cheaply.
 */

const name = (code: string) => (code === "JP" ? "Japon" : code === "BO" ? "Bolivie" : "Pérou");

describe("tripFacetEntries", () => {
  it("keys each entry on the slug the listing puts on its own element", () => {
    const [entry] = tripFacetEntries([tripEntry()], { countryName: name });

    expect(entry?.key).toBe("japon-2024");
  });

  /**
   * **Every country crossed, and not only the one the trip is filed under.**
   *
   * `buildCatalogue` files a trip under its *first arrival* and records the cost
   * of that: a country a trip merely passes through has no heading anywhere on
   * the site — "the day this becomes the wrong trade-off is the day filters
   * arrive". This is that day, and the answer is to widen the filter rather than
   * the filing: picking Bolivie keeps a Peru-and-Bolivia trip, which stays under
   * the Pérou chapter where it has always been, with both countries named on its
   * own card.
   */
  it("answers to every country the itinerary touches", () => {
    const [entry] = tripFacetEntries(
      [
        tripEntry({
          countryCodes: ["BO", "PE"],
          firstArrival: { name: "Lima", countryCode: "PE" },
        }),
      ],
      { countryName: name }
    );

    expect(entry?.facets.filter((facet) => facet.group === "country")).toEqual([
      { group: "country", value: "BO", label: "Bolivie" },
      { group: "country", value: "PE", label: "Pérou" },
    ]);
  });

  it("takes the year from the day the trip began, and labels it with itself", () => {
    const [entry] = tripFacetEntries([tripEntry({ startDate: "2023-12-28" })], {
      countryName: name,
    });

    expect(entry?.facets.filter((facet) => facet.group === "year")).toEqual([
      { group: "year", value: "2023", label: "2023" },
    ]);
  });

  /**
   * `TripEntry` is a structural type and its `startDate` is a bare `string`, so
   * a day `PlainDateSchema` would have refused can reach this function. It
   * answers with no year rather than with a `"2024"` sliced out of nonsense: the
   * trip is then kept by no year, which is true of it, and hidden while a year is
   * active — the honest outcome, and the reason a group's counts may sum below
   * the collection's total.
   */
  it("gives no year at all to a day that is not a calendar day", () => {
    const [entry] = tripFacetEntries([tripEntry({ startDate: "bientôt" })], {
      countryName: name,
    });

    expect(entry?.facets.every((facet) => facet.group !== "year")).toBe(true);
  });
});
