/**
 * Inputs and three oracles for the world-map framing suite.
 *
 * Unlike `tests/domain/fixtures.ts`, this file *does* import from the modules it
 * serves — but only their types. The distinction is the nature of the data: the
 * domain suite feeds a validator objects that must be rejected, so typing them
 * would make half the cases unwritable. Nothing here is meant to be rejected. A
 * `Point` with `x: NaN` is still a `Point` as far as TypeScript is concerned,
 * which is the whole reason `frameAround` has to guard against one at runtime.
 *
 * The three oracles exist because the alternative is a loop or a boolean:
 *
 * - {@link outsideFrame} names the points that escaped instead of answering
 *   "some did", so a failure reads as a coordinate and not as `false`.
 * - {@link aspectDeviation} and {@link aspectRoundingTolerance} turn the
 *   "same ratio as the world" contract into two numbers a test can compare,
 *   with the tolerance *derived* from the rounding rather than picked.
 * - {@link pseudoRandomPoints} replaces `Math.random()`, which would make a
 *   failure impossible to reproduce and a green run meaningless.
 */

import type { Frame, Point, WorldBox } from "@/components/map/frame";
import type { TripMark } from "@/components/map/marks";

/* ------------------------------------------------------------------ worlds -- */

/**
 * The projected world every production frame is cut out of: the exact default
 * box of `geoNaturalEarth1()`, ratio 1.92.
 */
export const WORLD: WorldBox = { width: 960, height: 500 };

/**
 * A world whose ratio is 1, where the minimum frame width (30 % of 500) and the
 * minimum frame height happen to be the same 150 units. Any width/height mix-up
 * in the framing rules is invisible in {@link WORLD} — 288 and 150 are both
 * plausible — and shows up here as a frame that is not square.
 */
export const SQUARE_WORLD: WorldBox = { width: 500, height: 500 };

/** 15 % of the extent's larger side, the margin the frame owes every marker. */
export const MARGIN_FRACTION = 0.15;

/** The legibility floor: a frame is never narrower than 30 % of the world. */
export const MIN_FRAME_WIDTH_FRACTION = 0.3;

/** One decimal on the frame, two on a marker's percentage. */
export const FRAME_STEP = 0.1;

/* ------------------------------------------------------------------ frames -- */

/**
 * A frame written by hand, for the marker-placement suite. `placeMarks` never
 * reads `viewBox`, but leaving it out would mean casting, and a cast is how a
 * test stops testing the type it claims to.
 */
export function frameOf(x: number, y: number, width: number, height: number): Frame {
  return { viewBox: `${x} ${y} ${width} ${height}`, x, y, width, height };
}

/** The no-trip frame: the whole world, which is today's production rendering. */
export const WORLD_FRAME: Frame = frameOf(0, 0, 960, 500);

/**
 * The frame `frameAround` returns for a single trip at `{ x: 800, y: 150 }`.
 * Its origin is deliberately not `0, 0`: a percentage computed against the world
 * instead of against the frame is right for {@link WORLD_FRAME} and wrong here.
 */
export const CROPPED_FRAME: Frame = frameOf(656, 75, 288, 150);

/* ----------------------------------------------------------------- oracles -- */

/** The bounding box a generated point set is drawn from. */
export type Extent = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

/**
 * The finite points that fall outside `frame`, which the invariant expects to be
 * none. Non-finite points are skipped: the framing rules ignore them by design,
 * so demanding they be inside would assert the opposite of the contract.
 *
 * A tolerance would defeat the purpose. The frame is rounded *outwards* precisely
 * so that a point sitting on the unrounded edge cannot fall out of the rounded
 * one, and `<=` is the assertion that rule earns.
 */
export function outsideFrame(points: readonly Point[], frame: Frame): readonly Point[] {
  return points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      !(
        point.x >= frame.x &&
        point.x <= frame.x + frame.width &&
        point.y >= frame.y &&
        point.y <= frame.y + frame.height
      )
  );
}

/** How far the frame's ratio sits from the world's, in ratio units. */
export function aspectDeviation(frame: Frame, world: WorldBox): number {
  return Math.abs(frame.width / frame.height - world.width / world.height);
}

