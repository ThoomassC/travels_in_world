/**
 * The mini-map's window onto the 960 × 500 world box.
 *
 * **Why this is not `src/components/map/frame.ts`.** That module frames the
 * world map, which shows every trip at once, and its floor —
 * `MIN_FRAME_WIDTH_FRACTION = 0.3` — exists precisely to stop one trip zooming
 * the globe down to a single city. This map's job is the opposite: one trip,
 * framed as tightly as is still legible. The two modules therefore need
 * contradictory values for the same constant, and sharing the function would
 * mean one number serving two requirements — the shape of bug that gets
 * "fixed" in one direction and silently breaks the other caller.
 *
 * There is a second, duller reason, and it is worth writing down because it is a
 * repository-level defect rather than a design choice: `src/components/map/*`
 * cannot currently be imported from anywhere at all. The ESLint pattern that
 * seals the map geometry façade is `["@/map/*", "**\/map/*"]`, and `**\/map/*`
 * matches `@/components/map/frame` just as readily as `@/map/world`. Nothing had
 * imported the map component yet, so nobody had hit it. See the ticket report.
 *
 * **The one invariant that cannot bend** is shared with the world map all the
 * same: the frame's aspect ratio must equal the world box's, exactly. The
 * markers are HTML positioned in percentages over the SVG, so the moment
 * `preserveAspectRatio` has to letterbox, every marker drifts off the place it
 * names — documented in `docs/adr/0003-carte-svg-inerte-et-balises-html.md`.
 */

export type MiniMapPoint = { readonly x: number; readonly y: number };
export type MiniMapWorld = { readonly width: number; readonly height: number };

export type MiniMapFrame = {
  /** The four numbers below, serialised — always derived, never written twice. */
  readonly viewBox: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Breathing room around the trip, as a fraction of its own largest extent. */
const MARGIN_FRACTION = 0.18;

/**
 * The tightest the mini-map will zoom, as a fraction of the world's width —
 * about 115 px of the 960 px projection.
 *
 * Exported because the suite asserts it is *below* the world map's 0.3: that
 * inequality is the whole justification for this module existing, and an
 * assertion on the relationship survives a future tweak of either number where
 * an assertion on `0.12` would not.
 *
 * Not zero, and not smaller: the country outlines come from a 110 m dataset, so
 * past this point the reader is looking at a magnified polygon rather than a
 * recognisable coastline — a map that has stopped saying where in the world it
 * is, which is the one thing a mini-map is for.
 */
export const MINI_MAP_MIN_WIDTH_FRACTION = 0.12;

const DECIMALS = 1;
const round = (value: number): number => Number(value.toFixed(DECIMALS));
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
const isFinitePoint = (point: MiniMapPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

function toFrame(x: number, y: number, width: number, height: number): MiniMapFrame {
  const frame = {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };

  // Serialised from the rounded numbers, never from the unrounded ones: a
  // `viewBox` that disagrees with `frame.x` by a rounding step would place the
  // percentage overlay against a window that is not the one drawn.
  return { ...frame, viewBox: `${frame.x} ${frame.y} ${frame.width} ${frame.height}` };
}

/**
 * A window containing every projected point, in the world's aspect ratio, never
 * larger than the world and never hanging outside it.
 *
 * A trip with nothing to frame — no places, or coordinates that all failed to
 * project — gets the whole world rather than an error or an empty box. The
 * reader then sees a world map with no marker on it, which is a truthful
 * rendering of "we could not place this trip"; a zero-width frame would divide
 * by zero in the marker placement and put every marker at `Infinity%`.
 */
export function miniMapFrame(points: readonly MiniMapPoint[], world: MiniMapWorld): MiniMapFrame {
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

  // Padded by the trip's own size, so a continent-wide trip gets continent-wide
  // margins and a city break gets city-sized ones. A fixed padding in world
  // units would swallow the small trip and be invisible on the large one.
  const pad = MARGIN_FRACTION * Math.max(maxX - minX, maxY - minY);

  const aspect = world.width / world.height;
  let width = Math.max(maxX - minX + 2 * pad, world.width * MINI_MAP_MIN_WIDTH_FRACTION);
  let height = maxY - minY + 2 * pad;

  // Grow the deficient axis rather than shrinking the other: shrinking would
  // push a point back out of the window this function just promised to contain.
  if (width / height < aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  width = Math.min(width, world.width);
  height = Math.min(height, world.height);

  // Re-fit after the cap. Clamping the two axes independently against the world
  // box can break the ratio the overlay depends on, so whichever axis was cut is
  // the one that now governs the other.
  if (width / height > aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  const x = clamp((minX + maxX) / 2 - width / 2, 0, world.width - width);
  const y = clamp((minY + maxY) / 2 - height / 2, 0, world.height - height);

  return toFrame(x, y, width, height);
}
