import { describe, expect, it } from "vitest";
import {
  tallyVisitedPlaces,
  type PlaceLabels,
  type VisitedPlaceTally,
  type VisitingTrip,
} from "@/components/places/places";

/**
 * The arithmetic behind `/villes`: which cities and places the published trips
 * reach, and how many stays each one holds.
 *
 * **A pure module for the reason `untoldOnlyCountryCodes` is one** — the header of
 * `src/components/map/countries.ts` argues it at length, and this file is its
 * twin: the degenerate cases are worth a dozen cheap assertions rather than a
 * dozen renders, and the three states the acceptance criteria name (zero places,
 * one, fourteen) are asserted here instead of being inferred from a page.
 *
 * Names are the codes themselves in most cases, so the assertions are about the
 * arranging and never about ICU's French collation. The two cases that care about
 * real names build their own labels and say so.
 */

/**
 * The narrowest fixture the function accepts: a trip slug and the places it
 * declares. There is deliberately no `story` here — unlike `CountingTrip`, which
 * carries one — because no branch of this module reads it. See the module's own
 * note on the href rule that makes the question moot.
 */
const trip = (slug: string, ...places: readonly [string, string][]): VisitingTrip => ({
  slug,
  places: places.map(([name, countryCode]) => ({ name, countryCode })),
});

/** Labels that do not localise: a country's name is its code. */
const CODE_LABELS: PlaceLabels = {
  countryName: (code) => code,
  compare: (left, right) => left.localeCompare(right, "fr"),
};

/**
 * Kyoto and Tokyo belong to one trip, Osaka to another, and Cusco and La Paz to a
 * trip crossing two countries — the three shapes that make a per-place count
 * differ from a count of trips and from a count of countries. In the content
 * façade's order: `startDate` descending.
 */
const TRIPS: readonly VisitingTrip[] = [
  trip("japon-2025", ["Osaka", "JP"]),
  trip("japon-2024", ["Tokyo", "JP"], ["Kyoto", "JP"]),
  trip("perou-bolivie-2023", ["Cusco", "PE"], ["La Paz", "BO"]),
  trip("islande-2022", ["Reykjavik", "IS"]),
];

const readable = (tally: readonly VisitedPlaceTally[]): readonly string[] =>
  tally.map((entry) => `${entry.name} (${entry.countryName}) ${entry.tripSlugs.length}`);

