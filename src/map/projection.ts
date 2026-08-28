import { geoNaturalEarth1 } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type { Coordinates } from "@/domain/geo";
import { roundCoordinate } from "./path-context";

/**
 * The one projection of this site, and the box everything is drawn into.
 *
 * **Why Natural Earth I, and why no `fitSize`.** Measured on `geoNaturalEarth1()`
 * with its factory defaults: `translate` is `[480, 250]` and `scale` is
 * `175.295`, which places the whole world inside x ∈ [6.263, 953.737] and
 * y ∈ [8.314, 499.338]. Those defaults *are* a 960 × 500 frame — d3 calibrated
 * them for it — so the box below is not an arbitrary choice followed by a fit,
 * it is the projection's own natural frame written down.
 *
 * That is why `fitExtent`/`fitSize` are deliberately not called. Fitting would
 * re-derive scale and translate from the bounding box of whatever geometry is
 * passed in, which means the *content* would move the coastlines: a build with
 * one dataset vintage and a build with the next would not agree on where Tokyo
 * is, and markers projected here would drift against paths projected there.
 * Fixed defaults make the projection a constant, so a point and a path computed
 * at different moments still land on the same pixel.
 */

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 500;

export const WORLD_VIEW_BOX = {
  value: `0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
} as const;

/**
 * What the rest of `src/map` is allowed to see of the projection: the call
 * signature `projectPoint` uses, and the `stream` method `geoPath` uses. Nothing
 * else.
 *
 * `GeoProjection` also exposes `scale()`, `translate()`, `rotate()`, `center()`
 * and their siblings, every one of which mutates the instance in place. Since
 * one instance is shared — see below — a single `worldProjection.scale(300)`
 * anywhere after `loadWorldDataset()` has run would re-aim `projectPoint` while
 * the cached paths keep the old calibration: markers in the sea, build green,
 * nothing logged. That is exactly the desynchronisation sharing one instance is
 * meant to prevent, so the setters are typed away and reaching for one is now a
 * compile error rather than a bug six months out.
 *
 * This narrows the *type*, not the object: `geoNaturalEarth1()` still returns a
 * mutable projection, and a determined caller can widen it back. The point is
 * that doing so has to be written down.
 */
type ImmutableProjection = Pick<GeoProjection, "stream"> & {
  (point: [number, number]): [number, number] | null;
};

/**
 * Shared by the path builder and by `projectPoint`, and it must stay shared: two
 * instances would be configured identically today and are one edit away from not
 * being, at which point markers and coastlines disagree by a few pixels and
 * nothing fails. A d3 projection is a pure function of its settings — calling it
 * does not mutate it — so one instance is safe to reuse for every point and
 * every geometry of the build.
 */
export const worldProjection: ImmutableProjection = geoNaturalEarth1();

export type ProjectedPoint = { readonly x: number; readonly y: number };

/**
 * A place on the globe, in viewBox units, rounded like the paths are.
 *
 * `null` rather than a throw or a clamped point, for the two ways a projection
 * declines to answer: d3 returns `null` for a coordinate its clip discards, and
 * a degenerate coordinate can come back as `NaN` — which would render as an
 * attribute the browser ignores, i.e. an invisible marker with no error
 * anywhere. Both collapse to `null` so the caller has to decide what to do, and
 * `NaN` is checked explicitly because it is not caught by the `null` branch.
 *
 * Natural Earth I clips nothing (`clipAngle` is 0), so with coordinates that
 * passed `CoordinatesSchema` this returns a point today. The guard is for the
 * day the projection changes, not for the data.
 */
export function projectPoint(coordinates: Coordinates): ProjectedPoint | null {
  // d3 takes [longitude, latitude] — the reverse of how the content writes it,
  // and of how anyone says it out loud.
  const projected = worldProjection([coordinates.lon, coordinates.lat]);

  if (projected === null) {
    return null;
  }

  const [x, y] = projected;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x: roundCoordinate(x), y: roundCoordinate(y) };
}
