import type { Coordinates, Slug } from "./geo";
import type { Place, Step, TransportMode } from "./schema";

/**
 * Geometry for the map: how far apart two points are, and which moves are worth
 * drawing between them.
 */

/** Mean earth radius. The map is a world overview, not a survey instrument. */
const EARTH_RADIUS_KM = 6371;

/**
 * Below this, the two ends of the segment round to the same pixel. A one-pixel
 * `<path>` is not "nothing to draw": it still takes a tab stop and still answers
 * a hover, for a journey of 95 metres.
 */
const MIN_DRAWABLE_KM = 1;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance, by the haversine formula. Two properties are why it is
 * this formula and not another:
 *
 * - it returns **exactly** 0 for a point and itself, where the spherical law of
 *   cosines reaches `acos(1.0000000000000002)` and answers `NaN` — which would
 *   then propagate silently into every SVG coordinate;
 * - `sin(Δλ/2)²` is periodic over 360°, so a pair straddling the antimeridian
 *   (179.5°E to 179.5°W) measures the 111 km it is, with no wrapping arithmetic.
 *   A plain subtraction sees 359° and draws a line across the whole world.
 *
 * The deltas are taken as absolute values so the result is bit-for-bit identical
 * in both directions: `|a - b|` and `|b - a|` are the same IEEE double, and
 * multiplication is commutative, so no step of the computation can disagree.
 */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  const deltaLat = toRadians(Math.abs(to.lat - from.lat));
  const deltaLon = toRadians(Math.abs(to.lon - from.lon));

  const halfChordSquared =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLon / 2) ** 2;

  // `Math.min(1, …)` guards the antipodal case, where rounding can push the
  // radicand a hair above 1 and `asin` would answer `NaN`.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(halfChordSquared)));
}

/** A move resolved into what the renderer needs: two points and a measurement. */
export type DrawableMove = {
  readonly stepIndex: number;
  readonly fromSlug: Slug;
  readonly toSlug: Slug;
  readonly mode: TransportMode;
  readonly from: Coordinates;
  readonly to: Coordinates;
  readonly distanceKm: number;
};

/**
 * The moves of a trip, in itinerary order, resolved against its places — stays
 * ignored, and moves shorter than {@link MIN_DRAWABLE_KM} left out.
 *
 * A move that is not drawn still belongs to the trip: it is how the traveller
 * got there, and dropping it from the timeline would rewrite the story. Only the
 * drawing loses it, which is why this returns a projection instead of filtering
 * `steps`. `stepIndex` is the index in `trip.steps`, so a drawn segment can be
 * tied back to the timeline entry it came from.
 */
export function drawableMoves(trip: {
  readonly places: readonly Place[];
  readonly steps: readonly Step[];
}): readonly DrawableMove[] {
  const coordinatesBySlug = new Map<Slug, Coordinates>(
    trip.places.map((place) => [place.slug, place.coordinates])
  );

  const moves: DrawableMove[] = [];

  trip.steps.forEach((step, stepIndex) => {
    if (step.kind !== "move") {
      return;
    }

    const from = coordinatesBySlug.get(step.fromSlug);
    const to = coordinatesBySlug.get(step.toSlug);
    // Unreachable on a parsed trip — `TripSchema` rejects a step referencing an
    // undeclared place. Skipping rather than throwing keeps an unvalidated
    // caller from taking the whole map down over one segment.
    if (from === undefined || to === undefined) {
      return;
    }

    // Negated `>=`, not `<`: `NaN < 1` is `false`, so a comparison written the
    // obvious way lets a non-finite coordinate through and the renderer emits
    // `d="M NaN,NaN …"` — a segment that vanishes without a word. Only a
    // measured, drawable distance passes. `CoordinatesSchema` rejects `NaN`, so
    // this needs the same unvalidated caller the slug guard above assumes.
    const distance = distanceKm(from, to);
    if (!(distance >= MIN_DRAWABLE_KM)) {
      return;
    }

    moves.push({
      stepIndex,
      fromSlug: step.fromSlug,
      toSlug: step.toSlug,
      mode: step.mode,
      from,
      to,
      distanceKm: distance,
    });
  });

  return moves;
}