describe("tallyVisitedPlaces", () => {
  it("counts the stays each place holds", () => {
    expect(readable(tallyVisitedPlaces(TRIPS, CODE_LABELS))).toEqual([
      "Cusco (PE) 1",
      "Kyoto (JP) 1",
      "La Paz (BO) 1",
      "Osaka (JP) 1",
      "Reykjavik (IS) 1",
      "Tokyo (JP) 1",
    ]);
  });

  it("names the trips of each place, so a place with a single one can be linked precisely", () => {
    // The count alone would leave every row pointing at the whole listing. The
    // slugs are what let a place holding exactly one trip address that trip's own
    // entry in the catalogue.
    const byPlace = new Map(
      tallyVisitedPlaces(TRIPS, CODE_LABELS).map((entry) => [entry.name, entry.tripSlugs])
    );

    expect(byPlace.get("Tokyo")).toEqual(["japon-2024"]);
    expect(byPlace.get("Cusco")).toEqual(["perou-bolivie-2023"]);
  });

  it("gathers the trips that return to the same place, in the order they arrived", () => {
    /**
     * The one shape this listing exists for: a place is not a synonym of a trip.
     * Tokyo visited three times is one row saying three, not three rows — and the
     * order is the façade's, `startDate` descending, never re-sorted here.
     */
    const tally = tallyVisitedPlaces(
      [
        trip("tokyo-2025", ["Tokyo", "JP"]),
        trip("tokyo-2024", ["Tokyo", "JP"]),
        trip("tokyo-2019", ["Tokyo", "JP"]),
      ],
      CODE_LABELS
    );

    expect(tally).toHaveLength(1);
    expect(tally[0]?.tripSlugs).toEqual(["tokyo-2025", "tokyo-2024", "tokyo-2019"]);
  });

  it("counts a place once for a trip that declares it twice", () => {
    // A split stay — leave a city and come back to it inside one journey —
    // declares the place once but is reached through two steps upstream. This is
    // the tally refusing to depend on how many times a caller names it.
    const tally = tallyVisitedPlaces(
      [trip("japon-2024", ["Tokyo", "JP"], ["Kyoto", "JP"], ["Tokyo", "JP"])],
      CODE_LABELS
    );

    expect(readable(tally)).toEqual(["Kyoto (JP) 1", "Tokyo (JP) 1"]);
  });

  it("keeps two places apart when they share a name in two countries", () => {
    /**
     * Valence is a French city and a Spanish one, and this journal holds the
     * Spanish one. Identity is the pair *name and country* rather than the name
     * alone: merging them would print one row whose count is the sum of two
     * different places, which is a wrong number and not merely a coarse one.
     *
     * The slug is deliberately NOT the identity. A place's slug is local to its
     * own `trip.yaml` — two files may spell the same city `valence` and
     * `valencia` — so keying on it would produce two rows a reader sees as one
     * name twice, which is the visible defect rather than the hidden one.
     */
    const tally = tallyVisitedPlaces(
      [trip("espagne-2024", ["Valence", "ES"]), trip("drome-2023", ["Valence", "FR"])],
      { countryName: (code) => (code === "ES" ? "Espagne" : "France"), compare: CODE_LABELS.compare }
    );

    expect(readable(tally)).toEqual(["Valence (Espagne) 1", "Valence (France) 1"]);
  });

  it("orders by localised place name, and never by count", () => {
    /**
     * Tokyo holds the most stays and still comes last. Sorting by count is the
     * tempting "where has he been most" reading and it is refused for the reason
     * the map's own country tally refused it too, before it was deleted: a
     * reader scanning a list of fourteen
     * names needs the alphabet they are scanning with.
     */
    const tally = tallyVisitedPlaces(
      [
        trip("tokyo-2025", ["Tokyo", "JP"]),
        trip("tokyo-2024", ["Tokyo", "JP"]),
        trip("islande-2022", ["Reykjavik", "IS"]),
        trip("perou-2023", ["Cusco", "PE"]),
      ],
      CODE_LABELS
    );

    expect(readable(tally)).toEqual(["Cusco (PE) 1", "Reykjavik (IS) 1", "Tokyo (JP) 2"]);
  });

  it("collates rather than comparing code units", () => {
    // `"Évian" < "Zurich"` is false in code-unit order — every accented letter
    // sorts after `Z`. The same trap `buildWorldGeometry` and the country tally
    // both record, and this journal is full of French place names.
    const tally = tallyVisitedPlaces([trip("a", ["Zurich", "CH"], ["Évian", "FR"])], {
      countryName: (code) => code,
      compare: new Intl.Collator("fr").compare,
    });

    expect(tally.map((entry) => entry.name)).toEqual(["Évian", "Zurich"]);
  });

  it("answers nothing at all when no trip is published", () => {
    // The repository's own state until the first `trip.yaml` landed, and still
    // the state the empty E2E fixture serves. The page turns this into a block
    // with a way out, never an empty list.
    expect(tallyVisitedPlaces([], CODE_LABELS)).toEqual([]);
  });

  it("answers a single row for a journal holding one place", () => {
    // The boundary between "nothing" and "a list": a one-row listing must not
    // take the empty branch, and its count must read `1` rather than a plural.
    const tally = tallyVisitedPlaces([trip("annecy", ["Annecy", "FR"])], CODE_LABELS);

    expect(readable(tally)).toEqual(["Annecy (FR) 1"]);
  });

  it("holds a journal of fourteen places over thirteen trips", () => {
    /**
     * The repository's own content, in shape rather than in detail: thirteen
     * trips, one of which declares two places, over five European countries. The
     * arithmetic that matters is that fourteen places come out of thirteen trips
     * — a listing that counted trips would say thirteen, and a listing that
     * counted countries would say five.
     */
    const journal: readonly VisitingTrip[] = [
      trip("annecy", ["Annecy", "FR"]),
      trip("barcelone", ["Barcelone", "ES"]),
      trip("corse", ["Corse", "FR"]),
      trip("crete", ["Héraklion", "GR"]),
      trip("gand-bruges", ["Gand", "BE"], ["Bruges", "BE"]),
      trip("geneve", ["Genève", "CH"]),
      trip("la-rochelle", ["La Rochelle", "FR"]),
      trip("les-sables-d-olonne", ["Les Sables-d'Olonne", "FR"]),
      trip("noirmoutier", ["Noirmoutier", "FR"]),
      trip("paris", ["Paris", "FR"]),
      trip("roses", ["Roses", "ES"]),
      trip("rouen", ["Rouen", "FR"]),
      trip("valence", ["Valence", "ES"]),
    ];

    const tally = tallyVisitedPlaces(journal, {
      countryName: (code) => code,
      compare: new Intl.Collator("fr").compare,
    });

    expect(tally).toHaveLength(14);
    expect(tally.map((entry) => entry.name)).toEqual([
      "Annecy",
      "Barcelone",
      "Bruges",
      "Corse",
      "Gand",
      "Genève",
      "Héraklion",
      "La Rochelle",
      "Les Sables-d'Olonne",
      "Noirmoutier",
      "Paris",
      "Roses",
      "Rouen",
      "Valence",
    ]);
    // Every row is a single stay on this journal, which is what makes the
    // "13 trips, 14 places" arithmetic above readable rather than a coincidence.
    expect(tally.every((entry) => entry.tripSlugs.length === 1)).toBe(true);
  });

  it("never invents a row: every place comes from a trip", () => {
    /**
     * The property that keeps this listing honest, and the reason it reads the
     * content rather than the geometry beside it — the argument
     * `src/components/map/countries.ts` makes for the country tally applies
     * unchanged. A row without a trip behind it is unrepresentable.
     */
    const declared = new Set(TRIPS.flatMap((entry) => entry.places.map((place) => place.name)));

    for (const row of tallyVisitedPlaces(TRIPS, CODE_LABELS)) {
      expect(declared.has(row.name)).toBe(true);
      expect(row.tripSlugs.length).toBeGreaterThan(0);
    }
  });
});
