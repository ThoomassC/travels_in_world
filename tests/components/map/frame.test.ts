import { describe, expect, it } from "vitest";
import type { Point, WorldBox } from "@/components/map/frame";
import { frameAround } from "@/components/map/frame";
import {
  aspectDeviation,
  aspectRoundingTolerance,
  EUROPE_EXTENT,
  MARGIN_FRACTION,
  MIN_FRAME_WIDTH_FRACTION,
  outsideFrame,
  pseudoRandomPoints,
  SQUARE_WORLD,
  WHOLE_WORLD_EXTENT,
  WORLD,
} from "./fixtures";

/**
 * The initial framing of the map. Four things break here without anyone
 * noticing, and each has its own block below: a single `NaN` that turns the
 * `viewBox` into `"NaN NaN NaN NaN"` and erases the map; a marker pushed just
 * outside the frame by a rounding that went the wrong way; a frame whose ratio
 * drifts from the world's, which slides every marker off its coastline because
 * the markers are HTML positioned in percent over the SVG; and a frame that
 * escapes the world and fills a third of the page with blank paper.
 *
 * All of it is arithmetic, so the cases are exact values wherever the arithmetic
 * is exact, and a derived tolerance — never a guessed one — where it is not.
 */

const CORNERS: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 960, y: 0 },
  { x: 0, y: 500 },
  { x: 960, y: 500 },
];

const SQUARE_WORLD_EXTENT = { minX: 50, maxX: 450, minY: 50, maxY: 450 };

/**
 * The point sets that drive the four properties every frame owes, whatever the
 * input: it holds every finite point, it stays inside the world, it keeps the
 * world's ratio, and it is never narrower than the legibility floor. The three
 * volumetries the acceptance criterion names — 0, 1 and 60 trips — are all here.
 */
const FRAMING_CASES: readonly {
  readonly label: string;
  readonly points: readonly Point[];
  readonly world: WorldBox;
}[] = [
  { label: "no trip at all", points: [], world: WORLD },
  { label: "a single trip", points: [{ x: 800, y: 150 }], world: WORLD },
  {
    label: "two trips at the very same spot",
    points: [
      { x: 800, y: 150 },
      { x: 800, y: 150 },
    ],
    world: WORLD,
  },
  { label: "a single trip at the world's origin", points: [{ x: 0, y: 0 }], world: WORLD },
  { label: "a single trip at the world's far corner", points: [{ x: 960, y: 500 }], world: WORLD },
  { label: "trips on the world's four corners", points: CORNERS, world: WORLD },
  {
    label: "a flat extent, two trips at the same latitude",
    points: [
      { x: 200, y: 250 },
      { x: 700, y: 250 },
    ],
    world: WORLD,
  },
  {
    label: "a tall extent, two trips at the same longitude",
    points: [
      { x: 480, y: 50 },
      { x: 480, y: 450 },
    ],
    world: WORLD,
  },
  {
    label: "a rectangular extent in the middle of the world",
    points: [
      { x: 300, y: 200 },
      { x: 700, y: 300 },
    ],
    world: WORLD,
  },
  {
    label: "a rectangular extent whose height is half its width",
    points: [
      { x: 300, y: 150 },
      { x: 700, y: 350 },
    ],
    world: WORLD,
  },
  {
    label: "one placed trip among trips that could not be projected",
    points: [
      { x: Number.NaN, y: 250 },
      { x: 800, y: 150 },
      { x: 300, y: Number.POSITIVE_INFINITY },
    ],
    world: WORLD,
  },
  {
    label: "60 trips across western Europe",
    points: pseudoRandomPoints(60, EUROPE_EXTENT),
    world: WORLD,
  },
  {
    label: "60 trips across the whole world",
    points: pseudoRandomPoints(60, WHOLE_WORLD_EXTENT),
    world: WORLD,
  },
  {
    label: "60 trips in a square world",
    points: pseudoRandomPoints(60, SQUARE_WORLD_EXTENT),
    world: SQUARE_WORLD,
  },
  { label: "a single trip in a square world", points: [{ x: 250, y: 250 }], world: SQUARE_WORLD },
];

