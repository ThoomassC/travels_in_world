import { describe, expect, it } from "vitest";
import {
  countryPlaces,
  countryRows,
  countryTrips,
  isFiledUnder,
  placeMarks,
} from "@/app/[locale]/pays/country";
import type { CountryVisit } from "@/app/[locale]/pays/country";

/**
 * The arithmetic behind the country pages (TIW-39): which trips a country holds,
 * which places, and where those places land on its silhouette.
 *
 * Pure functions over plain data — no React, no locale, no disk — colocated with
 * the two routes that read them, the same arrangement as
 * `src/app/[locale]/a-propos/identity.ts`. That is what makes the boundary cases
 * below cheap assertions instead of a rendered page, and it is why they are here
 * and not inside `page.tsx`: a page module cannot be imported by Vitest at all,
 * since it reaches `@/content/trips` and `@/map`, both of which resolve only
 * under Next's bundler.
 *
 * The collation is injected, as everywhere in this project: `Intl.Collator` in
 * production, and here a comparator the test controls, so an assertion is about
 * an ordering rule and never about ICU's French.
 */

const compare = (left: string, right: string): number => left.localeCompare(right, "fr");

function visit(overrides: Partial<CountryVisit> = {}): CountryVisit {
  return {
    slug: "annecy",
    countryCodes: ["FR"],
    firstArrival: { countryCode: "FR" },
    places: [{ name: "Annecy", countryCode: "FR", coordinates: { lat: 45.90878, lon: 6.12565 } }],
    ...overrides,
  };
}

describe("countryTrips", () => {
  it("keeps the trips that reach the country, in the façade's own order", () => {
    const trips = [
      visit({ slug: "annecy" }),
      visit({ slug: "barcelone", countryCodes: ["ES"] }),
      visit({ slug: "corse" }),
    ];

    expect(countryTrips(trips, "FR").map((trip) => trip.slug)).toEqual(["annecy", "corse"]);
  });

  /**
   * **Every country the itinerary touches, and not the one it is filed under.**
   * The catalogue on `/voyages` files a trip under its *first arrival*, which is
   * the right rule for a grouping that must show each trip once; a page whose
   * whole subject is one country would be lying to leave out a journey that
   * crossed it. This is the same reading `/villes` takes of a place.
   */
  it("keeps a trip that merely crosses the country", () => {
    const crossing = visit({ slug: "gand-bruges", countryCodes: ["BE", "FR"] });

    expect(countryTrips([crossing], "FR").map((trip) => trip.slug)).toEqual(["gand-bruges"]);
  });

  it("answers with nothing for a country no trip reaches", () => {
    expect(countryTrips([visit()], "JP")).toEqual([]);
  });

  /**
   * `CountryCodeSchema` refuses anything but `/^[A-Z]{2}$/`, so a `toUpperCase()`
   * on either side would guard a case no input can present — the discipline
   * `src/components/places/places.ts` records: a guard that cannot be observed is
   * a claim nobody can check.
   */
  it("compares codes exactly", () => {
    expect(countryTrips([visit()], "fr")).toEqual([]);
  });
});

