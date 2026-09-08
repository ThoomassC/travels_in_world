import { describe, expect, it } from "vitest";
import { TILE_BOX, countryTile } from "@/map/country-tile";

/**
 * The vignette a suggestion row draws: one country, fitted to its own frame.
 *
 * **What is worth asserting here and what is not.** Nobody can read a coastline
 * out of a `d` string, so there is no case below that claims France looks like
 * France — the eye does that, and `tests/e2e/search.populated.spec.ts` checks the
 * drawing has a box at all. What a test *can* hold is everything that would make
 * the tile silently wrong: a country fitted outside its frame, a place landing off
 * its country, the simplification eating a whole territory, and the byte cost of a
 * thing that ships in the HTML of every document on this site.
 */

const pathNumbers = (path: string): readonly number[] =>
  [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

describe("countryTile", () => {
  it("fits a country inside its box, with the margin its coasts need", () => {
    const numbers = pathNumbers(countryTile("FR")?.path ?? "");

    expect(numbers.length).toBeGreaterThan(20);
    for (const value of numbers) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(TILE_BOX);
    }
  });

  /**
   * A country **touches** its padded frame on one axis — that is what fitting
   * means, and a tile that fell short of it would be a country floating in a box.
   */
  it("fills the frame it is fitted to rather than floating in it", () => {
    const numbers = pathNumbers(countryTile("FR")?.path ?? "");

    expect(Math.min(...numbers)).toBeLessThanOrEqual(3.5);
    expect(Math.max(...numbers)).toBeGreaterThanOrEqual(TILE_BOX - 3.5);
  });

  /**
   * Every coordinate is on the half-unit grid. The saving is not the rounding but
   * what the rounding lets the context drop — a 50m coastline emits dozens of
   * points inside one pixel of this tile.
   */
  it("snaps every coordinate to the half-unit grid", () => {
    for (const code of ["FR", "GR", "CH"]) {
      for (const value of pathNumbers(countryTile(code)?.path ?? "")) {
        expect(value * 2).toBe(Math.round(value * 2));
      }
    }
  });

  /**
   * **THE BYTE GUARD, and it is the reason this module simplifies at all.** One
   * path per country, in the HTML of every document — the panel is in the chrome.
   * Measured when this was written: FR 658, ES 301, GR 1403, BE 414, CH 492 —
   * 3.3 KB for the five countries the carnet reaches, down from 23.6 KB rounded
   * and 9.9 KB on the grid alone.
   *
   * Greece is the ceiling and the reason there is one: several hundred islands
   * and a mainland coastline that is mostly peninsula. Anything that let it past
   * 2 KB would be something that had stopped simplifying.
   */
  it("keeps the most intricate country the carnet reaches under 2 KB", () => {
    expect((countryTile("GR")?.path ?? "").length).toBeLessThan(2048);
  });

  it("keeps the five countries the carnet reaches under 4 KB together", () => {
    const total = ["FR", "ES", "GR", "BE", "CH"]
      .map((code) => (countryTile(code)?.path ?? "").length)
      .reduce((sum, length) => sum + length, 0);

    expect(total).toBeLessThan(4096);
  });

  /**
   * The other half of the module: a place has to land where the drawing puts its
   * country. Asserted on real coordinates rather than on the maths, because the
   * maths is d3's and what can go wrong here is the *pairing* — a projection fitted
   * to one country and asked for a point in another.
   */
  it("places a real town inside its own country's frame", () => {
    const cases = [
      ["GR", { lat: 35.32787, lon: 25.14341 }],
      ["FR", { lat: 46.49687, lon: -1.7847 }],
      ["CH", { lat: 46.20222, lon: 6.14569 }],
      ["ES", { lat: 41.38879, lon: 2.15899 }],
    ] as const;

    for (const [code, coordinates] of cases) {
      const point = countryTile(code)?.place(coordinates);

      expect(point, code).toBeDefined();
      expect(point?.x, code).toBeGreaterThan(0);
      expect(point?.x, code).toBeLessThan(TILE_BOX);
      expect(point?.y, code).toBeGreaterThan(0);
      expect(point?.y, code).toBeLessThan(TILE_BOX);
    }
  });

  /**
   * Two towns far apart in one country must land far apart in its tile — the case
   * that would catch a projection accidentally shared between countries, or one
   * degenerated to a point.
   */
  it("separates two towns the way the country separates them", () => {
    const tile = countryTile("FR");
    const north = tile?.place({ lat: 49.44313, lon: 1.09932 });
    const south = tile?.place({ lat: 42.15829, lon: 9.09637 });

    expect(Math.hypot(Number(north?.x) - Number(south?.x), Number(north?.y) - Number(south?.y)))
      .toBeGreaterThan(10);
  });

  /**
   * **The failure mode is a missing ornament and never a broken build**, which is
   * the opposite of `buildWorldGeometry`'s. A country missing from the world map is
   * a hole a reader sees; a country missing from a 40 px vignette costs that row
   * its drawing, and the row still says where the trip went in words.
   */
  it("answers undefined for a code the dataset does not hold", () => {
    expect(countryTile("ZZ")).toBeUndefined();
    expect(countryTile("")).toBeUndefined();
  });

  it("reads a lowercase code, because a caller should not have to care", () => {
    expect(countryTile("fr")?.path).toBe(countryTile("FR")?.path);
  });

  /** Memoised: the conversion is the expensive half and every page would redo it. */
  it("hands back the very same tile on a second call", () => {
    expect(countryTile("BE")).toBe(countryTile("BE"));
  });
});
