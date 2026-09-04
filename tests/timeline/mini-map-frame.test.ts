import { describe, expect, it } from "vitest";
import { MINI_MAP_MIN_WIDTH_FRACTION, miniMapFrame } from "@/components/timeline/mini-map-frame";

/**
 * The mini-map's window onto the world, and why it is not
 * `src/components/map/frame.ts`.
 *
 * That module frames the *world* map, whose job is to show every trip at once;
 * its `MIN_FRAME_WIDTH_FRACTION = 0.3` exists to stop a single trip zooming the
 * globe down to a city. This map has the opposite job — one trip, framed as
 * tightly as it can usefully be — so it keeps a much smaller floor. Sharing one
 * function would mean one constant serving two contradictory requirements.
 *
 * What the two *do* share is the invariant that cannot bend: the frame's aspect
 * ratio must equal the world box's exactly. The overlay of HTML markers is
 * positioned in percentages of the container, so the moment `preserveAspectRatio`
 * has to letterbox the SVG, every marker drifts off the place it names — the
 * failure documented in `docs/adr/0003-carte-svg-inerte-et-balises-html.md`.
 */

const WORLD = { width: 960, height: 500 };
const WORLD_ASPECT = WORLD.width / WORLD.height;

/** Floating-point width/height division will not land on 1.92 exactly; the
 * frame is rounded to one decimal, so compare with a tolerance rather than
 * pretending the arithmetic is exact. */
function expectWorldAspect(frame: { width: number; height: number }): void {
  expect(frame.width / frame.height).toBeCloseTo(WORLD_ASPECT, 2);
}

describe("miniMapFrame", () => {
  /**
   * No point to frame is not an error and not an empty frame: it is the whole
   * world. A trip whose every coordinate failed to project still gets a map —
   * the reader sees a world map with no marker rather than a blank box.
   */
  it("falls back to the whole world when there is nothing to frame", () => {
    const frame = miniMapFrame([], WORLD);

    expect(frame).toMatchObject({ x: 0, y: 0, width: 960, height: 500 });
    expect(frame.viewBox).toBe("0 0 960 500");
  });

  it("ignores points that did not project", () => {
    const frame = miniMapFrame(
      [
        { x: Number.NaN, y: 10 },
        { x: 20, y: Number.POSITIVE_INFINITY },
      ],
      WORLD
    );

    expect(frame).toMatchObject({ x: 0, y: 0, width: 960, height: 500 });
  });

  /** The aspect invariant, on every shape of input — this is the one that keeps
   * the marker overlay aligned with the countries underneath it. */
  it.each([
    { label: "a single point", points: [{ x: 700, y: 200 }] },
    {
      label: "a wide pair",
      points: [
        { x: 100, y: 250 },
        { x: 900, y: 250 },
      ],
    },
    {
      label: "a tall pair",
      points: [
        { x: 500, y: 60 },
        { x: 500, y: 440 },
      ],
    },
    {
      label: "a cluster",
      points: [
        { x: 700, y: 190 },
        { x: 705, y: 195 },
        { x: 710, y: 188 },
      ],
    },
  ])("keeps the world's aspect ratio for $label", ({ points }) => {
    expectWorldAspect(miniMapFrame(points, WORLD));
  });

  /** Never larger than the world, never outside it: a frame that overhangs the
   * viewBox renders empty space where the reader expects land. */
  it.each([
    { label: "top-left corner", points: [{ x: 2, y: 2 }] },
    { label: "bottom-right corner", points: [{ x: 958, y: 498 }] },
    {
      label: "full span",
      points: [
        { x: 0, y: 0 },
        { x: 960, y: 500 },
      ],
    },
  ])("stays inside the world box for $label", ({ points }) => {
    const frame = miniMapFrame(points, WORLD);

    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.width).toBeLessThanOrEqual(WORLD.width);
    expect(frame.height).toBeLessThanOrEqual(WORLD.height);
    expect(frame.x + frame.width).toBeLessThanOrEqual(WORLD.width + 0.05);
    expect(frame.y + frame.height).toBeLessThanOrEqual(WORLD.height + 0.05);
  });

  /**
   * A trip that never leaves one city is a point, and a point has no extent to
   * pad. Without a floor the frame would collapse to zero and the division that
   * places the markers would answer `Infinity`.
   */
  it("gives a single point a window with real area", () => {
    const frame = miniMapFrame([{ x: 700, y: 200 }], WORLD);

    expect(frame.width).toBeGreaterThanOrEqual(WORLD.width * MINI_MAP_MIN_WIDTH_FRACTION);
    expect(frame.height).toBeGreaterThan(0);
    expectWorldAspect(frame);
  });

  /**
   * The floor is much lower than the world map's 0.3, and that is the reason
   * this module exists at all. Asserted as an inequality against the number that
   * governs the other map, so the intent survives a future tweak of either.
   */
  it("zooms closer than the world map is allowed to", () => {
    expect(MINI_MAP_MIN_WIDTH_FRACTION).toBeLessThan(0.3);
    expect(MINI_MAP_MIN_WIDTH_FRACTION).toBeGreaterThan(0);
  });

  /** The points must actually be inside the window, with margin — the frame is
   * useless if it is correctly shaped and centred somewhere else. */
  it("contains every point it was given, away from the edge", () => {
    const points = [
      { x: 600, y: 150 },
      { x: 800, y: 300 },
    ];
    const frame = miniMapFrame(points, WORLD);

    for (const point of points) {
      expect(point.x).toBeGreaterThan(frame.x);
      expect(point.x).toBeLessThan(frame.x + frame.width);
      expect(point.y).toBeGreaterThan(frame.y);
      expect(point.y).toBeLessThan(frame.y + frame.height);
    }
  });

  /** The `viewBox` is the serialised form of the same four numbers; a mismatch
   * between them would place the markers against a window that is not drawn. */
  it("serialises the viewBox from its own numbers", () => {
    const frame = miniMapFrame(
      [
        { x: 600, y: 150 },
        { x: 800, y: 300 },
      ],
      WORLD
    );
    const parsed = frame.viewBox.split(" ").map(Number);

    expect(parsed).toEqual([frame.x, frame.y, frame.width, frame.height]);
  });

  it.each([
    { label: "a zero-area world", world: { width: 0, height: 500 } },
    { label: "a non-finite world", world: { width: Number.NaN, height: 500 } },
  ])("refuses $label", ({ world }) => {
    expect(() => miniMapFrame([{ x: 1, y: 1 }], world)).toThrow();
  });
});