describe("countryPlaces", () => {
  it("lists the places of that country and no other, in the reader's order", () => {
    const trips = [
      visit({
        slug: "gand-bruges",
        countryCodes: ["BE", "FR"],
        firstArrival: { countryCode: "BE" },
        places: [
          { name: "Gand", countryCode: "BE", coordinates: { lat: 51.05, lon: 3.71667 } },
          { name: "Bruges", countryCode: "BE", coordinates: { lat: 51.20892, lon: 3.22424 } },
          { name: "Lille", countryCode: "FR", coordinates: { lat: 50.63297, lon: 3.05858 } },
        ],
      }),
    ];

    expect(countryPlaces(trips, "BE", compare).map((place) => place.name)).toEqual([
      "Bruges",
      "Gand",
    ]);
  });

  /**
   * Collated and not compared with `<`: `"Évian" < "Zurich"` is false in
   * code-unit order, and this carnet is full of French place names. Same rule,
   * same reason, as the places listing.
   */
  it("orders with the collator it is given rather than by code unit", () => {
    const trips = [
      visit({
        places: [
          { name: "Zurich", countryCode: "FR", coordinates: { lat: 1, lon: 1 } },
          { name: "Évian", countryCode: "FR", coordinates: { lat: 2, lon: 2 } },
        ],
      }),
    ];

    expect(countryPlaces(trips, "FR", compare).map((place) => place.name)).toEqual([
      "Évian",
      "Zurich",
    ]);
  });

  /**
   * One row per place, whichever trip reached it — and the slugs in the order
   * they arrived, so a caller can address the single trip a place holds without
   * a second derivation. The count is `tripSlugs.length` and deliberately not a
   * field of its own: two numbers that must agree eventually do not.
   */
  it("gathers the trips that share a place into one row", () => {
    const trips = [
      visit({ slug: "paris-2024" }),
      visit({
        slug: "paris-2025",
        places: [{ name: "Annecy", countryCode: "FR", coordinates: { lat: 45.9, lon: 6.1 } }],
      }),
    ];

    expect(countryPlaces(trips, "FR", compare)).toEqual([
      {
        name: "Annecy",
        coordinates: { lat: 45.90878, lon: 6.12565 },
        tripSlugs: ["paris-2024", "paris-2025"],
      },
    ]);
  });

  /**
   * A trip declaring the same place twice — two split stays in one city — is one
   * visit. `PlaceSchema` de-duplicates by slug upstream and not by name, so this
   * is the case the schema cannot see.
   */
  it("counts a place declared twice by one trip once", () => {
    const trips = [
      visit({
        places: [
          { name: "Annecy", countryCode: "FR", coordinates: { lat: 45.9, lon: 6.1 } },
          { name: "Annecy", countryCode: "FR", coordinates: { lat: 45.9, lon: 6.1 } },
        ],
      }),
    ];

    const [place] = countryPlaces(trips, "FR", compare);

    expect(countryPlaces(trips, "FR", compare)).toHaveLength(1);
    expect(place?.tripSlugs).toEqual(["annecy"]);
  });

  it("answers with nothing for a country no trip reaches", () => {
    expect(countryPlaces([visit()], "JP", compare)).toEqual([]);
  });
});

describe("placeMarks — the dots on the silhouette", () => {
  const places = [
    { name: "Annecy", coordinates: { lat: 45.9, lon: 6.1 }, tripSlugs: ["annecy"] },
    { name: "Paris", coordinates: { lat: 48.85, lon: 2.35 }, tripSlugs: ["paris"] },
  ];

  it("places one dot per place, keeping its name", () => {
    const project = ({ lat, lon }: { lat: number; lon: number }) => ({ x: lon, y: lat });

    expect(placeMarks(places, project)).toEqual([
      { name: "Annecy", x: 6.1, y: 45.9 },
      { name: "Paris", x: 2.35, y: 48.85 },
    ]);
  });

  /**
   * A place the projection has no answer for is **dropped**, not defaulted. The
   * trip page takes the same branch and states the reason: a marker invented for
   * a coordinate that does not project is a confident dot in the wrong country.
   */
  it("drops a place the projection cannot place rather than inventing a point", () => {
    const project = (coordinates: { lat: number; lon: number }) =>
      coordinates.lat > 48 ? undefined : { x: 1, y: 2 };

    expect(placeMarks(places, project)).toEqual([{ name: "Annecy", x: 1, y: 2 }]);
  });

  /**
   * The real projection, on the real dataset, for the country this carnet has
   * most of. Imported deeply on purpose: `@/map` carries `server-only`, which
   * resolves under Next's bundler and nowhere else — `tests/**` is outside the
   * `map-entry-point` rule for exactly this.
   */
  it("puts France's real places inside France's real tile", async () => {
    const { countryTile, TILE_BOX } = await import("@/map/country-tile");
    const tile = countryTile("FR");

    expect(tile).toBeDefined();

    const marks = placeMarks(
      [
        { name: "Paris", coordinates: { lat: 48.85341, lon: 2.3488 }, tripSlugs: ["paris"] },
        { name: "Annecy", coordinates: { lat: 45.90878, lon: 6.12565 }, tripSlugs: ["annecy"] },
        {
          name: "Les Sables-d'Olonne",
          coordinates: { lat: 46.49687, lon: -1.7847 },
          tripSlugs: ["les-sables-d-olonne"],
        },
      ],
      (coordinates) => tile?.place(coordinates)
    );

    expect(marks).toHaveLength(3);
    for (const mark of marks) {
      expect(mark.x).toBeGreaterThanOrEqual(0);
      expect(mark.x).toBeLessThanOrEqual(TILE_BOX);
      expect(mark.y).toBeGreaterThanOrEqual(0);
      expect(mark.y).toBeLessThanOrEqual(TILE_BOX);
    }

    /**
     * Not merely "inside the box": three distinct towns must land on three
     * distinct dots, or the tile would be a drawing that says nothing. And Paris
     * is north and east of Annecy is false — Paris is north and WEST — which is
     * the cheapest assertion that the projection is not mirrored.
     */
    const [paris, annecy] = marks;
    expect(new Set(marks.map((mark) => `${mark.x},${mark.y}`)).size).toBe(3);
    expect(paris?.y).toBeLessThan(annecy?.y ?? 0);
    expect(paris?.x).toBeLessThan(annecy?.x ?? 0);
  });
});