/**
 * The largest deviation the rounding alone can produce — computed, not guessed,
 * because guessing it is how this assertion becomes decoration.
 *
 * Before rounding, the frame satisfies `W / H === A` exactly, with `A` the
 * world's ratio. Width and height are then rounded up *independently*, each
 * gaining `a`, `b` in `[0, 0.1)`. Substituting `W = A·H`:
 *
 *     w/h − A = (W + a)/(H + b) − W/H = (H·a − W·b) / (H·(H + b))
 *
 * whose magnitude is at most `0.1·(H + W)/H² = 0.1·(1 + A)/H`. Only `h` is
 * observable, and `H > h − 0.1`, which gives the bound below. At the tightest
 * frame this suite produces — 288 × 150 in a 1.92 world — it is 0.0019, i.e.
 * 0.1 % of the ratio: about a third of a pixel of marker drift at a 900 px
 * render, and four decimal places above what a genuine width/height mix-up
 * would cost.
 *
 * When the frame is capped at the world's own dimensions the ratio is exact and
 * the deviation is 0, so the bound still holds.
 */
export function aspectRoundingTolerance(frame: Frame, world: WorldBox): number {
  const worldAspect = world.width / world.height;

  return (FRAME_STEP * (1 + worldAspect)) / (frame.height - FRAME_STEP);
}

/* ------------------------------------------------------------------ points -- */

/**
 * Lehmer's minimal standard generator. `Math.random()` is unusable here: a
 * failure on 60 markers has to be reproducible from the file alone, and a seed
 * that changes every run turns a green suite into a coin toss nobody notices.
 *
 * The modulus and multiplier are chosen so that `state * 48271` stays under
 * 2^53 for every state — the arithmetic is exact in a double, so the sequence is
 * identical on every engine, which `Math.sin`-based hashing would not guarantee.
 */
const MINSTD_MULTIPLIER = 48271;
const MINSTD_MODULUS = 2147483647;
const SEED = 20260821;

export function pseudoRandomPoints(count: number, extent: Extent): readonly Point[] {
  let state = SEED % MINSTD_MODULUS;

  const unitInterval = (): number => {
    state = (state * MINSTD_MULTIPLIER) % MINSTD_MODULUS;

    return state / MINSTD_MODULUS;
  };

  return Array.from({ length: count }, () => ({
    x: extent.minX + unitInterval() * (extent.maxX - extent.minX),
    y: extent.minY + unitInterval() * (extent.maxY - extent.minY),
  }));
}

/** The whole projected world — the spread of a journal that has been everywhere. */
export const WHOLE_WORLD_EXTENT: Extent = { minX: 0, maxX: 960, minY: 0, maxY: 500 };

/**
 * Western Europe, roughly: 100 × 70 units out of 960 × 500. The realistic shape
 * of a personal travel journal, and the one that actually exercises the framing
 * — a spread over the whole world makes every frame the world and proves little.
 */
export const EUROPE_EXTENT: Extent = { minX: 420, maxX: 520, minY: 90, maxY: 160 };

/* ------------------------------------------------------------------- marks -- */

/**
 * One marker, at the point {@link CROPPED_FRAME} was built around. Every field
 * is filled because `placeMarks` must hand the object back untouched, and a
 * missing field would make "nothing added, nothing removed" unfalsifiable.
 */
export function tripMark(overrides: Partial<TripMark> = {}): TripMark {
  return {
    // Required on `TripMark` since TIW-36, when the map gained a second kind of
    // marker: a visited place, which has no date, no title and no page.
    kind: "trip",
    slug: "japon-2024",
    title: "Japon, printemps 2024",
    startDate: "2024-04-12",
    placeName: "Tokyo",
    href: "/fr/voyages/japon-2024",
    point: { x: 800, y: 150 },
    // Written by default: `story` is required on `TripMark` (TIW-18), and the
    // framing rules this file serves read neither it nor `isNew`.
    story: "written",
    ...overrides,
  };
}

/**
 * `count` distinct markers spread over `extent`. The slugs count up so a test
 * can assert the input order survived, which is the contract the DOM's tab order
 * rests on.
 */
export function manyTripMarks(count: number, extent: Extent): readonly TripMark[] {
  return pseudoRandomPoints(count, extent).map((point, index) =>
    tripMark({
      slug: `voyage-${index}`,
      title: `Voyage ${index}`,
      // Descending, like the content façade's own order, so a zone's sort has
      // something to preserve rather than a single repeated date.
      startDate: `20${String(24 - (index % 20)).padStart(2, "0")}-06-01`,
      href: `/fr/voyages/voyage-${index}`,
      point,
    })
  );
}
