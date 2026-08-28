import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { Coordinates } from "@/domain/geo";
import { projectPoint, WORLD_VIEW_BOX } from "@/map/projection";
import type { ProjectedPoint } from "@/map/projection";

/**
 * The single projection the whole map agrees on. Two consumers depend on it and
 * they must not each pick their own: the country outlines (TIW-12) and the trip
 * markers laid over them (TIW-13). A marker projected with a different scale or
 * translate lands in the sea next to the country it belongs to, and nothing
 * fails — the SVG is valid either way.
 *
 * `geoNaturalEarth1()` at its defaults (translate [480, 250], scale 175.295) is
 * what makes the 960×500 viewBox exact rather than approximate. The reference
 * values below were read off d3-geo directly, so they pin the *choice*: a bump of
 * world-atlas cannot move them, and changing the projection has to move them all
 * at once.
 */

/**
 * Asserts a point projects at all before using it. `projectPoint` is typed
 * `ProjectedPoint | null` and `node:assert` narrows where `expect` cannot, which
 * keeps the cases below free of a cast or a branch.
 */
function project(coordinates: Coordinates): ProjectedPoint {
  const point = projectPoint(coordinates);
  assert(point !== null, `${coordinates.lat}, ${coordinates.lon} did not project`);

  return point;
}

describe("WORLD_VIEW_BOX", () => {
  it("is the 960×500 box the projection's own defaults produce", () => {
    expect(WORLD_VIEW_BOX.value).toBe("0 0 960 500");
    expect(WORLD_VIEW_BOX.width).toBe(960);
    expect(WORLD_VIEW_BOX.height).toBe(500);
  });

  /**
   * The three fields are read by different consumers — the `viewBox` attribute
   * takes the string, a CSS `aspect-ratio` and any hit-test arithmetic take the
   * numbers — so a change made to one and not the others produces a map that
   * renders at the wrong scale rather than an error.
   */
  it("keeps the string and the numbers telling the same story", () => {
    expect(WORLD_VIEW_BOX.value).toBe(`0 0 ${WORLD_VIEW_BOX.width} ${WORLD_VIEW_BOX.height}`);
  });
});

describe("projectPoint", () => {
  /**
   * Tokyo, the reference point of the ticket. Asserted with a tolerance rather
   * than by float equality: the expected value is a decimal literal and the
   * computed one comes out of a trigonometric chain, so `toBe` would be pinning
   * the last bits of a double, not the projection.
   */
  it("puts Tokyo where d3-geo puts it", () => {
    const tokyo = project({ lat: 35.6895, lon: 139.6917 });

    expect(tokyo.x).toBeCloseTo(829.4, 1);
    expect(tokyo.y).toBeCloseTo(139.6, 1);
  });

  /**
   * One decimal, and it is not cosmetic: the same rounding applied to the country
   * outlines is what takes the geometry payload from 45 kB to 30 kB brotli
   * (`world.test.ts` guards that number). Markers and outlines have to round
   * identically or a marker sits a fraction of a pixel off its own coastline.
   *
   * `x * 10` is compared against its own rounding rather than against a literal,
   * so the case reads the same for every row.
   */
  it.each([
    { label: "Tokyo", value: { lat: 35.6895, lon: 139.6917 } },
    { label: "Paris", value: { lat: 48.8566, lon: 2.3522 } },
    { label: "Santiago", value: { lat: -33.4489, lon: -70.6693 } },
    { label: "Auckland", value: { lat: -36.8485, lon: 174.7633 } },
    { label: "Reykjavík", value: { lat: 64.1466, lon: -21.9426 } },
    { label: "Singapore, nearly on the equator", value: { lat: 1.3521, lon: 103.8198 } },
  ])("rounds $label to one decimal", ({ value }) => {
    const point = project(value);

    expect(point.x).toBe(Math.round(point.x * 10) / 10);
    expect(point.y).toBe(Math.round(point.y * 10) / 10);
  });

  /**
   * The edges of the domain, where a projection is most likely to overflow the box
   * it was scaled for. A point outside the viewBox is not an error to SVG — it is
   * simply clipped away, so a marker on the antimeridian would silently vanish
   * instead of failing anything.
   *
   * Measured on d3-geo: the antimeridian lands at x ≈ 0.5 and x ≈ 959.5, which is
   * how little headroom there is either side.
   */
  it.each([
    { label: "the antimeridian, west side", value: { lat: 0, lon: -180 } },
    { label: "the antimeridian, east side", value: { lat: 0, lon: 180 } },
    { label: "the north pole", value: { lat: 90, lon: 0 } },
    { label: "the south pole", value: { lat: -90, lon: 0 } },
    { label: "the north-west corner of the domain", value: { lat: 90, lon: -180 } },
    { label: "the south-east corner of the domain", value: { lat: -90, lon: 180 } },
  ])("keeps $label inside the viewBox", ({ value }) => {
    const point = project(value);

    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(WORLD_VIEW_BOX.width);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(WORLD_VIEW_BOX.height);
  });

  /**
   * Why the return type admits `null`, and why no case here produces one.
   *
   * `geoNaturalEarth1` is a whole-sphere projection: every real coordinate has an
   * image, so for the input this project can hand it — a `Coordinates` that
   * already passed `CoordinatesSchema` — `null` is unreachable. But d3-geo's
   * projection signature is `[number, number] | null` (a clipped or non-invertible
   * point on other projections), and a façade that answered `ProjectedPoint` by
   * asserting non-null would be lying about a case it cannot rule out at the type
   * level. The honest signature is the one that says "check".
   *
   * What is worth testing is the promise that goes with it: across the whole
   * domain, nothing valid comes back `null` or out of the box. A grid rather than
   * a handful of cities, because the failure this catches — a projection swapped
   * for a clipped one — shows up in a band, not at a point.
   *
   * The origin is skipped on purpose: (0, 0) is what a failed geocoding returns,
   * `CoordinatesSchema` refuses it, and no caller can produce it.
   */
  it("projects every point of the domain into the box, and none to null", () => {
    const latitudes = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90];
    const longitudes = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
    const grid: readonly Coordinates[] = latitudes.flatMap((lat) =>
      longitudes.filter((lon) => !(lat === 0 && lon === 0)).map((lon) => ({ lat, lon }))
    );

    const rejected = grid
      .filter((coordinates) => projectPoint(coordinates) === null)
      .map(({ lat, lon }) => `${lat}, ${lon}`);

    const escaped = grid
      .map((coordinates) => ({ coordinates, point: projectPoint(coordinates) }))
      .filter(
        ({ point }) =>
          point !== null &&
          (point.x < 0 ||
            point.x > WORLD_VIEW_BOX.width ||
            point.y < 0 ||
            point.y > WORLD_VIEW_BOX.height)
      )
      .map(({ coordinates }) => `${coordinates.lat}, ${coordinates.lon}`);

    expect(grid).toHaveLength(168);
    expect(rejected).toEqual([]);
    expect(escaped).toEqual([]);
  });
});