describe("isFiledUnder — whether the catalogue has a section for this country", () => {
  /**
   * `TripCatalogue` emits `id="pays-<CODE>"` only for a country a trip **arrives**
   * in, because that is how it files a trip. So a link to
   * `/voyages#pays-<CODE>` dangles for exactly the countries a trip merely
   * crosses — the failure this repository has already paid for once, with
   * `#pays-bo`, recorded in the header of
   * `tests/e2e/dead-links.populated.spec.ts`. The country page asks this question
   * before offering that link.
   */
  it("is true when at least one trip arrives in the country", () => {
    expect(isFiledUnder([visit()], "FR")).toBe(true);
  });

  it("is false when every trip only crosses it", () => {
    const crossing = visit({ countryCodes: ["BE", "FR"], firstArrival: { countryCode: "BE" } });

    expect(isFiledUnder([crossing], "FR")).toBe(false);
    expect(isFiledUnder([crossing], "BE")).toBe(true);
  });

  it("is false when no trip reaches the country at all", () => {
    expect(isFiledUnder([visit()], "JP")).toBe(false);
  });
});

describe("countryRows — the index of visited countries", () => {
  const labels = { countryName: (code: string) => `Pays ${code}`, compare };

  it("counts each country's trips and places", () => {
    const trips = [
      visit({ slug: "annecy" }),
      visit({
        slug: "paris",
        places: [{ name: "Paris", countryCode: "FR", coordinates: { lat: 48.85, lon: 2.35 } }],
      }),
      visit({
        slug: "gand-bruges",
        countryCodes: ["BE"],
        firstArrival: { countryCode: "BE" },
        places: [
          { name: "Gand", countryCode: "BE", coordinates: { lat: 51.05, lon: 3.71667 } },
          { name: "Bruges", countryCode: "BE", coordinates: { lat: 51.20892, lon: 3.22424 } },
        ],
      }),
    ];

    expect(countryRows(trips, labels)).toEqual([
      { code: "BE", name: "Pays BE", tripCount: 1, placeCount: 2 },
      { code: "FR", name: "Pays FR", tripCount: 2, placeCount: 2 },
    ]);
  });

  /**
   * A country a trip crosses gets a row: it is a country the carnet has been to,
   * which is the question this index answers. `countryTrips` above takes the same
   * reading, and the two must agree or the index would count a trip its own page
   * does not list.
   */
  it("gives a row to a country that is only ever crossed", () => {
    const crossing = visit({
      slug: "gand-bruges",
      countryCodes: ["BE", "FR"],
      firstArrival: { countryCode: "BE" },
      places: [{ name: "Gand", countryCode: "BE", coordinates: { lat: 51.05, lon: 3.71667 } }],
    });

    expect(countryRows([crossing], labels).map((row) => row.code)).toEqual(["BE", "FR"]);
  });

  /**
   * Ordered on the name a reader sees and not on the code, for the reason
   * `buildCatalogue` gives about its own headings: under French labels, code
   * order comes out as no order at all.
   */
  it("orders on the localised name, not on the code", () => {
    const named = {
      countryName: (code: string) => (code === "FR" ? "Autriche" : "Zambie"),
      compare,
    };
    const trips = [visit({ slug: "geneve", countryCodes: ["CH"] }), visit()];

    expect(countryRows(trips, named).map((row) => row.code)).toEqual(["FR", "CH"]);
  });

  it("has no row at all when the carnet is empty", () => {
    expect(countryRows([], labels)).toEqual([]);
  });
});