describe("frameAround — the invariant every frame owes", () => {
  /**
   * The one that matters. A marker outside the frame is not clipped politely: it
   * is an `<a>` at `left: -19%` inside an `overflow: hidden` container, so the
   * trip becomes unreachable by mouse while keeping its tab stop — a focus ring
   * on nothing.
   */
  it.each(FRAMING_CASES)("holds every finite point of $label inside the frame", (testCase) => {
    expect(outsideFrame(testCase.points, frameAround(testCase.points, testCase.world))).toEqual([]);
  });

  it.each(FRAMING_CASES)("keeps the frame for $label inside the world", (testCase) => {
    const frame = frameAround(testCase.points, testCase.world);

    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(testCase.world.width);
    expect(frame.y + frame.height).toBeLessThanOrEqual(testCase.world.height);
  });

  /**
   * The markers are HTML over the SVG, so the container's ratio and the
   * `viewBox`'s are the same CSS number: a frame 1 % off its world's ratio moves
   * every marker by roughly 9 px at a 900 px render, which is the difference
   * between Calais and Dover.
   */
  it.each(FRAMING_CASES)("gives the frame for $label the world's own ratio", (testCase) => {
    const frame = frameAround(testCase.points, testCase.world);

    expect(aspectDeviation(frame, testCase.world)).toBeLessThanOrEqual(
      aspectRoundingTolerance(frame, testCase.world)
    );
  });

  it.each(FRAMING_CASES)("never frames $label narrower than 30 % of the world", (testCase) => {
    const frame = frameAround(testCase.points, testCase.world);

    expect(frame.width).toBeGreaterThanOrEqual(testCase.world.width * MIN_FRAME_WIDTH_FRACTION);
    expect(frame.height).toBeGreaterThanOrEqual(testCase.world.height * MIN_FRAME_WIDTH_FRACTION);
  });

  it.each(FRAMING_CASES)("emits four finite numbers in the viewBox for $label", (testCase) => {
    const frame = frameAround(testCase.points, testCase.world);

    expect(frame.viewBox).toMatch(/^\d+(\.\d)? \d+(\.\d)? \d+(\.\d)? \d+(\.\d)?$/);
    expect(frame.viewBox.split(" ").map(Number)).toEqual([
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    ]);
  });
});

describe("frameAround — no trip has a usable point (the current production rendering)", () => {
  /**
   * `content/trips` stays empty until TIW-24, so this is not a theoretical zero:
   * it is what every visitor sees today. A frame of `0 0 0 0` here renders an SVG
   * of nothing at all, with no error anywhere.
   */
  it("frames the whole world for no trip, and writes the viewBox without a stray decimal", () => {
    expect(frameAround([], WORLD)).toEqual({
      viewBox: "0 0 960 500",
      x: 0,
      y: 0,
      width: 960,
      height: 500,
    });
  });

  it("frames the whole world for no trip in a square world", () => {
    expect(frameAround([], SQUARE_WORLD)).toEqual({
      viewBox: "0 0 500 500",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
    });
  });

  /**
   * `CoordinatesSchema` rejects `NaN` and the projection answers `null` for a
   * point it cannot place, so none of these should reach here — but a single one
   * that did would poison `Math.min` and emit `viewBox="NaN NaN NaN NaN"`, which
   * the browser discards. The map then vanishes with nothing in the console.
   */
  it.each([
    { label: "both coordinates NaN", points: [{ x: Number.NaN, y: Number.NaN }] },
    { label: "a finite longitude and a NaN latitude", points: [{ x: 400, y: Number.NaN }] },
    { label: "a NaN longitude and a finite latitude", points: [{ x: Number.NaN, y: 250 }] },
    { label: "a positive infinity", points: [{ x: Number.POSITIVE_INFINITY, y: 0 }] },
    { label: "a negative infinity", points: [{ x: 0, y: Number.NEGATIVE_INFINITY }] },
    {
      label: "two trips, each unusable on a different axis",
      points: [
        { x: Number.NaN, y: 1 },
        { x: 2, y: Number.POSITIVE_INFINITY },
      ],
    },
  ])("frames the whole world when every point has $label", ({ points }) => {
    expect(frameAround(points, WORLD).viewBox).toBe("0 0 960 500");
  });

  it("frames on the finite points alone rather than propagating a NaN", () => {
    const frame = frameAround(
      [
        { x: Number.NaN, y: 250 },
        { x: 800, y: 150 },
        { x: 300, y: Number.POSITIVE_INFINITY },
      ],
      WORLD
    );

    expect(frame.viewBox).toBe("656 75 288 150");
    expect(frame.viewBox).not.toContain("NaN");
  });
});

