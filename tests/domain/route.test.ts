import { describe, expect, it } from "vitest";
import { TripSchema } from "@/domain/schema";
import type { DrawableMove } from "@/domain/route";
import { distanceKm, drawableMoves } from "@/domain/route";
import { BRON, LYON, LYON_PART_DIEU, minimalTripInput, move, PARIS, stay } from "./fixtures";

/**
 * Geometry. Two things are being defended here: a distance formula that stays
 * correct at the seams of the coordinate system, and a map that never draws a
 * segment nobody can see.
 */

describe("distanceKm", () => {
  /**
   * Bounds, not exact values: the expected numbers are the published
   * great-circle distances, and the interval is wide enough to accept any sane
   * earth radius (6371 km mean, 6378 km equatorial) while still failing on a
   * degrees/radians mix-up, a swapped lat/lon, or a flat-earth Pythagoras.
   */
  it.each([
    {
      label: "Paris to Lyon",
      from: { lat: 48.8566, lon: 2.3522 },
      to: { lat: 45.764, lon: 4.8357 },
      min: 385,
      max: 400,
    },
    {
      label: "Tokyo to Los Angeles",
      from: { lat: 35.6762, lon: 139.6503 },
      to: { lat: 34.0522, lon: -118.2437 },
      min: 8750,
      max: 8900,
    },
    /**
     * One degree of longitude at the equator, straddling ±180°. A subtraction
     * that forgets to wrap answers 359° — about 39 900 km, the long way round
     * the planet — and the map draws a line across the whole world.
     */
    {
      label: "one degree across the antimeridian, on the equator",
      from: { lat: 0, lon: 179.5 },
      to: { lat: 0, lon: -179.5 },
      min: 110,
      max: 113,
    },
    {
      label: "two degrees across the antimeridian, at 65°N",
      from: { lat: 65, lon: 179 },
      to: { lat: 65, lon: -179 },
      min: 92,
      max: 97,
    },
    {
      label: "pole to pole",
      from: { lat: 90, lon: 0 },
      to: { lat: -90, lon: 0 },
      min: 19950,
      max: 20080,
    },
  ])("measures $label between $min and $max km", ({ from, to, min, max }) => {
    expect(distanceKm(from, to)).toBeGreaterThan(min);
    expect(distanceKm(from, to)).toBeLessThan(max);
  });

  /**
   * Exactly zero, not "close to zero". The spherical law of cosines reaches
   * `acos(1.0000000000000002)` here and returns `NaN`, which then propagates
   * silently into every SVG coordinate; haversine returns a clean 0.
   */
  it("measures zero between a point and itself", () => {
    expect(distanceKm(PARIS.coordinates, PARIS.coordinates)).toBe(0);
    expect(distanceKm({ lat: -33.8688, lon: 151.2093 }, { lat: -33.8688, lon: 151.2093 })).toBe(0);
  });

  it("measures the same distance in both directions", () => {
    expect(distanceKm(PARIS.coordinates, BRON.coordinates)).toBe(
      distanceKm(BRON.coordinates, PARIS.coordinates)
    );
  });
});

/**
 * A trip whose fourth step is a move between two distinct places roughly 95 m
 * apart — Lyon city centre to Lyon Part-Dieu. It belongs in the timeline (it is
 * how the traveller got there) and not on the map.
 */
function tripWithADegenerateMove(): Record<string, unknown> {
  return minimalTripInput({
    slug: "rhone-2024",
    title: "Rhône",
    startDate: "2024-06-01",
    endDate: "2024-06-06",
    places: [PARIS, LYON, LYON_PART_DIEU, BRON],
    steps: [
      stay("paris", "2024-06-01", "2024-06-03"),
      move("paris", "lyon", "train", "2024-06-03"),
      stay("lyon", "2024-06-03", "2024-06-04"),
      move("lyon", "lyon-part-dieu", "foot", "2024-06-04"),
      stay("lyon-part-dieu", "2024-06-04", "2024-06-05"),
      move("lyon-part-dieu", "bron", "bus", "2024-06-05"),
      stay("bron", "2024-06-05", "2024-06-06"),
    ],
  });
}

describe("drawableMoves", () => {
  /**
   * The measured invariant. A `<path>` whose two ends round to the same pixel
   * is not "nothing to draw": it is a one-pixel artefact that still takes a tab
   * stop, still answers a hover, and describes a journey of 95 metres. The step
   * stays in the trip — dropping it would rewrite the traveller's story — and
   * only the drawing loses it.
   */
  it("excludes a move shorter than a kilometre while the step stays in the trip", () => {
    const trip = TripSchema.parse(tripWithADegenerateMove());
    const moves: readonly DrawableMove[] = drawableMoves(trip);

    expect(trip.steps).toHaveLength(7);
    expect(moves).toHaveLength(2);
    expect(moves.map((entry) => entry.stepIndex)).toEqual([1, 5]);
    expect(moves.map((entry) => entry.fromSlug)).not.toContain("lyon");
  });

  /**
   * The other side of the threshold: 8 km is a short hop, and it is still a
   * segment worth drawing. A guard written as "same city" or "same country"
   * would swallow it.
   */
  it("keeps a move of a few kilometres", () => {
    const trip = TripSchema.parse(tripWithADegenerateMove());

    expect(drawableMoves(trip).map((entry) => entry.toSlug)).toContain("bron");
  });

  it("carries the itinerary order, the mode and the resolved coordinates of each drawn move", () => {
    const trip = TripSchema.parse(tripWithADegenerateMove());
    const moves = drawableMoves(trip);

    expect(moves.map((entry) => entry.fromSlug)).toEqual(["paris", "lyon-part-dieu"]);
    expect(moves.map((entry) => entry.toSlug)).toEqual(["lyon", "bron"]);
    expect(moves.map((entry) => entry.mode)).toEqual(["train", "bus"]);
    expect(moves.map((entry) => entry.from)).toEqual([
      PARIS.coordinates,
      LYON_PART_DIEU.coordinates,
    ]);
    expect(moves.map((entry) => entry.to)).toEqual([LYON.coordinates, BRON.coordinates]);
  });

  it("measures each drawn move it carries", () => {
    const trip = TripSchema.parse(tripWithADegenerateMove());
    const [longHaul, shortHop] = drawableMoves(trip).map((entry) => entry.distanceKm);

    expect(longHaul).toBeGreaterThan(385);
    expect(longHaul).toBeLessThan(400);
    expect(shortHop).toBeGreaterThan(5);
    expect(shortHop).toBeLessThan(12);
  });

  it("draws nothing for a trip made only of stays", () => {
    const trip = TripSchema.parse(minimalTripInput());

    expect(drawableMoves(trip)).toEqual([]);
  });
});
