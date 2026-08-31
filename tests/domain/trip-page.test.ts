import { describe, expect, it } from "vitest";
import { TripSchema } from "@/domain/schema";
import type { Trip } from "@/domain/schema";
import { estimateReadingMinutes, visitedPlaces, WORDS_PER_MINUTE } from "@/domain/trip";
import { BRON, KYOTO, LYON, LYON_PART_DIEU, move, stay, TOKYO, tripInput } from "./fixtures";

/**
 * The two derivations the trip page (TIW-16) needs and the domain did not carry.
 * Both are functions of the trip, like `durationOf` and `visitedCountryCodes`
 * beside them — neither is ever written into a content file, for the reason the
 * file's own header gives: a stored derivation starts disagreeing with the rest.
 */

function parse(input: Record<string, unknown>): Trip {
  return TripSchema.parse(input);
}

describe("visitedPlaces", () => {
  /**
   * Step order, not `places[]` order. The header calls this "les villes
   * traversées", and a reader follows them in the order they were travelled —
   * `places[]` is a declaration block whose order is the author's typing order
   * and carries no meaning at all.
   */
  it("lists the places in the order the steps travel them", () => {
    const trip = parse(
      tripInput({
        places: [KYOTO, TOKYO],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-16"),
          move("tokyo", "kyoto", "train", "2024-04-16"),
          stay("kyoto", "2024-04-16", "2024-04-22"),
        ],
      })
    );

    expect(visitedPlaces(trip).map((place) => place.slug)).toEqual(["tokyo", "kyoto"]);
  });

  /**
   * A move contributes its departure *and* its arrival, in that order. This is
   * what makes a layover — a place only ever passed through, never slept in —
   * appear in the list at all.
   */
  it("counts a place that is only ever passed through", () => {
    const trip = parse(
      tripInput({
        places: [LYON, LYON_PART_DIEU, BRON],
        steps: [
          stay("lyon", "2024-04-12", "2024-04-14"),
          move("lyon", "lyon-part-dieu", "train", "2024-04-14"),
          move("lyon-part-dieu", "bron", "bus", "2024-04-14"),
          stay("bron", "2024-04-14", "2024-04-22"),
        ],
      })
    );

    expect(visitedPlaces(trip).map((place) => place.slug)).toEqual([
      "lyon",
      "lyon-part-dieu",
      "bron",
    ]);
  });

  /**
   * A place revisited is one entry, at its *first* crossing. "Tokyo, Kyoto,
   * Tokyo" reads as a defect in a header that promises the cities of the trip,
   * and the anchor scheme (which keys on the date as well as the slug) is what
   * keeps the two returns distinguishable where it matters — in the timeline.
   */
  it("names a revisited place once, at its first crossing", () => {
    const trip = parse(
      tripInput({
        places: [TOKYO, KYOTO],
        steps: [
          stay("tokyo", "2024-04-12", "2024-04-14"),
          move("tokyo", "kyoto", "train", "2024-04-14"),
          stay("kyoto", "2024-04-14", "2024-04-16"),
          move("kyoto", "tokyo", "train", "2024-04-16"),
          stay("tokyo", "2024-04-16", "2024-04-22"),
        ],
      })
    );

    expect(visitedPlaces(trip).map((place) => place.slug)).toEqual(["tokyo", "kyoto"]);
  });

  /** The whole `Place`, not the slug: the header prints `name`, the map projects
   * `coordinates`, and re-looking-up either from a slug is how the two drift. */
  it("hands back the declared place, not just its slug", () => {
    const trip = parse(tripInput());

    expect(visitedPlaces(trip)[0]).toMatchObject({
      slug: "tokyo",
      name: "Tokyo",
      countryCode: "JP",
    });
  });
});

describe("estimateReadingMinutes", () => {
  /**
   * The published constant, asserted rather than assumed: the rows below are
   * written against 200 words per minute, so a silent change of the rate would
   * leave them passing while meaning something else.
   */
  it("reads at the documented rate", () => {
    expect(WORDS_PER_MINUTE).toBe(200);
  });

  /**
   * Rounded *up*, always. A page announcing "1 min" for 350 words has
   * under-promised by nearly a minute, and the figure exists to set an
   * expectation before the reader commits.
   */
  it.each([
    { words: 0, minutes: 1 },
    { words: 1, minutes: 1 },
    { words: 199, minutes: 1 },
    { words: 200, minutes: 1 },
    { words: 201, minutes: 2 },
    { words: 400, minutes: 2 },
    { words: 401, minutes: 3 },
    { words: 2000, minutes: 10 },
  ])("estimates $words words at $minutes min", ({ words, minutes }) => {
    expect(estimateReadingMinutes(words)).toBe(minutes);
  });

  /**
   * Never zero. "0 min de lecture" is not a shorter promise than "1 min", it is
   * a broken-looking one — and it is the value an empty trip would print today,
   * because no step in the current content model carries prose at all.
   */
  it("never announces less than a minute", () => {
    expect(estimateReadingMinutes(0)).toBeGreaterThanOrEqual(1);
  });

  /**
   * A word count comes from `.length`, so a non-integer or a negative is not a
   * value this function should try to interpret — it is a caller that has gone
   * wrong upstream, and silently answering "1 min" would hide it.
   */
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %p", (words) => {
    expect(() => estimateReadingMinutes(words)).toThrow(TypeError);
  });
});