describe("frameAround — a single trip (acceptance criterion: legible with one trip)", () => {
  /**
   * The extent of one trip is a point, so a margin proportional to it is zero and
   * a naive fit zooms without bound: the reader gets a flat wash of Honshū's
   * interior with no coastline in sight. 288 units is 30 % of the world — roughly
   * a continent, which is what makes the marker placeable at a glance.
   */
  it("frames 30 % of the world's width around a lone trip, centred on it", () => {
    expect(frameAround([{ x: 800, y: 150 }], WORLD)).toEqual({
      viewBox: "656 75 288 150",
      x: 656,
      y: 75,
      width: 288,
      height: 150,
    });
  });

  /**
   * Two trips, one extent of zero area. Nothing about the framing may depend on
   * how many markers share the spot — a second trip to Tokyo must not change what
   * the reader sees.
   */
  it("frames two trips at the same spot exactly as it frames one", () => {
    expect(
      frameAround(
        [
          { x: 800, y: 150 },
          { x: 800, y: 150 },
        ],
        WORLD
      )
    ).toEqual(frameAround([{ x: 800, y: 150 }], WORLD));
  });

  /**
   * Centring on the origin asks for a frame starting at −144, and clamping asks
   * for one inside the world. Get the order wrong and either the `viewBox` starts
   * negative — half the frame is off-canvas paper — or the point falls out.
   */
  it("frames a lone trip at the world's origin without leaving the world", () => {
    expect(frameAround([{ x: 0, y: 0 }], WORLD).viewBox).toBe("0 0 288 150");
  });

  it("frames a lone trip at the world's far corner without leaving the world", () => {
    expect(frameAround([{ x: 960, y: 500 }], WORLD).viewBox).toBe("672 350 288 150");
  });

  /** 30 % of 500 is 150, and the ratio is 1: any width/height swap shows up here. */
  it("frames 30 % of a square world's width around a lone trip, and stays square", () => {
    expect(frameAround([{ x: 250, y: 250 }], SQUARE_WORLD)).toEqual({
      viewBox: "175 175 150 150",
      x: 175,
      y: 175,
      width: 150,
      height: 150,
    });
  });
});

describe("frameAround — the margin around the extent", () => {
  /**
   * The case the uniform margin exists for. Two trips at the same latitude have an
   * extent of zero height; a per-axis margin pads the horizontal generously and
   * the vertical by nothing at all, pinning both markers on the top and bottom
   * edges of the frame — where the marker's own 44 px target is half outside the
   * map.
   *
   * This case pins the outcome, and it does *not* prove the margin is uniform:
   * measured against a per-axis implementation, a zero-height extent produces the
   * identical frame, because the 288-unit floor and the ratio normalisation both
   * swamp a vertical pad of 30. The case that separates the two is the next one.
   */
  it("pads a flat extent vertically by 15 % of its width and not by nothing", () => {
    const trips: readonly Point[] = [
      { x: 300, y: 250 },
      { x: 500, y: 250 },
    ];
    const pad = MARGIN_FRACTION * 200;
    const frame = frameAround(trips, WORLD);

    expect(frame.y).toBeLessThanOrEqual(250 - pad);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(250 + pad);
    expect(frame.viewBox).toBe("256 175 288 150");
  });

  /**
   * The mirror case, where the extent has zero width. Here the margin is 15 % of
   * the *height*, 37.5 units, and it is the binding constraint on the vertical:
   * 125 − 37.5 = 87.5 is the frame's top edge to the unit.
   */
  it("pads an extent of zero width by 15 % of its height on both axes", () => {
    const frame = frameAround(
      [
        { x: 480, y: 125 },
        { x: 480, y: 375 },
      ],
      WORLD
    );

    expect(frame.y).toBe(87.5);
    expect(frame.y + frame.height).toBe(412.5);
    expect(frame.viewBox).toBe("168 87.5 624 325");
  });

  /**
   * The extent that separates a uniform margin from a per-axis one, and the only
   * shape in this suite that does. 400 wide by 200 tall: 15 % of the *longer*
   * side is 60, so the height becomes 200 + 120 = 320 and the ratio then drives
   * the width to 614.4. A per-axis margin pads the vertical by 15 % of 200 = 30,
   * lands on 260, and normalises to 520 × 270.9 — a frame 94 units narrower, with
   * both markers 30 units closer to the top and bottom edges than the margin
   * promised. Nothing about that looks wrong on screen; it is simply tighter than
   * it was specified to be, every time, forever.
   */
  it("pads a rectangular extent by 15 % of its longer side, not of each axis", () => {
    const pad = MARGIN_FRACTION * 400;
    const frame = frameAround(
      [
        { x: 300, y: 150 },
        { x: 700, y: 350 },
      ],
      WORLD
    );

    expect(frame.y).toBeLessThanOrEqual(150 - pad);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(350 + pad);
    expect(frame.viewBox).toBe("192.8 90 614.4 320");
  });

  /**
   * A flatter rectangle, where the horizontal margin is the binding one on both
   * edges: 300 − 60 and 700 + 60. It also pins the outward rounding, since the
   * height falls on 270.8333 — see the block below.
   */
  it("pads a rectangular extent by 15 % of its larger side on every edge", () => {
    const frame = frameAround(
      [
        { x: 300, y: 200 },
        { x: 700, y: 300 },
      ],
      WORLD
    );

    expect(frame.x).toBe(240);
    expect(frame.x + frame.width).toBe(760);
    expect(frame.y).toBeLessThanOrEqual(200 - 60);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(300 + 60);
  });
});

