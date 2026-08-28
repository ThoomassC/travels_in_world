/**
 * The initial framing of the world map: given the trip markers, which rectangle
 * of the projected world does the reader actually see.
 *
 * Nothing here projects anything. `src/map/**` turns coordinates into a `<path>`
 * and into an `{ x, y }` inside a fixed 960 × 500 box — the exact default of
 * `geoNaturalEarth1()` — and this module only *crops* that box by emitting a
 * narrower `viewBox`. That distinction is load-bearing: cropping keeps every
 * path byte-identical, so the 1-decimal rounding the geometry layer calibrated
 * (30 KB brotli instead of 45) stays valid. Re-projecting to fit the extent
 * would recompute all 177 geometries and destroy that calibration for the same
 * visual result.
 *
 * Pure, and deliberately free of React, of Next and of d3: the framing rules
 * below are the ones worth a hundred test cases, and they run in milliseconds.
 */

export type Point = { readonly x: number; readonly y: number };

/** The projected world the frame is cut out of — 960 × 500 for this map. */
export type WorldBox = { readonly width: number; readonly height: number };

export type Frame = {
  /** The `viewBox` attribute, ready to render. */
  readonly viewBox: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Breathing room around the markers, as a fraction of the extent's *larger*
 * side — not of each axis independently.
 *
 * Two trips at the same latitude have an extent of zero height, and a per-axis
 * margin would pad the horizontal generously and the vertical not at all,
 * putting both markers exactly on the top and bottom edges before the aspect
 * correction below stretches the box back open. A uniform pad in world units
 * keeps the markers away from every edge whatever the shape of the extent.
 */
const MARGIN_FRACTION = 0.15;

/**
 * A single trip is the case that decides this constant. Its extent is a *point*:
 * zero width, zero height, so a margin proportional to it is also zero and a
 * naive fit zooms in without bound — the reader gets a flat wash of one country's
 * interior with no coastline in sight and no way to tell Osaka from Odessa.
 *
 * 30 % of the world's width is roughly a continent: enough coastline to place
 * the marker at a glance, tight enough that one trip does not render as a world
 * map with a dot on it. It is a legibility floor, not a zoom preference — the
 * acceptance criterion is literally "the map stays legible with a single trip".
 */
const MIN_FRAME_WIDTH_FRACTION = 0.3;

/**
 * One decimal, like the paths this frame crops. At a rendered width of ~900 px
 * over a 288-unit frame, 0.1 world unit is a third of a pixel — invisible — and
 * it keeps the attribute short and the test diffs stable.
 */
const DECIMALS = 1;

const isFinitePoint = (point: Point): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const roundDown = (value: number): number => Math.floor(value * 10 ** DECIMALS) / 10 ** DECIMALS;
const roundUp = (value: number): number => Math.ceil(value * 10 ** DECIMALS) / 10 ** DECIMALS;

/** Trims the `.0` a fixed-decimal format would leave on every whole number. */
function format(value: number): string {
  return value.toFixed(DECIMALS).replace(/\.0$/, "");
}

function toFrame(x: number, y: number, width: number, height: number): Frame {
  return {
    viewBox: `${format(x)} ${format(y)} ${format(width)} ${format(height)}`,
    x,
    y,
    width,
    height,
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * The frame that shows every marker with a margin, normalised to the world's own
 * aspect ratio and clamped inside the world.
 *
 * **The aspect normalisation is not cosmetic.** The markers are HTML positioned
 * in percentages over the SVG, so the container's aspect ratio and the
 * `viewBox`'s must agree exactly or every marker drifts from its country. Giving
 * the frame the world's ratio means one CSS value describes both, and
 * `preserveAspectRatio` never has to letterbox.
 *
 * **No extent means the whole world**, which is not a degenerate case here: the
 * journal ships with `content/trips` empty until TIW-24, so a world map with no
 * marker and a "0 voyage" counter is the *current* production rendering, not a
 * theoretical zero.
 *
 * **Precondition, and the one place this contract is not total:** every point is
 * expected to lie inside `world`. The frame is capped at the world's own size, so
 * a point outside it cannot be framed — and the alternative, letting the frame
 * grow past the world to swallow it, would show empty space beyond the map's own
 * edge. The precondition holds by construction: `projectPoint` (TIW-12) answers
 * coordinates of the projection it owns, measured at x ∈ [6.3, 953.7] and
 * y ∈ [8.3, 499.3] for the 110m dataset, or `null` for a point it cannot place.
 * A point beyond the world therefore means the caller mixed two coordinate
 * spaces, which is a bug to find rather than a case to absorb.
 *
 * Non-finite points are skipped rather than propagated. `CoordinatesSchema`
 * rejects `NaN` and `projectPoint` answers `null` for a point it cannot place,
 * so this is unreachable through the sanctioned path — but a single `NaN`
 * reaching `Math.min` poisons the whole frame into `viewBox="NaN NaN NaN NaN"`,
 * and the map then disappears in silence. Same posture as `drawableMoves` in
 * `src/domain/route.ts`, for the same reason.
 */
export function frameAround(points: readonly Point[], world: WorldBox): Frame {
  /**
   * A world with no area is a programming error, and the only case in this
   * module that throws rather than degrades.
   *
   * Measured before this guard existed: `{ width: 0, height: 0 }` with one point
   * answered `viewBox="0 NaN 0 NaN"`, and `{ width: NaN, height: 500 }` answered
   * `"NaN NaN NaN NaN"`. A browser ignores an unparseable `viewBox` and falls
   * back to the intrinsic size — the map renders, empty, with every marker piled
   * in a corner and nothing in the console.
   *
   * Why this throws where a non-finite *point* is merely skipped: a point is one
   * datum among many, and dropping it costs one marker on a map that still
   * works — the posture `drawableMoves` takes in `src/domain/route.ts`. The world
   * box is the coordinate space itself. There is no partial result to salvage,
   * and no value to return that is not a lie. Failing the build with the offending
   * value named is the only outcome that leads anyone to the cause.
   */
  if (!(Number.isFinite(world.width) && Number.isFinite(world.height))) {
    throw new TypeError(
      `The world box must be two finite numbers; received ${world.width} × ${world.height}.`
    );
  }
  if (!(world.width > 0 && world.height > 0)) {
    throw new RangeError(
      `The world box must have an area; received ${world.width} × ${world.height}.`
    );
  }

  const placed = points.filter(isFinitePoint);

  if (placed.length === 0) {
    return toFrame(0, 0, world.width, world.height);
  }

  const xs = placed.map((point) => point.x);
  const ys = placed.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pad = MARGIN_FRACTION * Math.max(maxX - minX, maxY - minY);

  const worldAspect = world.width / world.height;
  const minWidth = world.width * MIN_FRAME_WIDTH_FRACTION;

  let width = Math.max(maxX - minX + 2 * pad, minWidth);
  /**
   * No floor on the height, deliberately, and it took a mutation run to be sure:
   * a `Math.max(…, minWidth / worldAspect)` here is unobservable. The aspect step
   * below only ever grows the short side, so it leaves `width ≥ minWidth` and
   * `width / height = worldAspect` — which forces `height ≥ minWidth / worldAspect`
   * on its own. Removing the floor killed no test out of 115, because it guarded
   * nothing.
   *
   * Same discipline as the domain purity rule, where writing the test revealed
   * that three of its four patterns were redundant (`AGENTS.md`). A guard that
   * cannot be observed is not a safety net, it is a claim nobody can check.
   */
  let height = maxY - minY + 2 * pad;

  // Grow the short side, never shrink the long one: shrinking would push a
  // marker out of the frame the margin was just computed to keep inside.
  // `height` can legitimately be 0 here (a single trip), and `width / 0` is
  // `Infinity`, which is not below `worldAspect` — so the else branch runs and
  // derives the height from the floored width. `width` is never 0.
  if (width / height < worldAspect) {
    width = height * worldAspect;
  } else {
    height = width / worldAspect;
  }

  // Rounded *outwards* so a marker sitting on the edge of the unrounded frame
  // cannot fall outside the rounded one, then capped: the frame is a window on
  // the world and can never be larger than it.
  width = Math.min(roundUp(width), world.width);
  height = Math.min(roundUp(height), world.height);

  // Centred on the extent, then slid back inside the world — which is what keeps
  // a trip near the antimeridian or near a pole from framing empty space.
  const x = clamp(roundDown((minX + maxX) / 2 - width / 2), 0, world.width - width);
  const y = clamp(roundDown((minY + maxY) / 2 - height / 2), 0, world.height - height);

  return toFrame(x, y, width, height);
}