describe("frameAround — normalising to the world's ratio", () => {
  /**
   * A flat extent 500 units wide needs a frame 650 wide; the world's ratio then
   * demands 338.5416… of height. The height is what grows — shrinking the width
   * to 288 instead would push both markers straight back out of the frame the
   * margin had just been computed to hold.
   */
  it("grows the height of a flat extent rather than shrinking its width", () => {
    const frame = frameAround(
      [
        { x: 200, y: 250 },
        { x: 700, y: 250 },
      ],
      WORLD
    );

    expect(frame.width).toBe(650);
    expect(frame.height).toBe(338.6);
    expect(frame.x).toBe(125);
    expect(frame.x + frame.width).toBe(775);
  });

  /**
   * The other direction: an extent of zero width needs 325 units of height, and
   * the width grows from the 288 floor to 624 to match. A frame that kept 288
   * would be letterboxed by `preserveAspectRatio`, and the markers — positioned
   * against the container, not the SVG's rendered box — would all drift inwards.
   */
  it("grows the width of a tall extent rather than shrinking its height", () => {
    const frame = frameAround(
      [
        { x: 480, y: 125 },
        { x: 480, y: 375 },
      ],
      WORLD
    );

    expect(frame.width).toBe(624);
    expect(frame.height).toBe(325);
  });

  it("normalises a flat extent in a square world to a square frame", () => {
    expect(
      frameAround(
        [
          { x: 100, y: 250 },
          { x: 400, y: 250 },
        ],
        SQUARE_WORLD
      )
    ).toEqual({ viewBox: "55 55 390 390", x: 55, y: 55, width: 390, height: 390 });
  });
});

describe("frameAround — rounding outwards to one decimal", () => {
  /**
   * 270.8333… rounded to 270.8 would be a frame 0.03 units shorter than the one
   * the margin asked for. That is invisible on its own, and it is also the one
   * direction in which a marker on the edge can leave the frame — hence up for
   * the size, down for the origin, always.
   */
  it("rounds the frame's height up and its origin down, never the reverse", () => {
    const frame = frameAround(
      [
        { x: 300, y: 200 },
        { x: 700, y: 300 },
      ],
      WORLD
    );

    expect(frame.height).toBe(270.9);
    expect(frame.viewBox).toBe("240 114.5 520 270.9");
  });

  it("rounds the origin of a lone trip down to one decimal", () => {
    expect(frameAround([{ x: 500.13, y: 250.44 }], WORLD).viewBox).toBe("356.1 175.4 288 150");
  });

  it.each(FRAMING_CASES)("keeps at most one decimal on every number for $label", (testCase) => {
    const frame = frameAround(testCase.points, testCase.world);

    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([
      Math.round(frame.x * 10) / 10,
      Math.round(frame.y * 10) / 10,
      Math.round(frame.width * 10) / 10,
      Math.round(frame.height * 10) / 10,
    ]);
  });
});

describe("frameAround — the world is a hard ceiling", () => {
  /**
   * Trips on all four corners already span the world, and the 144-unit margin
   * would ask for a frame 1513 × 788. A frame larger than the world scales the
   * map down and surrounds it with blank paper on all sides — the drawn world
   * ends up occupying less than half the page it was given.
   */
  it("frames exactly the world for an extent that already spans it", () => {
    expect(frameAround(CORNERS, WORLD)).toEqual({
      viewBox: "0 0 960 500",
      x: 0,
      y: 0,
      width: 960,
      height: 500,
    });
  });

  /**
   * The margin is what overflows here, not the extent: 400 units of latitude plus
   * 2 × 60 of margin is 520 in a world 500 tall. The margin is the thing that
   * gives way — the ceiling is not negotiable — and the frame becomes the world.
   */
  it("gives up the margin rather than framing more than the world", () => {
    expect(
      frameAround(
        [
          { x: 480, y: 50 },
          { x: 480, y: 450 },
        ],
        WORLD
      ).viewBox
    ).toBe("0 0 960 500");
  });
});
